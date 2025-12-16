// Process lifecycle management for MCP servers
// Handles graceful shutdown, parent process monitoring, and signal handling

import { execSync } from "child_process";
import * as fs from "fs";

export interface MCPServerInstance {
  cleanup(): Promise<void>;
}

export interface ProcessLifecycleOptions {
  serverInstance: MCPServerInstance;
  logPrefix: string;
  onShutdown?: (code: number, reason?: string) => void;
}

export interface ProcessLifecycleManager {
  shutdown(code: number, reason?: string): Promise<void>;
  ensureParentWatcher(): void;
  cleanup(): void;
}

// Check if direct parent's parent is init (ppid=1)
// This handles the npm exec wrapper case:
//   claude (dies) → npm exec (ppid becomes 1) → node circuit-mcp (ppid = npm exec)
function isParentOrphaned(logPrefix: string): boolean {
  try {
    const parentPid = process.ppid;
    if (parentPid <= 1) return false; // Already handled by direct ppid check

    const result = execSync(`ps -o ppid= -p ${parentPid} 2>/dev/null`, {
      encoding: "utf8",
      timeout: 1000,
    });
    const grandparentPid = parseInt(result.trim(), 10);

    if (grandparentPid === 1) {
      console.error(`${logPrefix} Parent PID ${parentPid} is orphaned (grandparent ppid=1)`);
      return true;
    }
    return false;
  } catch {
    // Parent process doesn't exist - it died
    return true;
  }
}

// Check if stdin is still connected
function isStdinConnected(): boolean {
  try {
    // Check if FD 0 (stdin) is still valid
    fs.fstatSync(0);
    return true;
  } catch {
    return false;
  }
}

export function setupProcessLifecycle(
  options: ProcessLifecycleOptions
): ProcessLifecycleManager {
  const { serverInstance, logPrefix, onShutdown } = options;

  let shuttingDown = false;
  let parentWatcher: NodeJS.Timeout | null = null;

  async function shutdown(code: number, reason?: string): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (reason) {
      console.error(`${logPrefix} Shutting down: ${reason}`);
    }

    if (parentWatcher) {
      clearInterval(parentWatcher);
      parentWatcher = null;
    }

    if (onShutdown) {
      onShutdown(code, reason);
    }

    try {
      // Add timeout to prevent cleanup from hanging indefinitely
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Cleanup timeout after 5s")), 5000)
      );
      await Promise.race([serverInstance.cleanup(), timeoutPromise]);
    } catch (error) {
      console.error(`${logPrefix} Error during cleanup:`, error);
    }

    // Small delay to allow logs to flush
    setTimeout(() => process.exit(code), 100);
  }

  function requestShutdown(code: number, reason?: string): void {
    void shutdown(code, reason);
  }

  function ensureParentWatcher(): void {
    if (parentWatcher) {
      return;
    }
    let checkCount = 0;
    parentWatcher = setInterval(() => {
      if (shuttingDown) return;
      checkCount++;

      // Every 2s: Light checks (ppid, stdin)
      // Check 1: Direct parent is init (ppid=1)
      if (process.ppid === 1) {
        console.error(
          `${logPrefix} Parent process ended (ppid=1), shutting down...`
        );
        requestShutdown(0, "parent exited");
        return;
      }

      // Check 2: stdin is disconnected (very light - just fstat)
      if (!isStdinConnected()) {
        console.error(
          `${logPrefix} stdin disconnected, shutting down...`
        );
        requestShutdown(0, "stdin disconnected");
        return;
      }

      // Every 10s (5 intervals): Heavy check (execSync ps command)
      // Check 3: Parent is orphaned (handles npm exec wrapper case)
      if (checkCount % 5 === 0 && isParentOrphaned(logPrefix)) {
        console.error(
          `${logPrefix} Parent process orphaned, shutting down...`
        );
        requestShutdown(0, "parent orphaned");
        return;
      }
    }, 2000);
  }

  // Handle unhandled rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error(`${logPrefix} Unhandled Rejection at:`, promise, "reason:", reason);
    // Don't exit immediately - let MCP server handle errors gracefully
  });

  process.on("uncaughtException", (error) => {
    console.error(`${logPrefix} Uncaught Exception:`, error);
    console.error(`${logPrefix} Error stack:`, error.stack);

    // Be more conservative about what constitutes a "fatal" error
    if (
      error.message &&
      (error.message.includes("MCP Server failed to start") ||
        error.message.includes("Transport initialization failed") ||
        error.message.includes("EADDRINUSE"))
    ) {
      console.error(`${logPrefix} Fatal server error detected, exiting...`);
      requestShutdown(1, "fatal exception");
    } else {
      console.error(
        `${logPrefix} Non-fatal exception caught, MCP transport will remain active`
      );
      // Don't exit for app launch failures, timeouts, or other recoverable errors
    }
  });

  // Handle process termination gracefully
  process.on("SIGINT", () => {
    console.error(`${logPrefix} Received SIGINT, shutting down gracefully...`);
    requestShutdown(0, "SIGINT");
  });

  process.on("SIGTERM", () => {
    console.error(`${logPrefix} Received SIGTERM, shutting down gracefully...`);
    requestShutdown(0, "SIGTERM");
  });

  process.on("SIGPIPE", () => {
    console.error(`${logPrefix} Received SIGPIPE, shutting down...`);
    requestShutdown(0, "SIGPIPE");
  });

  process.on("disconnect", () => {
    console.error(`${logPrefix} Received disconnect, shutting down...`);
    requestShutdown(0, "parent disconnect");
  });

  // Keep the process alive
  process.stdin.on("end", () => {
    console.error(`${logPrefix} stdin ended, shutting down...`);
    requestShutdown(0, "stdin ended");
  });

  return {
    shutdown,
    ensureParentWatcher,
    cleanup: () => {
      if (parentWatcher) {
        clearInterval(parentWatcher);
        parentWatcher = null;
      }
    },
  };
}
