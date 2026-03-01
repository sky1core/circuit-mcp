// This file has been modified by sky1core.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Session, ToolResult } from "@sky1core/circuit-core";
import { promises as fs } from "fs";
import { join } from "path";
import { WebDriver, WebLaunchOpts, WebSession } from "./web-driver.js";
import { RelayServer } from "./relay-server.js";
import { ExtensionDriver, ExtensionSession } from "./extension-driver.js";
import { logger } from "./logger.js";

export interface WebMCPServerOptions {
  enableExtension?: boolean;
  outputDir?: string;
}

export class WebMCPServer {
  private server: Server;
  private driver: WebDriver;
  private sessions = new Map<string, Session>();
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private relayServer: RelayServer | null = null;
  private extensionDriver: ExtensionDriver | null = null;
  private options: WebMCPServerOptions;

  constructor(private name: string, private version: string = "0.1.0", options: WebMCPServerOptions = {}) {
    this.options = options;
    this.driver = new WebDriver();

    if (options.enableExtension) {
      this.relayServer = new RelayServer();
      this.extensionDriver = new ExtensionDriver(this.relayServer);
    }
    this.server = new Server(
      {
        name: this.name,
        version: this.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // Extension-only tools (registered only when extension mode is enabled)
    const extensionTools = this.options.enableExtension ? [
      {
        name: "browser_connect",
        description: "Connect to an existing Chrome browser via extension. Requires the Circuit MCP Bridge extension to be installed.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to navigate to after connecting (optional, defaults to about:blank)",
            },
            timeout: {
              type: "number",
              description: "Timeout waiting for extension connection in ms (default: 60000)",
            },
          },
          required: [],
        },
      },
    ] : [];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "browser_launch",
            description: "Launch a new browser session",
            inputSchema: {
              type: "object",
              properties: {
                browser: {
                  type: "string",
                  enum: ["chromium", "firefox", "webkit"],
                  description: "Browser engine to use (default: chromium)",
                },
                headed: {
                  type: "boolean",
                  description: "Run in headed mode (default: false)",
                },
                timeout: {
                  type: "number",
                  description: "Launch timeout in milliseconds",
                },
                viewport: {
                  type: "object",
                  properties: {
                    width: { type: "number" },
                    height: { type: "number" },
                  },
                  description: "Viewport size",
                },
                compressScreenshots: {
                  type: "boolean",
                  description: "Compress screenshots to JPEG (default: true)",
                },
                screenshotQuality: {
                  type: "number",
                  description: "JPEG quality 1-100 (default: 50)",
                },
              },
              required: [],
            },
          },
          ...extensionTools,
          {
            name: "browser_navigate",
            description: "Navigate to a URL in an existing browser session",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                url: {
                  type: "string",
                  description: "URL to navigate to",
                },
              },
              required: ["sessionId", "url"],
            },
          },
          {
            name: "click",
            description: "Click on an element identified by a CSS selector",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the element to click",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "type",
            description: "Type text into an element identified by a CSS selector",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the element to type into",
                },
                text: {
                  type: "string",
                  description: "Text to type",
                },
              },
              required: ["sessionId", "selector", "text"],
            },
          },
          {
            name: "screenshot",
            description: "Take a screenshot of the current page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                path: {
                  type: "string",
                  description: "Optional path to save the screenshot",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "evaluate",
            description: "Execute JavaScript in the page context",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                script: {
                  type: "string",
                  description: "JavaScript code to execute",
                },
              },
              required: ["sessionId", "script"],
            },
          },
          {
            name: "wait_for_selector",
            description: "Wait for an element to appear on the page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector to wait for",
                },
                timeout: {
                  type: "number",
                  description: "Timeout in milliseconds (default: 30000)",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "snapshot",
            description: "Get accessibility tree snapshot of the current page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "hover",
            description: "Hover over an element identified by a CSS selector",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the element to hover over",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "drag",
            description: "Drag an element to a target location",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                sourceSelector: {
                  type: "string",
                  description: "CSS selector for the element to drag",
                },
                targetSelector: {
                  type: "string",
                  description: "CSS selector for the drop target",
                },
              },
              required: ["sessionId", "sourceSelector", "targetSelector"],
            },
          },
          {
            name: "key",
            description: "Press a keyboard key",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                key: {
                  type: "string",
                  description: "Key to press (e.g., 'Enter', 'Tab', 'Escape')",
                },
              },
              required: ["sessionId", "key"],
            },
          },
          {
            name: "select",
            description: "Select an option from a dropdown",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the select element",
                },
                value: {
                  type: "string",
                  description: "Value to select",
                },
              },
              required: ["sessionId", "selector", "value"],
            },
          },
          {
            name: "upload",
            description: "Upload a file to an input element",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the file input element",
                },
                filePath: {
                  type: "string",
                  description: "Path to the file to upload",
                },
              },
              required: ["sessionId", "selector", "filePath"],
            },
          },
          {
            name: "back",
            description: "Navigate back in browser history",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "forward",
            description: "Navigate forward in browser history",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "refresh",
            description: "Refresh the current page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "pdf",
            description: "Save the current page as a PDF",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                path: {
                  type: "string",
                  description: "Optional path to save the PDF",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "content",
            description: "Get the HTML content of the current page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "text_content",
            description: "Get the visible text content of the current page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "element_exists",
            description: "Check if an element exists on the page. Returns boolean. Much faster than snapshot for existence checks.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector to check",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "element_text",
            description: "Get text content of a specific element. Returns null if element not found. More efficient than text_content for single elements.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the element",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "element_attribute",
            description: "Get an attribute value from an element. Returns null if element or attribute not found.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector for the element",
                },
                attribute: {
                  type: "string",
                  description: "Attribute name (e.g., 'href', 'src', 'data-id')",
                },
              },
              required: ["sessionId", "selector", "attribute"],
            },
          },
          {
            name: "close",
            description: "Close a browser session",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID to close",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "browser_resize",
            description: "Resize browser window viewport",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                width: {
                  type: "number",
                  description: "Viewport width in pixels",
                },
                height: {
                  type: "number",
                  description: "Viewport height in pixels",
                },
              },
              required: ["sessionId", "width", "height"],
            },
          },
          {
            name: "scroll",
            description: "Scroll the page in a direction",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                direction: {
                  type: "string",
                  enum: ["up", "down", "left", "right"],
                  description: "Scroll direction",
                },
                amount: {
                  type: "number",
                  description: "Scroll amount in pixels (default: 500)",
                },
              },
              required: ["sessionId", "direction"],
            },
          },
          {
            name: "scroll_to_element",
            description: "Scroll to bring an element into view",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                selector: {
                  type: "string",
                  description: "CSS selector of element to scroll to",
                },
              },
              required: ["sessionId", "selector"],
            },
          },
          {
            name: "scroll_to_top",
            description: "Scroll to top of page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "scroll_to_bottom",
            description: "Scroll to bottom of page",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "browser_handle_dialog",
            description: "Handle browser dialogs (alert, confirm, prompt)",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                action: {
                  type: "string",
                  enum: ["accept", "dismiss"],
                  description: "Action to take on dialogs",
                },
                promptText: {
                  type: "string",
                  description: "Text to enter for prompt dialogs",
                },
              },
              required: ["sessionId", "action"],
            },
          },
          {
            name: "browser_tab_new",
            description: "Open a new tab",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "browser_tab_list",
            description: "List all open tabs",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "browser_tab_select",
            description: "Select a tab by ID",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                tabId: {
                  type: "string",
                  description: "Tab ID to select",
                },
              },
              required: ["sessionId", "tabId"],
            },
          },
          {
            name: "browser_tab_close",
            description: "Close a tab by ID",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
                tabId: {
                  type: "string",
                  description: "Tab ID to close",
                },
              },
              required: ["sessionId", "tabId"],
            },
          },
          {
            name: "browser_network_requests",
            description: "Get all network requests from the session",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "browser_console_messages",
            description: "Get all console messages from the session",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: {
                  type: "string",
                  description: "Session ID returned from browser_launch",
                },
              },
              required: ["sessionId"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const { name, arguments: args } = request.params;
      const toolArgs = args || {};

      // Determine session type for logging
      const sessionId = (toolArgs.sessionId as string) || 'none';
      const session = this.sessions.get(sessionId);
      const sessionType = session?.type === 'extension' ? 'extension' : 'playwright';

      // Start logging
      const startTime = Date.now();
      let errorOccurred: string | undefined;

      try {

        // Add additional safety wrapper to prevent any uncaught promise rejections
        const executeToolSafely = async (toolFunction: () => Promise<any>) => {
          try {
            return await toolFunction();
          } catch (innerError) {
            console.error(`[WEB-MCP] Tool execution error in ${name}:`, innerError);
            throw innerError;
          }
        };

        switch (name) {
          case "browser_launch":
            return await this.handleBrowserLaunch(toolArgs);

          case "browser_connect":
            return await this.handleBrowserConnect(toolArgs.url as string | undefined, toolArgs.timeout as number);

          case "browser_navigate":
            await this.handleBrowserNavigate(toolArgs.sessionId as string, toolArgs.url as string);
            const navSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Navigation completed successfully" },
              { type: "text", text: `Page Snapshot:\n${navSnapshot}` }
            ] };

          case "click":
            await this.handleClick(toolArgs.sessionId as string, toolArgs.selector as string);
            const clickSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Element clicked successfully" },
              { type: "text", text: `Page Snapshot:\n${clickSnapshot}` }
            ] };

          case "type":
            await this.handleType(toolArgs.sessionId as string, toolArgs.selector as string, toolArgs.text as string);
            const typeSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Text typed successfully" },
              { type: "text", text: `Page Snapshot:\n${typeSnapshot}` }
            ] };

          case "screenshot":
            const screenshotPath = await this.handleScreenshot(toolArgs.sessionId as string, toolArgs.path as string);
            return { content: [{ type: "text", text: `Screenshot saved to: ${screenshotPath}` }] };

          case "evaluate":
            const evalResult = await executeToolSafely(() => 
              this.handleEvaluate(toolArgs.sessionId as string, toolArgs.script as string)
            );
            return { content: [{ type: "text", text: `Result: ${JSON.stringify(evalResult)}` }] };

          case "wait_for_selector":
            await this.handleWaitForSelector(toolArgs.sessionId as string, toolArgs.selector as string, toolArgs.timeout as number);
            return { content: [{ type: "text", text: "Element found" }] };

          case "snapshot":
            const snapshotResult = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: snapshotResult }] };

          case "hover":
            await this.handleHover(toolArgs.sessionId as string, toolArgs.selector as string);
            const hoverSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Element hovered successfully" },
              { type: "text", text: `Page Snapshot:\n${hoverSnapshot}` }
            ] };

          case "drag":
            await this.handleDrag(toolArgs.sessionId as string, toolArgs.sourceSelector as string, toolArgs.targetSelector as string);
            return { content: [{ type: "text", text: "Element dragged successfully" }] };

          case "key":
            await this.handleKey(toolArgs.sessionId as string, toolArgs.key as string);
            const keySnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: `Key '${toolArgs.key}' pressed successfully` },
              { type: "text", text: `Page Snapshot:\n${keySnapshot}` }
            ] };

          case "select":
            await this.handleSelect(toolArgs.sessionId as string, toolArgs.selector as string, toolArgs.value as string);
            return { content: [{ type: "text", text: "Option selected successfully" }] };

          case "upload":
            await this.handleUpload(toolArgs.sessionId as string, toolArgs.selector as string, toolArgs.filePath as string);
            return { content: [{ type: "text", text: "File uploaded successfully" }] };

          case "back":
            await this.handleBack(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: "Navigated back successfully" }] };

          case "forward":
            await this.handleForward(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: "Navigated forward successfully" }] };

          case "refresh":
            await this.handleRefresh(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: "Page refreshed successfully" }] };

          case "pdf":
            const pdfPath = await this.handlePdf(toolArgs.sessionId as string, toolArgs.path as string);
            return { content: [{ type: "text", text: `PDF saved to: ${pdfPath}` }] };

          case "content":
            const htmlContent = await this.handleContent(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: htmlContent }] };

          case "text_content":
            const textContent = await this.handleTextContent(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: textContent }] };

          case "element_exists":
            const existsResult = await this.handleExists(toolArgs.sessionId as string, toolArgs.selector as string);
            return { content: [{ type: "text", text: JSON.stringify({ exists: existsResult }) }] };

          case "element_text":
            const getTextResult = await this.handleGetText(toolArgs.sessionId as string, toolArgs.selector as string);
            return { content: [{ type: "text", text: JSON.stringify({ text: getTextResult }) }] };

          case "element_attribute":
            const getAttrResult = await this.handleGetAttribute(toolArgs.sessionId as string, toolArgs.selector as string, toolArgs.attribute as string);
            return { content: [{ type: "text", text: JSON.stringify({ value: getAttrResult }) }] };

          case "close":
            await this.handleClose(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: "Session closed successfully" }] };

          case "browser_resize":
            await this.handleResize(toolArgs.sessionId as string, toolArgs.width as number, toolArgs.height as number);
            const resizeSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: `Browser resized to ${toolArgs.width}x${toolArgs.height}` },
              { type: "text", text: `Page Snapshot:\n${resizeSnapshot}` }
            ] };

          case "scroll":
            await this.handleScroll(toolArgs.sessionId as string, toolArgs.direction as string, toolArgs.amount as number);
            const scrollSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: `Scrolled ${toolArgs.direction}${toolArgs.amount ? ` by ${toolArgs.amount}px` : ''}` },
              { type: "text", text: `Page Snapshot:\n${scrollSnapshot}` }
            ] };

          case "scroll_to_element":
            await this.handleScrollToElement(toolArgs.sessionId as string, toolArgs.selector as string);
            const scrollToSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: `Scrolled to element: ${toolArgs.selector}` },
              { type: "text", text: `Page Snapshot:\n${scrollToSnapshot}` }
            ] };

          case "scroll_to_top":
            await this.handleScrollToTop(toolArgs.sessionId as string);
            const topSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Scrolled to top of page" },
              { type: "text", text: `Page Snapshot:\n${topSnapshot}` }
            ] };

          case "scroll_to_bottom":
            await this.handleScrollToBottom(toolArgs.sessionId as string);
            const bottomSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: "Scrolled to bottom of page" },
              { type: "text", text: `Page Snapshot:\n${bottomSnapshot}` }
            ] };

          case "browser_handle_dialog":
            await this.handleDialogSetup(toolArgs.sessionId as string, toolArgs.action as string, toolArgs.promptText as string);
            return { content: [{ type: "text", text: `Dialog handler set to ${toolArgs.action}` }] };

          case "browser_tab_new":
            const newTabId = await this.handleNewTab(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: `New tab created with ID: ${newTabId}` }] };

          case "browser_tab_list":
            const tabs = await this.handleListTabs(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };

          case "browser_tab_select":
            await this.handleSelectTab(toolArgs.sessionId as string, toolArgs.tabId as string);
            const tabSnapshot = await this.handleSnapshot(toolArgs.sessionId as string);
            return { content: [
              { type: "text", text: `Tab ${toolArgs.tabId} selected` },
              { type: "text", text: `Page Snapshot:\n${tabSnapshot}` }
            ] };

          case "browser_tab_close":
            await this.handleCloseTab(toolArgs.sessionId as string, toolArgs.tabId as string);
            return { content: [{ type: "text", text: `Tab ${toolArgs.tabId} closed` }] };

          case "browser_network_requests":
            const requests = await this.handleNetworkRequests(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: JSON.stringify(requests, null, 2) }] };

          case "browser_console_messages":
            const messages = await this.handleConsoleMessages(toolArgs.sessionId as string);
            return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        errorOccurred = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorOccurred}` }],
          isError: true,
        };
      } finally {
        // Log tool completion
        const duration = Date.now() - startTime;
        logger.log({
          sessionId,
          sessionType,
          tool: name,
          params: logger.sanitizeParams(toolArgs as Record<string, unknown>),
          result: errorOccurred ? 'error' : 'success',
          error: errorOccurred,
          duration,
        });
      }
    });
  }

  private async getSession(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private getDriver(session: Session): WebDriver | ExtensionDriver {
    if (this.isExtensionSession(session)) {
      if (!this.extensionDriver) {
        throw new Error('Extension driver not available');
      }
      return this.extensionDriver;
    }
    return this.driver;
  }

  private async handleBrowserLaunch(args: any): Promise<ToolResult> {
    const opts: WebLaunchOpts = {
      browser: args.browser || "chromium",
      headed: args.headed || false,
      timeout: args.timeout,
      viewport: args.viewport,
    };

    const session = await this.driver.launch(opts);
    this.sessions.set(session.id, session);

    return {
      content: [
        {
          type: "text",
          text: `Browser launched successfully. Session ID: ${session.id}`,
        },
      ],
    };
  }

  private async handleBrowserConnect(url?: string, timeout?: number): Promise<ToolResult> {
    if (!this.extensionDriver || !this.relayServer) {
      return {
        content: [{
          type: "text",
          text: "Extension mode is not enabled. Start the server with --extension flag.",
        }],
        isError: true,
      };
    }

    try {
      const session = await this.extensionDriver.connect(timeout);
      this.sessions.set(session.id, session);

      // Check if extension is already connected (from pending pool)
      if (!this.extensionDriver.isConnected(session)) {
        // Wait for extension to connect (with timeout)
        // Default 60 seconds to allow for Chrome service worker wake-up
        const waitTimeout = timeout || 60000;
        try {
          await this.extensionDriver.waitForConnection(session, waitTimeout);
        } catch {
          // Extension didn't connect in time - clean up the session
          this.sessions.delete(session.id);
          await this.extensionDriver.close(session);
          return {
            content: [
              {
                type: "text",
                text: `ERROR: Chrome extension not connected. Please ensure the Circuit MCP extension is installed and connected to relay server at ws://127.0.0.1:${session.relayPort}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Extension is connected - create a new tab directly
      const targetUrl = url || 'about:blank';
      let newTabId: number;

      try {
        // Try to create a new tab directly via extension (works even without attached tab)
        newTabId = await this.extensionDriver.createTab(session, targetUrl);
      } catch (createError) {
        // Fallback: try to find an existing tab and use window.open
        const tabs = await this.extensionDriver.listTabs(session);
        if (tabs.length === 0) {
          this.sessions.delete(session.id);
          await this.extensionDriver.close(session);
          return {
            content: [{
              type: "text",
              text: "No accessible tabs found and failed to create a new tab.",
            }],
            isError: true,
          };
        }

        // Attach to an existing tab and create new tab via window.open
        await this.extensionDriver.attachTab(session, tabs[0].id);
        newTabId = await this.extensionDriver.newTab(session, targetUrl);
      }

      // Attach to the newly created tab
      await this.extensionDriver.attachTab(session, newTabId);

      return {
        content: [
          {
            type: "text",
            text: `Extension session created. Session ID: ${session.id}`,
          },
          {
            type: "text",
            text: `New tab opened and attached (Tab ID: ${newTabId}). Navigated to: ${targetUrl}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  private isExtensionSession(session: Session): session is ExtensionSession {
    return (session as ExtensionSession).type === 'extension';
  }

  private async handleBrowserNavigate(sessionId: string, url: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.navigate(session, url);
    } else {
      await this.driver.navigate(session, url);
    }
  }

  private async handleClick(sessionId: string, selector: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.click(session, selector);
    } else {
      await this.driver.click(session, selector);
    }
  }

  private async handleType(sessionId: string, selector: string, text: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.type(session, selector, text);
    } else {
      await this.driver.type(session, selector, text);
    }
  }

  private async handleScreenshot(sessionId: string, path?: string): Promise<string> {
    const session = await this.getSession(sessionId);
    const outputPath = path || (this.options.outputDir
      ? join(this.options.outputDir, `screenshot-${Date.now()}.jpeg`)
      : undefined);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.screenshot(session, outputPath);
    } else {
      return await this.driver.screenshot(session, outputPath);
    }
  }

  private async handleEvaluate(sessionId: string, script: string): Promise<any> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.evaluate(session, script);
    } else {
      return await this.driver.evaluate(session, script);
    }
  }

  private async handleWaitForSelector(sessionId: string, selector: string, timeout?: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      // ExtensionDriver doesn't have waitForSelector - use polling
      const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const startTime = Date.now();
      const maxTime = timeout || 30000;
      while (Date.now() - startTime < maxTime) {
        const exists = await this.extensionDriver!.evaluate(session, `document.querySelector('${escapedSelector}') !== null`);
        if (exists) return;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`Timeout waiting for selector: ${selector}`);
    } else {
      await this.driver.waitForSelector(session, selector, timeout);
    }
  }

  private async handleSnapshot(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.snapshot(session);
    } else {
      return await this.driver.snapshot(session);
    }
  }

  private async handleHover(sessionId: string, selector: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.hover(session, selector);
    } else {
      await this.driver.hover(session, selector);
    }
  }

  private async handleDrag(sessionId: string, sourceSelector: string, targetSelector: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.drag(session, sourceSelector, targetSelector);
    } else {
      await this.driver.drag(session, sourceSelector, targetSelector);
    }
  }

  private async handleKey(sessionId: string, key: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.key(session, key);
    } else {
      await this.driver.key(session, key);
    }
  }

  private async handleSelect(sessionId: string, selector: string, value: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.select(session, selector, value);
    } else {
      await this.driver.select(session, selector, value);
    }
  }

  private async handleUpload(sessionId: string, selector: string, filePath: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.upload(session, selector, filePath);
    } else {
      await this.driver.upload(session, selector, filePath);
    }
  }

  private async handleBack(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.back(session);
    } else {
      await this.driver.back(session);
    }
  }

  private async handleForward(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.forward(session);
    } else {
      await this.driver.forward(session);
    }
  }

  private async handleRefresh(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.refresh(session);
    } else {
      await this.driver.refresh(session);
    }
  }

  private async handlePdf(sessionId: string, path?: string): Promise<string> {
    const session = await this.getSession(sessionId);
    const outputPath = path || (this.options.outputDir
      ? join(this.options.outputDir, `page-${Date.now()}.pdf`)
      : `page-${Date.now()}.pdf`);
    if (this.isExtensionSession(session)) {
      const pdfData = await this.extensionDriver!.pdf(session);
      await fs.writeFile(outputPath, Buffer.from(pdfData, 'base64'));
      return outputPath;
    } else {
      return await this.driver.pdf(session, outputPath);
    }
  }

  private async handleContent(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.content(session);
    } else {
      return await this.driver.content(session);
    }
  }

  private async handleTextContent(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.textContent(session);
    } else {
      return await this.driver.textContent(session);
    }
  }

  private async handleExists(sessionId: string, selector: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.exists(session, selector);
    } else {
      return await this.driver.exists(session, selector);
    }
  }

  private async handleGetText(sessionId: string, selector: string): Promise<string | null> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.getText(session, selector);
    } else {
      return await this.driver.getText(session, selector);
    }
  }

  private async handleGetAttribute(sessionId: string, selector: string, attribute: string): Promise<string | null> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      return await this.extensionDriver!.getAttribute(session, selector, attribute);
    } else {
      return await this.driver.getAttribute(session, selector, attribute);
    }
  }

  private async handleClose(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.close(session);
    } else {
      await this.driver.close(session);
    }
    this.sessions.delete(sessionId);
  }

  private async handleResize(sessionId: string, width: number, height: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.resize(session, width, height);
    } else {
      await this.driver.resize(session, width, height);
    }
  }

  private async handleScroll(sessionId: string, direction: string, amount?: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.scroll(session, direction as 'up' | 'down' | 'left' | 'right', amount);
    } else {
      await this.driver.scroll(session, direction as 'up' | 'down' | 'left' | 'right', amount);
    }
  }

  private async handleScrollToElement(sessionId: string, selector: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.scrollToElement(session, selector);
    } else {
      await this.driver.scrollToElement(session, selector);
    }
  }

  private async handleScrollToTop(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.scrollToTop(session);
    } else {
      await this.driver.scrollToTop(session);
    }
  }

  private async handleScrollToBottom(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.scrollToBottom(session);
    } else {
      await this.driver.scrollToBottom(session);
    }
  }

  private async handleDialogSetup(sessionId: string, action: string, promptText?: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.handleDialog(session, action as 'accept' | 'dismiss', promptText);
    } else {
      await this.driver.handleDialog(session, action as 'accept' | 'dismiss', promptText);
    }
  }

  private async handleNewTab(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      const tabId = await this.extensionDriver!.newTab(session);
      return String(tabId);
    } else {
      return await this.driver.newTab(session);
    }
  }

  private async handleListTabs(sessionId: string): Promise<Array<{id: string, title: string, url: string, active: boolean}>> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      const tabs = await this.extensionDriver!.listTabs(session);
      // ExtensionDriver returns { id: number }, convert to { id: string, active: boolean }
      return tabs.map(tab => ({
        id: String(tab.id),
        title: tab.title,
        url: tab.url,
        active: session.attachedTabId === tab.id
      }));
    } else {
      return await this.driver.listTabs(session);
    }
  }

  private async handleSelectTab(sessionId: string, tabId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      // ExtensionDriver uses attachTab with numeric tabId
      await this.extensionDriver!.attachTab(session, parseInt(tabId, 10));
    } else {
      await this.driver.selectTab(session, tabId);
    }
  }

  private async handleCloseTab(sessionId: string, tabId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      await this.extensionDriver!.closeTab(session, parseInt(tabId, 10));
    } else {
      await this.driver.closeTab(session, tabId);
    }
  }

  private async handleNetworkRequests(sessionId: string): Promise<Array<{url: string, method: string, status?: number, timestamp: number}>> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      // ExtensionSession stores network requests directly on the session
      return session.networkRequests;
    } else {
      return await this.driver.getNetworkRequests(session);
    }
  }

  private async handleConsoleMessages(sessionId: string): Promise<Array<{type: string, text: string, timestamp: number}>> {
    const session = await this.getSession(sessionId);
    if (this.isExtensionSession(session)) {
      // ExtensionSession stores console messages directly on the session
      return session.consoleMessages;
    } else {
      return await this.driver.getConsoleMessages(session);
    }
  }

  async cleanup(): Promise<void> {
    console.error("[WEB-MCP] Cleaning up server resources...");

    // Clear keepAlive interval first
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.error("[WEB-MCP] Cleared keepAlive interval");
    }

    // Close all active sessions
    for (const [sessionId, session] of this.sessions) {
      try {
        if (this.isExtensionSession(session)) {
          await this.extensionDriver!.close(session);
        } else {
          await this.driver.close(session);
        }
      } catch (error) {
        console.error(`[WEB-MCP] Error closing session ${sessionId}:`, error);
      }
    }
    this.sessions.clear();

    // Stop relay server if running
    if (this.relayServer) {
      try {
        await this.relayServer.stop();
        console.error("[WEB-MCP] Relay server stopped");
      } catch (error) {
        console.error("[WEB-MCP] Error stopping relay server:", error);
      }
    }
  }

  async run(onFatal?: (code?: number, reason?: string) => void): Promise<void> {
    // Single-entry exit helper to prevent multiple shutdown attempts
    let exitCalled = false;
    const exit = (code = 0, reason?: string) => {
      if (exitCalled) return;
      exitCalled = true;
      if (onFatal) {
        onFatal(code, reason);
      } else {
        process.exit(code);
      }
    };

    try {
      console.error("[WEB-MCP] Starting Web MCP server...");

      // Start relay server if extension mode is enabled
      if (this.relayServer) {
        await this.relayServer.start();
        console.error(`[WEB-MCP] Relay server started on port ${this.relayServer.port}`);
      }

      const transport = new StdioServerTransport();

      // Transport error/close: trigger shutdown (no console.error to avoid loop)
      transport.onerror = () => exit(1, "transport error");
      transport.onclose = () => exit(0, "transport closed");

      // stdio errors: trigger shutdown immediately (no console.error to avoid loop)
      process.stdin.on('error', () => exit(0, "stdin error"));
      process.stdout.on('error', () => exit(0, "stdout error"));
      process.stderr.on('error', () => exit(0, "stderr error"));

      console.error("[WEB-MCP] Connecting transport...");
      console.error("[WEB-MCP] Process PID:", process.pid);
      console.error("[WEB-MCP] Node version:", process.version);
      console.error("[WEB-MCP] Platform:", process.platform);

      await this.server.connect(transport);
      console.error("[WEB-MCP] Transport connected successfully");

      // Enhanced connection monitoring
      this.keepAliveInterval = setInterval(() => {
        console.error("[WEB-MCP] Heartbeat - transport active, sessions:", this.sessions.size);
      }, 30000); // Every 30 seconds

      // Keep process alive with multiple fallbacks
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      process.on("disconnect", () => exit(0, "process disconnected"));
      process.on("SIGPIPE", () => exit(0, "SIGPIPE"));

      console.error("[WEB-MCP] Server ready for requests");
    } catch (error) {
      console.error("[WEB-MCP] Failed to connect transport:", error);
      console.error("[WEB-MCP] Error details:", error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}