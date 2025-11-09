#!/usr/bin/env node
// This file has been modified by sky1core.

// Apply buffer patch for Node.js v24 compatibility before any MCP imports
import "@sky1core/circuit-core/buffer-patch.js";

import { Command } from "commander";
import { setupProcessLifecycle } from "@sky1core/circuit-core";
import { ElectronDriver } from "./electron-driver.js";
import { ElectronMCPServer } from "./electron-server.js";

// Track server instance to handle cleanup
let serverInstance: ElectronMCPServer | null = null;
let lifecycleManager: ReturnType<typeof setupProcessLifecycle> | null = null;

const program = new Command();

program
  .name("circuit-electron")
  .description("Snowfort Circuit Electron MCP - Computer use for webapps and electron apps")
  .version("0.0.17")
  .option("--name <name>", "Server name for MCP handshake", "circuit-electron")
  .action(async (options) => {
    try {
      console.error("[ELECTRON-MCP] Starting MCP server...");
      serverInstance = new ElectronMCPServer(options.name, "0.0.17");

      // Setup process lifecycle management
      lifecycleManager = setupProcessLifecycle({
        serverInstance,
        logPrefix: "[ELECTRON-MCP]",
        onShutdown: () => {
          serverInstance = null;
        }
      });

      await serverInstance.run();
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

program.parse();
