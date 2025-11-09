#!/usr/bin/env node
// This file has been modified by sky1core.

// Apply buffer patch for Node.js v24 compatibility before any MCP imports
import "@sky1core/circuit-core/buffer-patch.js";

import { Command } from "commander";
import { setupProcessLifecycle } from "@sky1core/circuit-core";
import { WebDriver } from "./web-driver.js";
import { WebMCPServer } from "./web-server.js";

// Track server instance to handle cleanup
let serverInstance: WebMCPServer | null = null;
let lifecycleManager: ReturnType<typeof setupProcessLifecycle> | null = null;

const program = new Command();

program
  .name("circuit-web")
  .description("Snowfort Circuit Web MCP - Computer use for webapps and electron apps")
  .version("0.0.13")
  .option("--port <port>", "Port to listen on (stdio mode only)")
  .option("--browser <browser>", "Default browser engine", "chromium")
  .option("--headed", "Run in headed mode by default")
  .option("--name <name>", "Server name for MCP handshake", "circuit-web")
  .action(async (options) => {
    try {
      console.error("[WEB-MCP] Starting MCP server...");
      serverInstance = new WebMCPServer(options.name, "0.0.13");

      // Setup process lifecycle management
      lifecycleManager = setupProcessLifecycle({
        serverInstance,
        logPrefix: "[WEB-MCP]",
        onShutdown: () => {
          serverInstance = null;
        }
      });

      await serverInstance.run();
      console.error("[WEB-MCP] MCP server running");
      lifecycleManager.ensureParentWatcher();
    } catch (error) {
      console.error("[WEB-MCP] Fatal MCP Server Error:", error);
      if (lifecycleManager) {
        await lifecycleManager.shutdown(1, "server failed to start");
      } else {
        process.exit(1);
      }
    }
  });

program.parse();
