// Circuit MCP Bridge - Offscreen Document
// Maintains persistent WebSocket connections to relay servers
// Architecture: Single WS per relay, session multiplexing via sessionId

// ============================================================================
// Types (must match relay-server.ts)
// ============================================================================

type MessageType =
  | 'session_create'
  | 'session_created'
  | 'session_close'
  | 'session_list'
  | 'session_sync'
  | 'cdp_command'
  | 'cdp_response'
  | 'cdp_event'
  | 'tabs_list'
  | 'tab_attach'
  | 'tab_attached'
  | 'tab_detach'
  | 'tab_detached'
  | 'tab_create'
  | 'tab_created'
  | 'tab_close'
  | 'error';

interface RelayMessage {
  sessionId: string;
  type: MessageType;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  tabs?: Array<{ id: number; title: string; url: string }>;
  tabId?: number;
  sessions?: Array<{ sessionId: string; attachedTabId: number | null }>;
}

// ============================================================================
// Connection State
// ============================================================================

interface RelayConnection {
  url: string;
  ws: WebSocket | null;
  connected: boolean;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  lastConnectAttempt: number;
  hadError: boolean;
}

// Session state tracked on extension side
interface SessionState {
  sessionId: string;
  relayUrl: string;
  attachedTabId: number | null;
}

// Port range for relay discovery
const PORT_RANGE_START = 19989;
const PORT_RANGE_END = 19999;

// Reconnection settings
const RECONNECT_DELAY_MS = 3000; // 3 seconds after disconnect
const SCAN_INTERVAL_MS = 5000;   // 5 seconds for port scanning

// Connection state: one WebSocket per relay URL
const connections: Map<string, RelayConnection> = new Map();

// Sessions known to extension (synced from relay servers)
const sessions: Map<string, SessionState> = new Map();

// Known relay ports (for faster scanning)
const knownRelayPorts: Set<number> = new Set();

// ============================================================================
// Relay Discovery
// ============================================================================

async function testRelayHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.type === 'circuit-relay';
    }
    return false;
  } catch {
    return false;
  }
}

async function scanForRelays(): Promise<string[]> {
  const foundRelays: string[] = [];

  // Check known ports first
  for (const port of knownRelayPorts) {
    const isAvailable = await testRelayHealth(port);
    if (isAvailable) {
      foundRelays.push(`ws://127.0.0.1:${port}`);
    } else {
      knownRelayPorts.delete(port);
    }
  }

  // Scan all ports
  const scanPromises = [];
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (knownRelayPorts.has(port)) continue;
    scanPromises.push(
      testRelayHealth(port).then(isAvailable => ({ port, isAvailable }))
    );
  }

  const results = await Promise.all(scanPromises);
  for (const { port, isAvailable } of results) {
    if (isAvailable) {
      foundRelays.push(`ws://127.0.0.1:${port}`);
      knownRelayPorts.add(port);
    }
  }

  return foundRelays;
}

// ============================================================================
// WebSocket Connection Management
// ============================================================================

function getOrCreateConnection(relayUrl: string): RelayConnection {
  let conn = connections.get(relayUrl);
  if (!conn) {
    conn = {
      url: relayUrl,
      ws: null,
      connected: false,
      reconnectTimeout: null,
      lastConnectAttempt: 0,
      hadError: false,
    };
    connections.set(relayUrl, conn);
  }
  return conn;
}

function connect(relayUrl: string): void {
  const conn = getOrCreateConnection(relayUrl);

  // Don't reconnect if already connected or connecting
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // Clear any pending reconnect
  if (conn.reconnectTimeout) {
    clearTimeout(conn.reconnectTimeout);
    conn.reconnectTimeout = null;
  }

  conn.lastConnectAttempt = Date.now();
  conn.hadError = false;

  try {
    const ws = new WebSocket(relayUrl);
    conn.ws = ws;

    ws.onopen = () => {
      console.log(`[Offscreen] Connected to relay: ${relayUrl}`);
      conn.connected = true;
      notifyServiceWorker('relay_connected', { relayUrl });
    };

    ws.onmessage = (event) => {
      handleRelayMessage(relayUrl, event.data);
    };

    ws.onerror = () => {
      // Error details are in close event, just mark as error occurred
      conn.hadError = true;
    };

    ws.onclose = () => {
      const wasConnected = conn.connected;
      conn.connected = false;
      conn.ws = null;

      if (wasConnected) {
        // Only log and notify if we were previously connected
        console.log(`[Offscreen] Disconnected from relay: ${relayUrl}`);
        cleanupSessionsForRelay(relayUrl);
        notifyServiceWorker('relay_disconnected', { relayUrl });
      }

      // Only schedule reconnect if we were connected before
      // Otherwise, autoConnect() will retry via health check
      if (wasConnected) {
        scheduleReconnect(relayUrl);
      } else {
        // Failed to connect - remove from connections map
        // autoConnect() will rediscover if relay comes back
        connections.delete(relayUrl);
      }
    };
  } catch {
    // WebSocket creation failed - remove from connections
    // autoConnect() will rediscover if relay comes back
    connections.delete(relayUrl);
  }
}

function scheduleReconnect(relayUrl: string): void {
  const conn = connections.get(relayUrl);
  if (!conn || conn.reconnectTimeout) return;

  conn.reconnectTimeout = setTimeout(() => {
    conn.reconnectTimeout = null;
    connect(relayUrl);
  }, RECONNECT_DELAY_MS);
}

function disconnect(relayUrl: string): void {
  const conn = connections.get(relayUrl);
  if (!conn) return;

  if (conn.reconnectTimeout) {
    clearTimeout(conn.reconnectTimeout);
    conn.reconnectTimeout = null;
  }

  if (conn.ws) {
    conn.ws.close();
    conn.ws = null;
  }

  conn.connected = false;
  cleanupSessionsForRelay(relayUrl);
  connections.delete(relayUrl);
}

function cleanupSessionsForRelay(relayUrl: string): void {
  const toRemove: string[] = [];
  for (const [sessionId, state] of sessions) {
    if (state.relayUrl === relayUrl) {
      toRemove.push(sessionId);
    }
  }
  for (const sessionId of toRemove) {
    sessions.delete(sessionId);
    notifyServiceWorker('session_closed', { sessionId });
  }
}

// ============================================================================
// Message Handling
// ============================================================================

function handleRelayMessage(relayUrl: string, data: string): void {
  try {
    const message = JSON.parse(data) as RelayMessage;
    const { sessionId, type } = message;

    // Handle system messages
    if (sessionId === '_system') {
      handleSystemMessage(relayUrl, message);
      return;
    }

    // Route to appropriate handler
    switch (type) {
      case 'session_create':
        handleSessionCreate(relayUrl, message);
        break;

      case 'session_close':
        handleSessionClose(sessionId);
        break;

      case 'tabs_list':
      case 'tab_attach':
      case 'tab_detach':
      case 'tab_create':
      case 'tab_close':
      case 'cdp_command':
        // Forward to service worker for processing
        notifyServiceWorker('relay_command', {
          relayUrl,
          sessionId,
          message,
        });
        break;

      case 'error':
        console.error(`[Offscreen] Error from relay for session ${sessionId}:`, message.error);
        break;

      default:
        console.warn(`[Offscreen] Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Offscreen] Failed to parse relay message:', error);
  }
}

function handleSystemMessage(relayUrl: string, message: RelayMessage): void {
  if (message.type === 'session_list') {
    // Relay is sending us the list of active sessions (for resync)
    console.log(`[Offscreen] Received session_list from ${relayUrl}:`, message.sessions);

    // Force detach policy: on reconnect, ignore attachedTabId from server
    // The extension side is the source of truth for tab attachment
    // Notify background to force detach all sessions for this relay
    notifyServiceWorker('relay_reconnected', { relayUrl });

    // Update our local session state
    if (message.sessions) {
      // Remove sessions that no longer exist on relay
      for (const [sessionId, state] of sessions) {
        if (state.relayUrl === relayUrl) {
          const stillExists = message.sessions.some(s => s.sessionId === sessionId);
          if (!stillExists) {
            sessions.delete(sessionId);
            notifyServiceWorker('session_closed', { sessionId });
          }
        }
      }

      // Add/update sessions from relay - always set attachedTabId to null on resync
      for (const s of message.sessions) {
        const existing = sessions.get(s.sessionId);
        if (!existing) {
          sessions.set(s.sessionId, {
            sessionId: s.sessionId,
            relayUrl,
            attachedTabId: null, // Force detach policy
          });
          notifyServiceWorker('session_created', {
            sessionId: s.sessionId,
            relayUrl,
          });
        } else {
          existing.attachedTabId = null; // Force detach policy
        }
      }
    }

    // Send sync response
    sendToRelay(relayUrl, {
      sessionId: '_system',
      type: 'session_sync',
    });
  }
}

function handleSessionCreate(relayUrl: string, message: RelayMessage): void {
  const { sessionId } = message;

  // Register the session
  sessions.set(sessionId, {
    sessionId,
    relayUrl,
    attachedTabId: null,
  });

  console.log(`[Offscreen] Session created: ${sessionId}`);

  // Confirm to relay
  sendToRelay(relayUrl, {
    sessionId,
    type: 'session_created',
  });

  // Notify service worker
  notifyServiceWorker('session_created', { sessionId, relayUrl });
}

function handleSessionClose(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state) {
    sessions.delete(sessionId);
    notifyServiceWorker('session_closed', { sessionId });
    console.log(`[Offscreen] Session closed: ${sessionId}`);
  }
}

// ============================================================================
// Outbound Messages
// ============================================================================

function sendToRelay(relayUrl: string, message: RelayMessage): boolean {
  const conn = connections.get(relayUrl);
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  conn.ws.send(JSON.stringify(message));
  return true;
}

function sendSessionResponse(sessionId: string, message: Omit<RelayMessage, 'sessionId'>): boolean {
  const state = sessions.get(sessionId);
  if (!state) {
    console.error(`[Offscreen] Cannot send response: unknown session ${sessionId}`);
    return false;
  }
  return sendToRelay(state.relayUrl, { sessionId, ...message });
}

// ============================================================================
// Service Worker Communication
// ============================================================================

function notifyServiceWorker(type: string, data: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ source: 'offscreen', type, ...data }).catch(() => {
    // Service worker might be temporarily unavailable - this is expected in MV3
  });
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (message.type) {
        case 'getStatus':
          const connList = Array.from(connections.values()).map(c => ({
            url: c.url,
            connected: c.connected,
          }));
          const sessionList = Array.from(sessions.values());
          const discoveredUrls = await scanForRelays();
          sendResponse({
            connections: connList,
            sessions: sessionList,
            discoveredRelayUrls: discoveredUrls,
          });
          break;

        case 'sendResponse':
          // Service worker is sending a response back to relay
          const { sessionId, responseMessage } = message;
          const sent = sendSessionResponse(sessionId, responseMessage);
          sendResponse({ success: sent });
          break;

        case 'setAttachedTab':
          // Update session's attached tab
          const sessionState = sessions.get(message.sessionId);
          if (sessionState) {
            sessionState.attachedTabId = message.tabId;
          }
          sendResponse({ success: true });
          break;

        case 'forceReconnect':
          // Force reconnect to all relays
          for (const conn of connections.values()) {
            if (conn.ws) {
              conn.ws.close();
            }
          }
          await autoConnect();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return true; // Keep channel open for async response
});

// ============================================================================
// Auto-connect Loop
// ============================================================================

async function autoConnect(): Promise<void> {
  const discoveredRelays = await scanForRelays();

  for (const relayUrl of discoveredRelays) {
    const conn = connections.get(relayUrl);
    if (!conn || !conn.connected) {
      connect(relayUrl);
    }
  }
}

// ============================================================================
// Initialization
// ============================================================================

// Start auto-connect loop
autoConnect();
setInterval(autoConnect, SCAN_INTERVAL_MS);

console.log('[Offscreen] Circuit MCP offscreen document started');

// Make this file a module to avoid global scope conflicts
export {};
