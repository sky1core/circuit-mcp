import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RelayServer } from '../../src/relay-server.js';
import WebSocket from 'ws';

// Use separate port range for tests to avoid conflicts with running MCP server
const TEST_PORT_RANGE_START = 19970;
const TEST_PORT_RANGE_END = 19980;

describe('RelayServer', () => {
  let server: RelayServer;

  beforeEach(async () => {
    server = new RelayServer({ portRangeStart: TEST_PORT_RANGE_START, portRangeEnd: TEST_PORT_RANGE_END });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('session management', () => {
    it('should throw error when creating session before start()', async () => {
      const unstartedServer = new RelayServer({ portRangeStart: TEST_PORT_RANGE_START, portRangeEnd: TEST_PORT_RANGE_END });

      expect(() => unstartedServer.createSession()).toThrow('Cannot create session: relay server not started');
    });

    it('should create a session with unique ID', () => {
      const sessionId = server.createSession();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should create multiple sessions with different IDs', () => {
      const session1 = server.createSession();
      const session2 = server.createSession();

      expect(session1).not.toBe(session2);
    });

    it('should retrieve session by ID', () => {
      const sessionId = server.createSession();
      const session = server.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionId);
    });

    it('should return undefined for non-existent session', () => {
      const session = server.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });

    it('should destroy session', () => {
      const sessionId = server.createSession();
      expect(server.getSession(sessionId)).toBeDefined();

      server.destroySession(sessionId);
      expect(server.getSession(sessionId)).toBeUndefined();
    });
  });

  describe('WebSocket connection', () => {
    it('should accept extension connection', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });

      // Should be open (not closed with error)
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should emit extension_connected event on connection', async () => {
      const connectedPromise = new Promise<void>((resolve) => {
        server.on('extension_connected', () => resolve());
      });

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await connectedPromise;

      ws.close();
    });

    it('should report extension connected status', async () => {
      expect(server.isExtensionConnected()).toBe(false);

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      // Wait a bit for the connection to be registered
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected()).toBe(true);

      const closePromise = new Promise<void>((resolve) => ws.on('close', () => resolve()));
      ws.close();
      await closePromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected()).toBe(false);
    });
  });

  describe('command sending', () => {
    it('should throw error when session not found', async () => {
      await expect(server.sendCDPCommand('non-existent', 'Test.method', {}))
        .rejects.toThrow('Session not found');
    });

    it('should throw error when extension not connected', async () => {
      const sessionId = server.createSession();

      await expect(server.sendCDPCommand(sessionId, 'Test.method', {}))
        .rejects.toThrow('Extension not connected');
    });

    it('should send command and receive response', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Set up mock response - skip session_create messages
      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.type === 'cdp_command') {
          ws.send(JSON.stringify({
            sessionId: command.sessionId,
            type: 'cdp_response',
            id: command.id,
            result: { success: true, data: 'test-data' },
          }));
        }
      });

      const result = await server.sendCDPCommand(sessionId, 'Test.method', { arg: 'value' });
      expect(result).toEqual({ success: true, data: 'test-data' });

      ws.close();
    });

    it('should handle command error response', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.type === 'cdp_command') {
          ws.send(JSON.stringify({
            sessionId: command.sessionId,
            type: 'cdp_response',
            id: command.id,
            error: 'Something went wrong',
          }));
        }
      });

      await expect(server.sendCDPCommand(sessionId, 'Test.method', {}))
        .rejects.toThrow('Something went wrong');

      ws.close();
    });

    it.skip('should timeout if no response received', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Don't respond to the command - let it timeout
      // Note: This test would take 30 seconds with the default timeout
      // In a real scenario, we might want to make the timeout configurable

      ws.close();
    });
  });

  describe('listTabs', () => {
    it('should return tabs list from extension', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.type === 'tabs_list') {
          ws.send(JSON.stringify({
            sessionId: command.sessionId,
            type: 'cdp_response',
            id: command.id,
            result: [
              { id: 1, title: 'Tab 1', url: 'https://example.com/1' },
              { id: 2, title: 'Tab 2', url: 'https://example.com/2' },
            ],
          }));
        }
      });

      const tabs = await server.listTabs(sessionId);
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toEqual({ id: 1, title: 'Tab 1', url: 'https://example.com/1' });

      ws.close();
    });
  });

  describe('attachTab', () => {
    it('should attach to a tab', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.type === 'tab_attach') {
          ws.send(JSON.stringify({
            sessionId: command.sessionId,
            type: 'cdp_response',
            id: command.id,
            result: { tabId: command.params.tabId },
          }));
        }
      });

      await server.attachTab(sessionId, 123);

      ws.close();
    });
  });

  describe('sendCDPCommand', () => {
    it('should send CDP command with correct method', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      let receivedMethod = '';
      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.type === 'cdp_command') {
          receivedMethod = command.method;
          ws.send(JSON.stringify({
            sessionId: command.sessionId,
            type: 'cdp_response',
            id: command.id,
            result: {},
          }));
        }
      });

      await server.sendCDPCommand(sessionId, 'Page.navigate', { url: 'https://example.com' });
      expect(receivedMethod).toBe('Page.navigate');

      ws.close();
    });
  });

  describe('waitForExtension', () => {
    it('should resolve immediately if extension already connected', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should resolve immediately
      await server.waitForExtension(1000);

      ws.close();
    });

    it('should wait for extension to connect', async () => {
      // Start waiting before connecting
      const waitPromise = server.waitForExtension(5000);

      // Connect after a delay
      setTimeout(() => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.on('open', () => {
          setTimeout(() => ws.close(), 100);
        });
      }, 100);

      await waitPromise;
    });

    it('should timeout if extension does not connect', async () => {
      await expect(server.waitForExtension(100))
        .rejects.toThrow('Timeout waiting for extension connection');
    });
  });

  describe('reconnection race condition', () => {
    it('should not destroy state when old connection close event fires after new connection', async () => {
      const sessionId = server.createSession();

      // Connect first extension
      const ws1 = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws1.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected()).toBe(true);

      // Connect second extension (should replace first)
      const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws2.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Server should still be connected via ws2
      expect(server.isExtensionConnected()).toBe(true);

      // Wait for ws1's close event to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Connection should still be alive (ws1's close didn't destroy ws2's state)
      expect(server.isExtensionConnected()).toBe(true);

      ws2.close();
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });

  describe('stop', () => {
    it('should close all connections on stop', async () => {
      server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
      });

      await server.stop();
      await closePromise;
    });

    it('should reject pending commands on stop', async () => {
      const sessionId = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send a command but don't respond - catch rejection to prevent unhandled rejection
      let rejected = false;
      let rejectionError: Error | null = null;
      const commandPromise = server.sendCDPCommand(sessionId, 'Test.method', {}).catch((e) => {
        rejected = true;
        rejectionError = e;
      });

      // Stop server while command is pending
      await server.stop();

      // Wait for the rejection to be processed
      await commandPromise;

      expect(rejected).toBe(true);
      expect(rejectionError?.message).toBe('Relay server stopped');
    });
  });
});

// Separate describe block for port range tests
// These tests run sequentially to avoid port conflicts
describe.sequential('RelayServer port range selection', () => {
  const testOptions = { portRangeStart: TEST_PORT_RANGE_START, portRangeEnd: TEST_PORT_RANGE_END };

  it('should start on a port within the expected range', async () => {
    const testServer = new RelayServer(testOptions);
    await testServer.start();

    // Should be within port range
    expect(testServer.port).toBeGreaterThanOrEqual(TEST_PORT_RANGE_START);
    expect(testServer.port).toBeLessThanOrEqual(TEST_PORT_RANGE_END);

    await testServer.stop();
    // Wait for socket cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('should find next available port when first is in use', async () => {
    // Use a different port range for this specific test to avoid conflicts with other tests
    const isolatedOptions = { portRangeStart: 19960, portRangeEnd: 19965 };

    // Create first server
    const server1 = new RelayServer(isolatedOptions);
    await server1.start();
    const port1 = server1.port;
    expect(port1).toBe(19960); // Should start at the beginning of range

    // Create second server - should get a different port
    const server2 = new RelayServer(isolatedOptions);
    await server2.start();
    const port2 = server2.port;

    expect(port2).not.toBe(port1);
    expect(port2).toBe(19961); // Should get next available port

    await server2.stop();
    await server1.stop();
    // Wait for socket cleanup
    await new Promise(resolve => setTimeout(resolve, 200));
  });
});
