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

    it('should create a session with unique ID and token', () => {
      const { sessionId, token, relayUrl } = server.createSession();

      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
      expect(relayUrl).toBe(`ws://127.0.0.1:${server.port}?token=${token}`);
    });

    it('should create multiple sessions with different IDs', () => {
      const session1 = server.createSession();
      const session2 = server.createSession();

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.token).not.toBe(session2.token);
    });

    it('should retrieve session by ID', () => {
      const { sessionId } = server.createSession();
      const session = server.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionId);
    });

    it('should return undefined for non-existent session', () => {
      const session = server.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });

    it('should destroy session', () => {
      const { sessionId } = server.createSession();
      expect(server.getSession(sessionId)).toBeDefined();

      server.destroySession(sessionId);
      expect(server.getSession(sessionId)).toBeUndefined();
    });
  });

  describe('WebSocket connection', () => {
    it('should accept connection without token as pending extension', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });

      // Should be open (not closed with error)
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should reject connection with invalid token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=invalid-token`);

      await new Promise<void>((resolve) => {
        ws.on('close', (code, reason) => {
          expect(code).toBe(4002);
          expect(reason.toString()).toBe('Invalid token');
          resolve();
        });
      });
    });

    it('should accept connection with valid token', async () => {
      const { token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });
        ws.on('error', reject);
      });
    });

    it('should emit extension_connected event on connection', async () => {
      const { sessionId, token } = server.createSession();

      const connectedPromise = new Promise<string>((resolve) => {
        server.on('extension_connected', resolve);
      });

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const connectedSessionId = await connectedPromise;
      expect(connectedSessionId).toBe(sessionId);

      ws.close();
    });

    it('should report extension connected status', async () => {
      const { sessionId, token } = server.createSession();

      expect(server.isExtensionConnected(sessionId)).toBe(false);

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      // Wait a bit for the connection to be registered
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected(sessionId)).toBe(true);

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected(sessionId)).toBe(false);
    });
  });

  describe('command sending', () => {
    it('should throw error when session not found', async () => {
      await expect(server.sendCommand('non-existent', 'Test.method', {}))
        .rejects.toThrow('Session not found');
    });

    it('should throw error when extension not connected', async () => {
      const { sessionId } = server.createSession();

      await expect(server.sendCommand(sessionId, 'Test.method', {}))
        .rejects.toThrow('Extension not connected');
    });

    it('should send command and receive response', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Set up mock response
      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        ws.send(JSON.stringify({
          type: 'cdp_response',
          id: command.id,
          result: { success: true, data: 'test-data' },
        }));
      });

      const result = await server.sendCommand(sessionId, 'Test.method', { arg: 'value' });
      expect(result).toEqual({ success: true, data: 'test-data' });

      ws.close();
    });

    it('should handle command error response', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        ws.send(JSON.stringify({
          type: 'cdp_response',
          id: command.id,
          error: 'Something went wrong',
        }));
      });

      await expect(server.sendCommand(sessionId, 'Test.method', {}))
        .rejects.toThrow('Something went wrong');

      ws.close();
    });

    it.skip('should timeout if no response received', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

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
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.method === 'Extension.listTabs') {
          ws.send(JSON.stringify({
            type: 'tabs_list',
            id: command.id,
            tabs: [
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
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        if (command.method === 'Extension.attachTab') {
          ws.send(JSON.stringify({
            type: 'tab_attached',
            id: command.id,
            tabId: command.params.tabId,
          }));
        }
      });

      await server.attachTab(sessionId, 123);

      const session = server.getSession(sessionId);
      expect(session!.attachedTabId).toBe(123);

      ws.close();
    });
  });

  describe('sendCDPCommand', () => {
    it('should prefix method with CDP.', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      let receivedMethod = '';
      ws.on('message', (data) => {
        const command = JSON.parse(data.toString());
        receivedMethod = command.method;
        ws.send(JSON.stringify({
          type: 'cdp_response',
          id: command.id,
          result: {},
        }));
      });

      await server.sendCDPCommand(sessionId, 'Page.navigate', { url: 'https://example.com' });
      expect(receivedMethod).toBe('CDP.Page.navigate');

      ws.close();
    });
  });

  describe('waitForExtension', () => {
    it('should resolve immediately if extension already connected', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should resolve immediately
      await server.waitForExtension(sessionId, 1000);

      ws.close();
    });

    it('should wait for extension to connect', async () => {
      const { sessionId, token } = server.createSession();

      // Start waiting before connecting
      const waitPromise = server.waitForExtension(sessionId, 5000);

      // Connect after a delay
      setTimeout(() => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);
        ws.on('open', () => {
          setTimeout(() => ws.close(), 100);
        });
      }, 100);

      await waitPromise;
    });

    it('should timeout if extension does not connect', async () => {
      const { sessionId } = server.createSession();

      await expect(server.waitForExtension(sessionId, 100))
        .rejects.toThrow('Timeout waiting for extension connection');
    });

    it('should throw error for non-existent session', async () => {
      await expect(server.waitForExtension('non-existent', 1000))
        .rejects.toThrow('Session not found');
    });
  });

  describe('pending extensions (token-less connection)', () => {
    it('should emit pending_extension_connected event', async () => {
      const eventPromise = new Promise<void>((resolve) => {
        server.on('pending_extension_connected', resolve);
      });

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      await eventPromise;

      const closePromise = new Promise<void>((resolve) => ws.on('close', () => resolve()));
      ws.close();
      await closePromise;
    });

    it('should assign pending extension to new session', async () => {
      // Connect extension without token (pending mode)
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.hasPendingExtension()).toBe(true);

      // Create session - should automatically assign pending extension
      const { sessionId } = server.createSession();

      // Wait for assignment
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.hasPendingExtension()).toBe(false);
      expect(server.isExtensionConnected(sessionId)).toBe(true);

      const closePromise = new Promise<void>((resolve) => ws.on('close', () => resolve()));
      ws.close();
      await closePromise;
    });

    it('should handle multiple pending extensions', async () => {
      // Connect two pending extensions
      const ws1 = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}`);

      // Set up close handlers before open to avoid race conditions
      const closePromise1 = new Promise<void>((resolve) => ws1.on('close', () => resolve()));
      const closePromise2 = new Promise<void>((resolve) => ws2.on('close', () => resolve()));

      await Promise.all([
        new Promise<void>((resolve) => ws1.on('open', () => resolve())),
        new Promise<void>((resolve) => ws2.on('open', () => resolve())),
      ]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create two sessions - each should get one pending extension
      const session1 = server.createSession();
      await new Promise(resolve => setTimeout(resolve, 50));

      const session2 = server.createSession();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected(session1.sessionId)).toBe(true);
      expect(server.isExtensionConnected(session2.sessionId)).toBe(true);

      // Close connections - handlers were already set up
      ws1.close();
      ws2.close();
      await Promise.race([
        Promise.all([closePromise1, closePromise2]),
        new Promise(resolve => setTimeout(resolve, 1000)) // Timeout fallback
      ]);
    });

    it('should add extension to pending pool even if session exists', async () => {
      // Create session first (no pending extension)
      const { sessionId } = server.createSession();
      expect(server.isExtensionConnected(sessionId)).toBe(false);

      // Connect extension without token - should go to pending pool, not auto-assign
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should be in pending pool, session still without extension
      expect(server.hasPendingExtension()).toBe(true);
      expect(server.isExtensionConnected(sessionId)).toBe(false);

      const closePromise = new Promise<void>((resolve) => ws.on('close', () => resolve()));
      ws.close();
      await closePromise;
    });

    it('should skip closed WebSocket in pending pool', async () => {
      // Connect and immediately close (simulating stale connection)
      const ws1 = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws1.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Connect second extension
      const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const closePromise2 = new Promise<void>((resolve) => ws2.on('close', () => resolve()));
      await new Promise<void>((resolve) => ws2.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Close first connection (makes it stale in pending pool)
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create session - should skip closed ws1 and use ws2
      const { sessionId } = server.createSession();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(server.isExtensionConnected(sessionId)).toBe(true);

      ws2.close();
      await closePromise2;
    });
  });

  describe('stop', () => {
    it('should close all connections on stop', async () => {
      const { token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
      });

      await server.stop();
      await closePromise;
    });

    it('should reject pending commands on stop', async () => {
      const { sessionId, token } = server.createSession();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=${token}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send a command but don't respond - catch rejection to prevent unhandled rejection
      let rejected = false;
      let rejectionError: Error | null = null;
      const commandPromise = server.sendCommand(sessionId, 'Test.method', {}).catch((e) => {
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

  it('should include actual port in relayUrl', async () => {
    const testServer = new RelayServer(testOptions);
    await testServer.start();

    const { relayUrl } = testServer.createSession();
    expect(relayUrl).toContain(`:${testServer.port}?`);

    await testServer.stop();
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
