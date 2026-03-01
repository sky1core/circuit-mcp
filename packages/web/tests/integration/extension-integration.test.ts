/**
 * Integration tests for Extension mode using a Fake Extension WS Client.
 *
 * These tests create a real RelayServer + ExtensionDriver and connect
 * a WebSocket client that simulates the Chrome extension's behavior.
 * This validates the full message flow without needing Chrome APIs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RelayServer, RelayMessage } from '../../src/relay-server.js';
import { ExtensionDriver, ExtensionSession } from '../../src/extension-driver.js';
import WebSocket from 'ws';

// Isolated port range for these tests
const TEST_PORT_START = 19950;
const TEST_PORT_END = 19960;

// ============================================================================
// Fake Extension Client
// ============================================================================

class FakeExtensionClient {
  ws!: WebSocket;
  receivedMessages: RelayMessage[] = [];
  private port: number;
  private messageHandlers = new Map<string, (msg: RelayMessage) => void>();
  private autoRespondCDP = true;
  private cdpResponder: ((method: string, params?: Record<string, unknown>) => unknown) | null = null;
  private manualResponseQueue: Array<{ id: number; result?: unknown; error?: string }> = [];

  constructor(port: number) {
    this.port = port;
  }

  async connect(): Promise<void> {
    // Fetch nonce from HTTP health check for authentication
    // Use Connection: close to avoid keep-alive pool issues across test teardowns
    const res = await fetch(`http://127.0.0.1:${this.port}`, {
      headers: { Connection: 'close' },
    });
    const data = await res.json() as { nonce: string };
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}?nonce=${data.nonce}`);

    // Register handlers BEFORE open to catch messages sent on connection (e.g. session_list)
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as RelayMessage;
      this.receivedMessages.push(msg);

      // System messages (session_list etc.) don't need responses
      if (msg.sessionId === '_system') return;

      // Auto-respond to session_create
      if (msg.type === 'session_create') {
        this.send({ sessionId: msg.sessionId, type: 'session_created' });
        return;
      }

      // Check for registered message handler (takes priority)
      const handler = this.messageHandlers.get(msg.type);
      if (handler) {
        handler(msg);
        return;
      }

      // Auto-respond to any command with an id (CDP commands, tab operations, etc.)
      if (this.autoRespondCDP && msg.id !== undefined) {
        if (msg.type === 'cdp_command') {
          const result = this.cdpResponder
            ? this.cdpResponder(msg.method!, msg.params)
            : {};
          this.send({ sessionId: msg.sessionId, type: 'cdp_response', id: msg.id, result });
        } else if (msg.type === 'tab_detach') {
          this.send({ sessionId: msg.sessionId, type: 'tab_detached', id: msg.id });
        } else if (msg.type === 'tab_close') {
          this.send({ sessionId: msg.sessionId, type: 'tab_close', id: msg.id });
        }
      }
    });

    this.ws.on('ping', () => {
      this.ws.pong();
    });

    await new Promise<void>((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });

    // Wait for connection to be registered on server side
    await this.sleep(50);
  }

  /** Set a handler for a specific message type (e.g., 'tabs_list', 'tab_attach') */
  onMessage(type: string, handler: (msg: RelayMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /** Configure auto CDP responses with a custom responder function */
  setCDPResponder(fn: (method: string, params?: Record<string, unknown>) => unknown): void {
    this.cdpResponder = fn;
  }

  /** Disable auto CDP response (for manual control) */
  disableAutoCDP(): void {
    this.autoRespondCDP = false;
  }

  /** Send a CDP event to the server */
  sendCDPEvent(sessionId: string, method: string, params: Record<string, unknown>): void {
    this.send({ sessionId, type: 'cdp_event', method, params });
  }

  /** Send a raw message */
  send(msg: Partial<RelayMessage>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait for a message of a specific type */
  async waitForMessage(type: string, timeout = 5000): Promise<RelayMessage> {
    // Check already received
    const existing = this.receivedMessages.find(m => m.type === type);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
      const checkInterval = setInterval(() => {
        const found = this.receivedMessages.find(m => m.type === type);
        if (found) {
          clearTimeout(timer);
          clearInterval(checkInterval);
          resolve(found);
        }
      }, 10);
    });
  }

  /** Wait for a message of a specific type that hasn't been seen yet (from offset) */
  async waitForMessageAfter(type: string, afterIndex: number, timeout = 5000): Promise<RelayMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
      const checkInterval = setInterval(() => {
        const found = this.receivedMessages.slice(afterIndex).find(m => m.type === type);
        if (found) {
          clearTimeout(timer);
          clearInterval(checkInterval);
          resolve(found);
        }
      }, 10);
    });
  }

  async close(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const closePromise = new Promise<void>(resolve => this.ws.on('close', resolve));
      this.ws.close();
      await closePromise;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Extension Integration (Fake WS Client)', () => {
  let server: RelayServer;
  let driver: ExtensionDriver;
  let ext: FakeExtensionClient;

  beforeEach(async () => {
    server = new RelayServer({ portRangeStart: TEST_PORT_START, portRangeEnd: TEST_PORT_END });
    await server.start();
    driver = new ExtensionDriver(server);
  });

  afterEach(async () => {
    if (ext) await ext.close().catch(() => {});
    await server.stop();
  });

  // --------------------------------------------------------------------------
  // 1. Session Lifecycle
  // --------------------------------------------------------------------------

  describe('session lifecycle', () => {
    it('should send session_list on extension connect', async () => {
      ext = new FakeExtensionClient(server.port);
      await ext.connect();

      const sessionList = await ext.waitForMessage('session_list');
      expect(sessionList.sessionId).toBe('_system');
      expect(sessionList.sessions).toEqual([]);
    });

    it('should send session_create and receive session_created', async () => {
      ext = new FakeExtensionClient(server.port);
      await ext.connect();

      const session = await driver.connect();
      expect(session.type).toBe('extension');
      expect(session.relaySessionId).toBeDefined();

      // Verify extension received session_create
      const createMsg = await ext.waitForMessage('session_create');
      expect(createMsg.sessionId).toBe(session.relaySessionId);
    });

    it('should send session_close on driver.close()', async () => {
      ext = new FakeExtensionClient(server.port);
      await ext.connect();

      const session = await driver.connect();
      const msgCountBefore = ext.receivedMessages.length;

      await driver.close(session);

      const closeMsg = await ext.waitForMessageAfter('session_close', msgCountBefore);
      expect(closeMsg.sessionId).toBe(session.relaySessionId);
    });

    it('should send tab_close when closing session with attached tab', async () => {
      ext = new FakeExtensionClient(server.port);

      // Set up tab operation handlers
      ext.onMessage('tab_attach', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_attached',
          id: msg.id,
          tabId: (msg.params as { tabId: number }).tabId,
        });
      });

      ext.onMessage('tab_detach', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_detached',
          id: msg.id,
        });
      });

      ext.onMessage('tab_close', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_close',
          id: msg.id,
        });
      });

      await ext.connect();
      const session = await driver.connect();

      // Attach to a tab
      await driver.attachTab(session, 7);
      expect(session.attachedTabId).toBe(7);

      const msgCountBefore = ext.receivedMessages.length;

      // Close session — should send tab_close for attached tab
      await driver.close(session);

      // Verify tab_close was sent for the attached tab
      const tabCloseMsg = await ext.waitForMessageAfter('tab_close', msgCountBefore);
      expect(tabCloseMsg.sessionId).toBe(session.relaySessionId);
      expect(tabCloseMsg.params).toEqual({ tabId: 7 });
    });

    it('should include existing sessions in session_list for new extension', async () => {
      // Create session before extension connects
      const sessionId = server.createSession();

      ext = new FakeExtensionClient(server.port);
      await ext.connect();

      const sessionList = await ext.waitForMessage('session_list');
      expect(sessionList.sessions).toHaveLength(1);
      expect(sessionList.sessions![0].sessionId).toBe(sessionId);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Tab Operations (#9 coverage)
  // --------------------------------------------------------------------------

  describe('tab operations', () => {
    let session: ExtensionSession;

    beforeEach(async () => {
      ext = new FakeExtensionClient(server.port);

      // Set up tab operation handlers
      ext.onMessage('tabs_list', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tabs_list',
          id: msg.id,
          tabs: [
            { id: 1, title: 'Tab 1', url: 'https://example.com/1' },
            { id: 2, title: 'Tab 2', url: 'https://example.com/2' },
          ],
        });
      });

      ext.onMessage('tab_attach', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_attached',
          id: msg.id,
          tabId: (msg.params as { tabId: number }).tabId,
        });
      });

      ext.onMessage('tab_detach', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_detached',
          id: msg.id,
        });
      });

      ext.onMessage('tab_create', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_created',
          id: msg.id,
          tabId: 42,
        });
      });

      ext.onMessage('tab_close', (msg) => {
        ext.send({
          sessionId: msg.sessionId,
          type: 'tab_close',
          id: msg.id,
        });
      });

      await ext.connect();
      session = await driver.connect();
    });

    it('should list tabs', async () => {
      const tabs = await driver.listTabs(session);
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toEqual({ id: 1, title: 'Tab 1', url: 'https://example.com/1' });
      expect(tabs[1]).toEqual({ id: 2, title: 'Tab 2', url: 'https://example.com/2' });
    });

    it('should attach to a tab and update session', async () => {
      await driver.attachTab(session, 1);
      expect(session.attachedTabId).toBe(1);
      expect(session.activePage).toBe('tab-1');
    });

    it('should create a new tab and return tabId', async () => {
      const tabId = await driver.createTab(session, 'https://example.com/new');
      expect(tabId).toBe(42);
    });

    it('should close a tab', async () => {
      await driver.closeTab(session, 1);
      // No error means success
    });
  });

  // --------------------------------------------------------------------------
  // 3. CDP Commands and Events (#5 coverage)
  // --------------------------------------------------------------------------

  describe('CDP commands and events', () => {
    let session: ExtensionSession;

    beforeEach(async () => {
      ext = new FakeExtensionClient(server.port);
      await ext.connect();
      session = await driver.connect();
    });

    it('should send CDP command and receive response', async () => {
      ext.setCDPResponder((method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      });

      const result = await server.sendCDPCommand(
        session.relaySessionId,
        'DOM.getDocument',
        {}
      );
      expect(result).toEqual({ root: { nodeId: 1 } });
    });

    it('should populate networkRequests from CDP events', async () => {
      expect(session.networkRequests).toHaveLength(0);

      // Send network event
      ext.sendCDPEvent(session.relaySessionId, 'Network.requestWillBeSent', {
        request: { url: 'https://example.com/api', method: 'POST' },
      });

      // Wait for event to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(session.networkRequests).toHaveLength(1);
      expect(session.networkRequests[0].url).toBe('https://example.com/api');
      expect(session.networkRequests[0].method).toBe('POST');
    });

    it('should populate consoleMessages from CDP events', async () => {
      expect(session.consoleMessages).toHaveLength(0);

      ext.sendCDPEvent(session.relaySessionId, 'Runtime.consoleAPICalled', {
        type: 'warn',
        args: [{ value: 'test' }, { value: 'message' }],
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(session.consoleMessages).toHaveLength(1);
      expect(session.consoleMessages[0].type).toBe('warn');
      expect(session.consoleMessages[0].text).toBe('test message');
    });

    it('should cap networkRequests at 100', async () => {
      // Send 105 events
      for (let i = 0; i < 105; i++) {
        ext.sendCDPEvent(session.relaySessionId, 'Network.requestWillBeSent', {
          request: { url: `https://example.com/${i}`, method: 'GET' },
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(session.networkRequests).toHaveLength(100);
      // First 5 should have been shifted out
      expect(session.networkRequests[0].url).toBe('https://example.com/5');
      expect(session.networkRequests[99].url).toBe('https://example.com/104');
    });

    it('should cap consoleMessages at 100', async () => {
      for (let i = 0; i < 105; i++) {
        ext.sendCDPEvent(session.relaySessionId, 'Runtime.consoleAPICalled', {
          type: 'log',
          args: [{ value: `msg-${i}` }],
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(session.consoleMessages).toHaveLength(100);
      expect(session.consoleMessages[0].text).toBe('msg-5');
      expect(session.consoleMessages[99].text).toBe('msg-104');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Concurrent createTab (#9 race condition)
  // --------------------------------------------------------------------------

  describe('concurrent createTab', () => {
    it('should resolve each promise with the correct tabId even with out-of-order responses', async () => {
      ext = new FakeExtensionClient(server.port);
      ext.disableAutoCDP();

      // Collect tab_create messages and respond in reverse order
      const pendingCreates: RelayMessage[] = [];
      ext.onMessage('tab_create', (msg) => {
        pendingCreates.push(msg);

        // When we have 2, respond in reverse order
        if (pendingCreates.length === 2) {
          // Respond to second request first (tabId: 200)
          ext.send({
            sessionId: pendingCreates[1].sessionId,
            type: 'tab_created',
            id: pendingCreates[1].id,
            tabId: 200,
          });

          // Then respond to first request (tabId: 100)
          setTimeout(() => {
            ext.send({
              sessionId: pendingCreates[0].sessionId,
              type: 'tab_created',
              id: pendingCreates[0].id,
              tabId: 100,
            });
          }, 10);
        }
      });

      await ext.connect();
      const session = await driver.connect();

      // Fire both concurrently
      const [tab1, tab2] = await Promise.all([
        driver.createTab(session, 'https://first.com'),
        driver.createTab(session, 'https://second.com'),
      ]);

      // Each should get the correct tabId despite out-of-order responses
      expect(tab1).toBe(100);
      expect(tab2).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 5. WS Reconnection Race (#1 regression)
  // --------------------------------------------------------------------------

  describe('WS reconnection race', () => {
    it('should remain connected when old connection closes after new one opens', async () => {
      const session = await driver.connect();

      // First extension connects
      const ext1 = new FakeExtensionClient(server.port);
      await ext1.connect();
      expect(server.isExtensionConnected()).toBe(true);

      // Second extension connects (replaces first)
      ext = new FakeExtensionClient(server.port);
      await ext.connect();
      expect(server.isExtensionConnected()).toBe(true);

      // ext1's close fires (may happen after ext2 is already registered)
      await ext1.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Connection should still be alive via ext2
      expect(server.isExtensionConnected()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Error Handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should throw when sending CDP command without extension', async () => {
      const session = await driver.connect();

      // No extension connected
      await expect(
        server.sendCDPCommand(session.relaySessionId, 'Page.navigate', { url: 'https://example.com' })
      ).rejects.toThrow('Extension not connected');
    });

    it('should throw when sending CDP command for unknown session', async () => {
      ext = new FakeExtensionClient(server.port);
      await ext.connect();

      await expect(
        server.sendCDPCommand('non-existent-session', 'Page.navigate', { url: 'https://example.com' })
      ).rejects.toThrow('Session not found');
    });

    it('should reject pending commands when extension disconnects', async () => {
      ext = new FakeExtensionClient(server.port);
      ext.disableAutoCDP();
      await ext.connect();

      const session = await driver.connect();

      // Send command but don't respond - capture rejection immediately
      let rejected = false;
      let rejectionError: Error | null = null;
      const commandPromise = server.sendCDPCommand(
        session.relaySessionId,
        'Page.navigate',
        { url: 'https://example.com' }
      ).catch(e => {
        rejected = true;
        rejectionError = e;
      });

      // Disconnect extension while command is pending
      await ext.close();
      ext = null!;

      // Wait for rejection to propagate
      await commandPromise;

      expect(rejected).toBe(true);
      expect(rejectionError?.message).toBe('Extension disconnected');
    });
  });
});
