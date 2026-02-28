// Extension Driver - CDP-based browser control via Chrome extension
// Implements the same interface as WebDriver but uses CDP commands through relay
// Architecture: Session multiplexing via sessionId

import { Session } from "@sky1core/circuit-core";
import { RelayServer } from './relay-server.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';

export interface ExtensionSession extends Session {
  type: 'extension';
  relaySessionId: string;  // Session ID on the relay server
  relayPort: number;
  activePage: string;
  attachedTabId: number | null;
  networkRequests: Array<{ url: string; method: string; timestamp: number }>;
  consoleMessages: Array<{ type: string; text: string; timestamp: number }>;
  recordedActions: Array<{ type: string; selector?: string; text?: string; timestamp: number }>;
  dialogHandler?: {
    action: 'accept' | 'dismiss';
    promptText?: string;
  };
}

interface CDPNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  children?: CDPNode[];
  attributes?: string[];
}

export class ExtensionDriver {
  private relay: RelayServer;

  constructor(relay: RelayServer) {
    this.relay = relay;
  }

  async connect(timeout?: number): Promise<ExtensionSession> {
    // Create a new session on the relay server
    const relaySessionId = this.relay.createSession();

    const session: ExtensionSession = {
      id: randomUUID(),
      type: 'extension',
      relaySessionId,
      relayPort: this.relay.port,
      activePage: '',
      attachedTabId: null,
      networkRequests: [],
      consoleMessages: [],
      recordedActions: [],
    };

    console.error(`[EXT-DRIVER] Session created: ${relaySessionId} (relay port: ${this.relay.port})`);

    return session;
  }

  async waitForConnection(session: ExtensionSession, timeout?: number): Promise<void> {
    console.error(`[EXT-DRIVER] Waiting for extension connection...`);
    await this.relay.waitForExtension(timeout || 60000);
    console.error(`[EXT-DRIVER] Extension connected`);
  }

  isConnected(session: ExtensionSession): boolean {
    return this.relay.isExtensionConnected();
  }

  async listTabs(session: ExtensionSession): Promise<Array<{ id: number; title: string; url: string }>> {
    return await this.relay.listTabs(session.relaySessionId);
  }

  async attachTab(session: ExtensionSession, tabId: number): Promise<void> {
    await this.relay.attachTab(session.relaySessionId, tabId);
    session.attachedTabId = tabId;
    session.activePage = `tab-${tabId}`;
  }

  async createTab(session: ExtensionSession, url?: string): Promise<number> {
    // Use relay's tab_create command to create a new tab
    // This works even when no tab is attached
    return await this.relay.createTab(session.relaySessionId, url);
  }

  async navigate(session: ExtensionSession, url: string): Promise<void> {
    await this.relay.sendCDPCommand(session.relaySessionId, 'Page.navigate', { url });
    await this.waitForLoad(session);
    this.recordAction(session, 'navigate', undefined, url);
  }

  async click(session: ExtensionSession, selector: string): Promise<void> {
    const { x, y } = await this.getElementCenter(session, selector);

    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 1
    });

    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 1
    });

    this.recordAction(session, 'click', selector);
  }

  async type(session: ExtensionSession, selector: string, text: string): Promise<void> {
    await this.click(session, selector);
    await this.sleep(100);

    // Clear existing text (Ctrl+A on Windows/Linux, Cmd+A on macOS)
    const selectAllModifier = process.platform === 'darwin' ? 4 : 2; // 4=Meta, 2=Ctrl
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      modifiers: selectAllModifier
    });
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      modifiers: selectAllModifier
    });

    // Type text
    for (const char of text) {
      await this.relay.sendCDPCommand(session.relaySessionId, 'Input.insertText', { text: char });
      await this.sleep(10);
    }

    this.recordAction(session, 'type', selector, text);
  }

  async select(session: ExtensionSession, selector: string, value: string): Promise<void> {
    const selectorJson = JSON.stringify(selector);
    const valueJson = JSON.stringify(value);
    await this.evaluate(session, `
      const el = document.querySelector(${selectorJson});
      if (!el) throw new Error('Element not found: ' + ${selectorJson});
      if (!(el instanceof HTMLSelectElement)) throw new Error('Element is not a <select>: ' + ${selectorJson});
      el.value = ${valueJson};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    this.recordAction(session, 'select', selector, value);
  }

  async hover(session: ExtensionSession, selector: string): Promise<void> {
    const { x, y } = await this.getElementCenter(session, selector);

    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x, y
    });

    this.recordAction(session, 'hover', selector);
  }

  async drag(session: ExtensionSession, sourceSelector: string, targetSelector: string): Promise<void> {
    const source = await this.getElementCenter(session, sourceSelector);
    const target = await this.getElementCenter(session, targetSelector);

    // Mouse down on source
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: source.x,
      y: source.y,
      button: 'left',
      clickCount: 1
    });

    await this.sleep(100);

    // Move to target
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: target.x,
      y: target.y,
      button: 'left'
    });

    await this.sleep(100);

    // Release at target
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: target.x,
      y: target.y,
      button: 'left',
      clickCount: 1
    });

    this.recordAction(session, 'drag', `${sourceSelector} to ${targetSelector}`);
  }

  async scroll(session: ExtensionSession, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    const scrollAmount = amount || 500;
    let deltaX = 0, deltaY = 0;

    switch (direction) {
      case 'up': deltaY = -scrollAmount; break;
      case 'down': deltaY = scrollAmount; break;
      case 'left': deltaX = -scrollAmount; break;
      case 'right': deltaX = scrollAmount; break;
    }

    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX,
      deltaY
    });
    this.recordAction(session, 'scroll', undefined, `${direction} ${scrollAmount}`);
  }

  async scrollToElement(session: ExtensionSession, selector: string): Promise<void> {
    // Escape backslashes first, then single quotes for JavaScript string
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    await this.evaluate(session, `document.querySelector('${escapedSelector}')?.scrollIntoView({ block: 'center' })`);
    this.recordAction(session, 'scrollTo', selector);
  }

  async scrollToTop(session: ExtensionSession): Promise<void> {
    await this.evaluate(session, `window.scrollTo(0, 0)`);
    this.recordAction(session, 'scrollToTop');
  }

  async scrollToBottom(session: ExtensionSession): Promise<void> {
    await this.evaluate(session, `window.scrollTo(0, document.body.scrollHeight)`);
    this.recordAction(session, 'scrollToBottom');
  }

  async key(session: ExtensionSession, key: string): Promise<void> {
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key
    });
    await this.relay.sendCDPCommand(session.relaySessionId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key
    });

    this.recordAction(session, 'key', undefined, key);
  }

  async screenshot(session: ExtensionSession, path?: string): Promise<string> {
    const result = await this.relay.sendCDPCommand(session.relaySessionId, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 50
    }) as { data: string };

    // Save to file like web-driver.ts does
    const screenshotPath = path || `screenshot-${Date.now()}.jpeg`;
    await fs.writeFile(screenshotPath, Buffer.from(result.data, 'base64'));

    return screenshotPath;
  }

  async evaluate(session: ExtensionSession, script: string): Promise<unknown> {
    try {
      const result = await this.relay.sendCDPCommand(session.relaySessionId, 'Runtime.evaluate', {
        expression: script,
        returnByValue: true,
        awaitPromise: true
      }) as { result: { value: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };

      // Check for evaluation error
      if (result.exceptionDetails) {
        const errorDesc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown error';

        if (errorDesc.includes('Illegal return statement')) {
          // Retry with IIFE wrapper
          const wrappedScript = `(() => { ${script} })()`;
          const retryResult = await this.relay.sendCDPCommand(session.relaySessionId, 'Runtime.evaluate', {
            expression: wrappedScript,
            returnByValue: true,
            awaitPromise: true
          }) as { result: { value: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };

          if (retryResult.exceptionDetails) {
            const retryErrorDesc = retryResult.exceptionDetails.exception?.description || retryResult.exceptionDetails.text || 'Unknown error';
            throw new Error(`Script evaluation failed: ${retryErrorDesc}`);
          }
          return retryResult.result?.value;
        }

        throw new Error(`Script evaluation failed: ${errorDesc}`);
      }

      return result.result?.value;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If we get "Illegal return statement", wrap in IIFE and retry
      if (errorMessage.includes('Illegal return statement')) {
        const wrappedScript = `(() => { ${script} })()`;
        const retryResult = await this.relay.sendCDPCommand(session.relaySessionId, 'Runtime.evaluate', {
          expression: wrappedScript,
          returnByValue: true,
          awaitPromise: true
        }) as { result: { value: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };

        if (retryResult.exceptionDetails) {
          const retryErrorDesc = retryResult.exceptionDetails.exception?.description || retryResult.exceptionDetails.text || 'Unknown error';
          throw new Error(`Script evaluation failed: ${retryErrorDesc}`);
        }
        return retryResult.result?.value;
      }

      throw error;
    }
  }

  async snapshot(session: ExtensionSession): Promise<string> {
    const result = await this.relay.sendCDPCommand(session.relaySessionId, 'Accessibility.getFullAXTree', {}) as { nodes: unknown[] };
    return JSON.stringify(result.nodes, null, 2);
  }

  async content(session: ExtensionSession): Promise<string> {
    const result = await this.evaluate(session, 'document.documentElement.outerHTML');
    return result as string;
  }

  async textContent(session: ExtensionSession): Promise<string> {
    const result = await this.evaluate(session, 'document.body.innerText');
    return result as string || '';
  }

  async exists(session: ExtensionSession, selector: string): Promise<boolean> {
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const result = await this.evaluate(session, `document.querySelector('${escapedSelector}') !== null`);
    return result as boolean;
  }

  async getText(session: ExtensionSession, selector: string): Promise<string | null> {
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const result = await this.evaluate(session, `document.querySelector('${escapedSelector}')?.textContent ?? null`);
    return result as string | null;
  }

  async getAttribute(session: ExtensionSession, selector: string, attribute: string): Promise<string | null> {
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedAttr = attribute.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const result = await this.evaluate(session, `document.querySelector('${escapedSelector}')?.getAttribute('${escapedAttr}') ?? null`);
    return result as string | null;
  }

  async pdf(session: ExtensionSession): Promise<string> {
    const result = await this.relay.sendCDPCommand(session.relaySessionId, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true
    }) as { data: string };
    return result.data; // Base64 encoded
  }

  async back(session: ExtensionSession): Promise<void> {
    await this.evaluate(session, 'history.back()');
    await this.sleep(500);
    this.recordAction(session, 'back');
  }

  async forward(session: ExtensionSession): Promise<void> {
    await this.evaluate(session, 'history.forward()');
    await this.sleep(500);
    this.recordAction(session, 'forward');
  }

  async refresh(session: ExtensionSession): Promise<void> {
    await this.relay.sendCDPCommand(session.relaySessionId, 'Page.reload', {});
    await this.waitForLoad(session);
    this.recordAction(session, 'refresh');
  }

  async handleDialog(session: ExtensionSession, action: 'accept' | 'dismiss', promptText?: string): Promise<void> {
    // Store handler for future dialogs
    session.dialogHandler = { action, promptText };

    // Also try to handle any currently open dialog
    try {
      await this.relay.sendCDPCommand(session.relaySessionId, 'Page.handleJavaScriptDialog', {
        accept: action === 'accept',
        promptText: promptText || ''
      });
    } catch {
      // No dialog currently open, which is fine
    }
  }

  async resize(session: ExtensionSession, width: number, height: number): Promise<void> {
    await this.relay.sendCDPCommand(session.relaySessionId, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });

    this.recordAction(session, 'resize', undefined, `${width}x${height}`);
  }

  async close(session: ExtensionSession): Promise<void> {
    // Close the attached tab if exists
    if (session.attachedTabId !== null) {
      try {
        await this.evaluate(session, 'window.close()');
      } catch {
        // Ignore errors - tab might already be closed
      }
    }

    try {
      await this.relay.detachTab(session.relaySessionId);
    } catch {
      // Ignore detach errors - extension might already be disconnected
    }
    this.relay.destroySession(session.relaySessionId);
  }

  async newTab(session: ExtensionSession, url?: string): Promise<number> {
    // Use CDP to create a new tab via Runtime.evaluate
    // Then the extension will handle it
    const script = url
      ? `(() => { window.open('${url.replace(/'/g, "\\'")}', '_blank'); return true; })()`
      : `(() => { window.open('about:blank', '_blank'); return true; })()`;

    await this.relay.sendCDPCommand(session.relaySessionId, 'Runtime.evaluate', {
      expression: script,
      returnByValue: true
    });

    // Wait a bit for tab to open
    await this.sleep(500);

    // Get list of tabs and return the newest one
    const tabs = await this.listTabs(session);
    if (tabs.length > 0) {
      return tabs[tabs.length - 1].id;
    }
    throw new Error('Failed to create new tab');
  }

  async closeTab(session: ExtensionSession, tabId: number): Promise<void> {
    // If closing the attached tab, detach first
    if (session.attachedTabId === tabId) {
      await this.relay.detachTab(session.relaySessionId);
      session.attachedTabId = null;
      session.activePage = '';
    }

    // Use dedicated tab_close command which calls chrome.tabs.remove()
    await this.relay.closeTab(session.relaySessionId, tabId);
  }

  async upload(session: ExtensionSession, selector: string, filePath: string): Promise<void> {
    // Get document
    const doc = await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.getDocument', {}) as { root: CDPNode };

    // Query selector
    const queryResult = await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    }) as { nodeId: number };

    if (!queryResult.nodeId) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Set files on the input element
    await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.setFileInputFiles', {
      nodeId: queryResult.nodeId,
      files: [filePath]
    });

    this.recordAction(session, 'upload', selector, filePath);
  }

  // Helper methods
  private async getElementCenter(session: ExtensionSession, selector: string): Promise<{ x: number; y: number }> {
    // Get document
    const doc = await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.getDocument', {}) as { root: CDPNode };

    // Query selector
    const queryResult = await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    }) as { nodeId: number };

    if (!queryResult.nodeId) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Get box model
    const boxModel = await this.relay.sendCDPCommand(session.relaySessionId, 'DOM.getBoxModel', {
      nodeId: queryResult.nodeId
    }) as { model: { content: number[] } };

    const content = boxModel.model.content;
    const x = (content[0] + content[4]) / 2;
    const y = (content[1] + content[5]) / 2;

    return { x, y };
  }

  private async waitForLoad(session: ExtensionSession): Promise<void> {
    // Simple wait for now - could be improved with event listening
    await this.sleep(1000);

    // Check if document is ready
    let attempts = 0;
    while (attempts < 10) {
      const readyState = await this.evaluate(session, 'document.readyState');
      if (readyState === 'complete') {
        return;
      }
      await this.sleep(500);
      attempts++;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private recordAction(session: ExtensionSession, type: string, selector?: string, text?: string): void {
    session.recordedActions.push({
      type,
      selector,
      text,
      timestamp: Date.now()
    });

    // Limit array size
    if (session.recordedActions.length > 500) {
      session.recordedActions.shift();
    }
  }

  // Generate Playwright test from recorded actions
  generatePlaywrightTest(session: ExtensionSession): string {
    // Escape single quotes and backslashes for JavaScript string literals
    const escapeForJs = (str: string | undefined): string => {
      if (!str) return '';
      return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    };

    let testCode = `const { test, expect } = require('@playwright/test');

test('Generated test', async ({ page }) => {
`;

    for (const action of session.recordedActions) {
      switch (action.type) {
        case 'navigate':
          testCode += `  await page.goto('${escapeForJs(action.text)}');\n`;
          break;
        case 'click':
          testCode += `  await page.click('${escapeForJs(action.selector)}');\n`;
          break;
        case 'type':
          testCode += `  await page.fill('${escapeForJs(action.selector)}', '${escapeForJs(action.text)}');\n`;
          break;
        case 'key':
          testCode += `  await page.keyboard.press('${escapeForJs(action.text)}');\n`;
          break;
        case 'hover':
          testCode += `  await page.hover('${escapeForJs(action.selector)}');\n`;
          break;
        case 'select':
          testCode += `  await page.selectOption('${escapeForJs(action.selector)}', '${escapeForJs(action.text)}');\n`;
          break;
        case 'drag': {
          // selector format: "source to target"
          const parts = action.selector?.split(' to ') || [];
          const source = parts[0] || '';
          const target = parts[1] || '';
          testCode += `  await page.dragAndDrop('${escapeForJs(source)}', '${escapeForJs(target)}');\n`;
          break;
        }
        case 'upload':
          testCode += `  await page.setInputFiles('${escapeForJs(action.selector)}', '${escapeForJs(action.text)}');\n`;
          break;
        case 'back':
          testCode += `  await page.goBack();\n`;
          break;
        case 'forward':
          testCode += `  await page.goForward();\n`;
          break;
        case 'refresh':
          testCode += `  await page.reload();\n`;
          break;
        case 'scroll':
          {
            const [direction, amountStr] = (action.text || 'down 500').split(' ');
            const amount = parseInt(amountStr, 10) || 500;
            let x = 0, y = 0;
            if (direction === 'down') y = amount;
            else if (direction === 'up') y = -amount;
            else if (direction === 'right') x = amount;
            else if (direction === 'left') x = -amount;
            testCode += `  await page.evaluate(() => window.scrollBy(${x}, ${y}));\n`;
          }
          break;
        case 'scrollTo':
          testCode += `  await page.locator('${escapeForJs(action.selector)}').scrollIntoViewIfNeeded();\n`;
          break;
        case 'scrollToTop':
          testCode += `  await page.evaluate(() => window.scrollTo(0, 0));\n`;
          break;
        case 'scrollToBottom':
          testCode += `  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));\n`;
          break;
        case 'resize':
          testCode += `  // resize: ${escapeForJs(action.text)}\n`;
          break;
      }
    }

    testCode += `});\n`;
    return testCode;
  }
}
