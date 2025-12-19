#!/usr/bin/env node
// This file has been modified by sky1core.

// Apply buffer patch for Node.js v24 compatibility before any MCP imports
import "@sky1core/circuit-core/buffer-patch.js";

import { Command } from "commander";
import { setupProcessLifecycle } from "@sky1core/circuit-core";
import { ElectronDriver } from "./electron-driver.js";
import { ElectronMCPServer } from "./electron-server.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

declare const __VERSION__: string;
const VERSION = __VERSION__;

// Set process title for easy identification in ps output
process.title = `circuit-electron@${VERSION}`;

// Track server instance to handle cleanup
let serverInstance: ElectronMCPServer | null = null;
let lifecycleManager: ReturnType<typeof setupProcessLifecycle> | null = null;

const program = new Command();

program
  .name("circuit-electron")
  .description("Snowfort Circuit Electron MCP - Computer use for webapps and electron apps")
  .version(VERSION);

// Default command - start MCP server
program
  .command("serve", { isDefault: true })
  .description("Start the MCP server (default)")
  .option("--name <name>", "Server name for MCP handshake", "circuit-electron")
  .action(async (options) => {
    try {
      console.error("[ELECTRON-MCP] Starting MCP server...");
      serverInstance = new ElectronMCPServer(options.name || "circuit-electron", VERSION);

      // Setup process lifecycle management
      lifecycleManager = setupProcessLifecycle({
        serverInstance,
        logPrefix: "[ELECTRON-MCP]",
        onShutdown: () => {
          serverInstance = null;
        }
      });

      await serverInstance.run((code, reason) => {
        lifecycleManager?.shutdown(code ?? 0, reason);
      });
      console.error("[ELECTRON-MCP] MCP server running");
      lifecycleManager.ensureParentWatcher();
    } catch (error) {
      console.error("[ELECTRON-MCP] Fatal MCP Server Error:", error);
      if (lifecycleManager) {
        await lifecycleManager.shutdown(1, "server failed to start");
      } else {
        process.exit(1);
      }
    }
  });

// Cleanup command - kill orphaned processes
program
  .command("cleanup")
  .description("Find and kill orphaned circuit-electron processes (ppid=1)")
  .option("--dry-run", "Show processes without killing them")
  .option("--force", "Kill ALL matching processes, not just orphans (dangerous)")
  .option("--all", "Also include related Electron/Chromium processes")
  .action(async (options) => {
    const patterns = ["circuit-electron"];
    if (options.all) {
      patterns.push("Electron.*--remote-debugging");
      patterns.push("Electron Helper");
    }

    let totalKilled = 0;
    let totalOrphans = 0;
    let totalActive = 0;

    for (const pattern of patterns) {
      try {
        // Find processes matching the pattern (exclude current process)
        const { stdout } = await execAsync(
          `pgrep -f "${pattern}" | grep -v "^${process.pid}$" || true`
        );
        const pids = stdout.trim().split("\n").filter(pid => pid && pid !== String(process.pid));

        if (pids.length === 0) {
          console.log(`No processes found matching: ${pattern}`);
          continue;
        }

        // Categorize processes by orphan status
        const orphans: string[] = [];
        const active: string[] = [];

        for (const pid of pids) {
          try {
            const { stdout: ppidOut } = await execAsync(`ps -p ${pid} -o ppid= | tr -d ' '`);
            const ppid = ppidOut.trim();
            const { stdout: psOut } = await execAsync(`ps -p ${pid} -o pid,ppid,etime,command | tail -1`);

            if (ppid === "1") {
              orphans.push(pid);
              console.log(`[ORPHAN]  ${psOut.trim()}`);
            } else {
              active.push(pid);
              console.log(`[ACTIVE]  ${psOut.trim()}`);
            }
          } catch {
            // Process might have already exited
          }
        }

        totalOrphans += orphans.length;
        totalActive += active.length;

        // Determine which PIDs to kill
        const pidsToKill = options.force ? [...orphans, ...active] : orphans;

        if (pidsToKill.length === 0) {
          if (active.length > 0) {
            console.log(`\nNo orphans found. ${active.length} active session(s) preserved.`);
            console.log(`Use --force to kill active sessions (dangerous).`);
          }
          continue;
        }

        if (options.dryRun) {
          console.log(`\n[DRY-RUN] Would kill ${pidsToKill.length} process(es)`);
        } else {
          for (const pid of pidsToKill) {
            try {
              await execAsync(`kill -9 ${pid}`);
              console.log(`Killed PID ${pid}`);
              totalKilled++;
            } catch {
              // Process might have already exited
            }
          }
        }
      } catch (error) {
        // pgrep returns exit code 1 if no processes found
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Orphans (ppid=1): ${totalOrphans}`);
    console.log(`Active sessions:  ${totalActive}`);
    if (!options.dryRun) {
      console.log(`Total killed:     ${totalKilled}`);
    }
  });

program.parse();
