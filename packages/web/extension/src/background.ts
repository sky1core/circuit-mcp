// Circuit MCP Bridge - Background Service Worker
// Handles Chrome Debugger API and coordinates with offscreen document
// Architecture: Session multiplexing via sessionId

// ============================================================================
// Types (must match relay-server.ts and offscreen.ts)
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
}

// ============================================================================
// Session State
// ============================================================================

interface SessionInfo {
  sessionId: string;
  relayUrl: string;
  attachedTabId: number | null;
  lastActivity: number;
}

// Track all active sessions
const sessions: Map<string, SessionInfo> = new Map();

// Track which tab is controlled by which session (1 tab = 1 session rule)
const tabToSession: Map<number, string> = new Map();

// ============================================================================
// Offscreen Document Management
// ============================================================================

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let offscreenCreating: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Maintain persistent WebSocket connections to relay servers',
  });

  try {
    await offscreenCreating;
    console.log('[Background] Offscreen document created');
  } finally {
    offscreenCreating = null;
  }
}

async function sendToOffscreen(message: Record<string, unknown>): Promise<unknown> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

// ============================================================================
// Command Processing
// ============================================================================

async function handleRelayCommand(
  sessionId: string,
  message: RelayMessage
): Promise<void> {
  const { type, id, method, params } = message;

  let result: unknown;
  let error: string | undefined;

  try {
    switch (type) {
      case 'tabs_list':
        result = await listTabs();
        await sendResponseToRelay(sessionId, { type: 'tabs_list', id, tabs: result as any });
        return;

      case 'tab_attach':
        const attachTabId = (params as { tabId: number }).tabId;
        await attachToTab(sessionId, attachTabId);
        await sendResponseToRelay(sessionId, { type: 'tab_attached', id, tabId: attachTabId });
        return;

      case 'tab_detach':
        await detachFromTab(sessionId);
        await sendResponseToRelay(sessionId, { type: 'tab_detached', id });
        return;

      case 'tab_create':
        const createUrl = (params as { url?: string })?.url || 'about:blank';
        const newTab = await chrome.tabs.create({ url: createUrl, active: true });
        await sendResponseToRelay(sessionId, { type: 'tab_created', id, tabId: newTab.id });
        return;

      case 'tab_close': {
        const closeTabId = (params as { tabId: number })?.tabId;
        if (!closeTabId) {
          throw new Error('tab_close requires tabId');
        }
        await chrome.tabs.remove(closeTabId);
        await sendResponseToRelay(sessionId, { type: 'tab_close', id });
        return;
      }

      case 'cdp_command':
        if (!method) {
          throw new Error('CDP command requires method');
        }
        result = await sendCDPCommand(sessionId, method, params);
        await sendResponseToRelay(sessionId, { type: 'cdp_response', id, result });
        return;

      default:
        error = `Unknown command type: ${type}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    await sendResponseToRelay(sessionId, { type: 'error', id, error });
  }
}

async function sendResponseToRelay(
  sessionId: string,
  message: Omit<RelayMessage, 'sessionId'>
): Promise<void> {
  try {
    await sendToOffscreen({
      type: 'sendResponse',
      sessionId,
      responseMessage: message,
    });
  } catch (error) {
    console.error('[Background] Failed to send response to relay:', error);
  }
}

// ============================================================================
// Tab Operations
// ============================================================================

async function listTabs(): Promise<Array<{ id: number; title: string; url: string }>> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => {
      if (tab.id === undefined) return false;
      const url = tab.url || '';
      return !url.startsWith('chrome://') &&
             !url.startsWith('chrome-extension://') &&
             !url.startsWith('edge://') &&
             !(url.startsWith('about:') && url !== 'about:blank');
    })
    .map(tab => ({
      id: tab.id!,
      title: tab.title || 'Untitled',
      url: tab.url || ''
    }));
}

async function attachToTab(sessionId: string, tabId: number): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  // Check 1 tab = 1 session rule
  const existingSessionId = tabToSession.get(tabId);
  if (existingSessionId && existingSessionId !== sessionId) {
    throw new Error(`Tab ${tabId} is already controlled by another session`);
  }

  // Detach from current tab if different
  if (session.attachedTabId !== null && session.attachedTabId !== tabId) {
    await detachFromTab(sessionId);
  }

  try {
    // Activate the tab
    await chrome.tabs.update(tabId, { active: true });

    // Attach debugger if not already attached
    if (!tabToSession.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    }

    // Update state
    session.attachedTabId = tabId;
    session.lastActivity = Date.now();
    tabToSession.set(tabId, sessionId);

    // Update offscreen's session state
    await sendToOffscreen({
      type: 'setAttachedTab',
      sessionId,
      tabId,
    });

    // Show AI badge
    showAIBadgeOnTab(tabId);

    console.log(`[Background] Attached session ${sessionId} to tab ${tabId}`);
    updateBadge();
  } catch (error) {
    console.error('[Background] Failed to attach to tab:', error);
    throw error;
  }
}

async function detachFromTab(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session || session.attachedTabId === null) {
    return;
  }

  const tabId = session.attachedTabId;

  // Hide AI badge
  hideAIBadgeOnTab(tabId);

  // Detach debugger
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Tab might already be closed
  }

  // Update state
  session.attachedTabId = null;
  tabToSession.delete(tabId);

  // Update offscreen's session state
  await sendToOffscreen({
    type: 'setAttachedTab',
    sessionId,
    tabId: null,
  });

  console.log(`[Background] Detached session ${sessionId} from tab ${tabId}`);
  updateBadge();
}

async function sendCDPCommand(
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  if (session.attachedTabId === null) {
    throw new Error('No tab attached');
  }

  session.lastActivity = Date.now();

  return await chrome.debugger.sendCommand(
    { tabId: session.attachedTabId },
    method,
    params
  );
}

// ============================================================================
// AI Badge
// ============================================================================

async function showAIBadgeOnTab(tabId: number): Promise<void> {
  const badgeScript = `
    (function() {
      const BADGE_ID = 'circuit-ai-control-badge';
      if (document.getElementById(BADGE_ID)) return;
      const badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.innerHTML = '🤖 Circuit MCP';
      badge.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:white;padding:8px 20px;border-radius:8px;z-index:2147483647;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:600;pointer-events:none;';
      document.body.appendChild(badge);
    })();
  `;

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: badgeScript,
      returnByValue: true
    });
  } catch {
    // Ignore - page might not support it
  }
}

async function hideAIBadgeOnTab(tabId: number): Promise<void> {
  const removeScript = `
    (function() {
      const badge = document.getElementById('circuit-ai-control-badge');
      if (badge) badge.remove();
    })();
  `;

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: removeScript,
      returnByValue: true
    });
  } catch {
    // Ignore
  }
}

// ============================================================================
// Extension Badge
// ============================================================================

function updateBadge(): void {
  const sessionCount = sessions.size;
  const attachedCount = Array.from(sessions.values()).filter(s => s.attachedTabId !== null).length;

  let text = '';
  let color = '#9E9E9E';  // Gray - no sessions

  if (attachedCount > 0) {
    color = '#2196F3';  // Blue - attached
    text = attachedCount > 1 ? String(attachedCount) : '!';
  } else if (sessionCount > 0) {
    color = '#4CAF50';  // Green - sessions but not attached
    text = sessionCount > 1 ? String(sessionCount) : '';
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ============================================================================
// CDP Event Handling
// ============================================================================

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return;

  const sessionId = tabToSession.get(source.tabId);
  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  // Inject AI badge on page load
  if (method === 'Page.loadEventFired' || method === 'Page.domContentEventFired') {
    showAIBadgeOnTab(source.tabId);
  }

  // Forward CDP event to relay
  sendResponseToRelay(sessionId, {
    type: 'cdp_event',
    method,
    params: params as Record<string, unknown>
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source.tabId) return;

  const sessionId = tabToSession.get(source.tabId);
  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (session && session.attachedTabId === source.tabId) {
    console.log(`[Background] Debugger detached from tab ${source.tabId}: ${reason}`);
    session.attachedTabId = null;
    tabToSession.delete(source.tabId);
    updateBadge();
  }
});

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Messages from offscreen document
  if (message.source === 'offscreen') {
    (async () => {
      try {
        switch (message.type) {
          case 'relay_connected':
            console.log(`[Background] Relay connected: ${message.relayUrl}`);
            break;

          case 'relay_disconnected':
            console.log(`[Background] Relay disconnected: ${message.relayUrl}`);
            // Force detach all sessions for this relay to prevent stale state
            for (const [sessionId, session] of sessions) {
              if (session.relayUrl === message.relayUrl) {
                if (session.attachedTabId !== null) {
                  const tabId = session.attachedTabId;
                  hideAIBadgeOnTab(tabId);
                  try {
                    await chrome.debugger.detach({ tabId });
                  } catch { /* Tab might be closed */ }
                  tabToSession.delete(tabId);
                  session.attachedTabId = null;
                }
                sessions.delete(sessionId);
              }
            }
            updateBadge();
            break;

          case 'relay_reconnected':
            // Force detach policy: detach all tabs when relay reconnects
            console.log(`[Background] Relay reconnected: ${message.relayUrl}, forcing detach`);
            for (const [sessionId, session] of sessions) {
              if (session.relayUrl === message.relayUrl && session.attachedTabId !== null) {
                const tabId = session.attachedTabId;
                hideAIBadgeOnTab(tabId);
                try {
                  await chrome.debugger.detach({ tabId });
                } catch { /* Tab might be closed */ }
                tabToSession.delete(tabId);
                session.attachedTabId = null;
              }
            }
            updateBadge();
            break;

          case 'session_created':
            // New session from relay
            sessions.set(message.sessionId, {
              sessionId: message.sessionId,
              relayUrl: message.relayUrl,
              attachedTabId: null,
              lastActivity: Date.now(),
            });
            console.log(`[Background] Session created: ${message.sessionId}`);
            updateBadge();
            break;

          case 'session_closed':
            // Session closed by relay
            const closedSession = sessions.get(message.sessionId);
            if (closedSession && closedSession.attachedTabId !== null) {
              hideAIBadgeOnTab(closedSession.attachedTabId);
              try {
                await chrome.debugger.detach({ tabId: closedSession.attachedTabId });
              } catch { /* ignore */ }
              tabToSession.delete(closedSession.attachedTabId);
            }
            sessions.delete(message.sessionId);
            console.log(`[Background] Session closed: ${message.sessionId}`);
            updateBadge();
            break;

          case 'relay_command':
            // Defensive: ensure session exists (may arrive before session_created notification)
            if (!sessions.has(message.sessionId) && message.relayUrl) {
              sessions.set(message.sessionId, {
                sessionId: message.sessionId,
                relayUrl: message.relayUrl,
                attachedTabId: null,
                lastActivity: Date.now(),
              });
              console.log(`[Background] Session auto-created from relay_command: ${message.sessionId}`);
              updateBadge();
            }
            // Command from relay via offscreen
            await handleRelayCommand(message.sessionId, message.message);
            break;
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Background] Error handling offscreen message:', error);
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  // Messages from popup
  (async () => {
    try {
      switch (message.type) {
        case 'getStatus': {
          const offscreenStatus = await sendToOffscreen({ type: 'getStatus' }) as any;
          // Merge connection data with session data so popup gets attachedTabId
          const offscreenConns = (offscreenStatus?.connections || []) as Array<{ url: string; connected: boolean }>;
          const mergedConnections = offscreenConns.map(conn => {
            // Find a session associated with this relay URL
            const session = Array.from(sessions.values()).find(s => s.relayUrl === conn.url);
            return {
              relayUrl: conn.url,
              connected: conn.connected,
              attachedTabId: session?.attachedTabId ?? null,
            };
          });
          sendResponse({
            connections: mergedConnections,
            discoveredRelayUrls: offscreenStatus?.discoveredRelayUrls || [],
          });
          break;
        }

        case 'listTabs':
          const tabs = await listTabs();
          sendResponse({ tabs });
          break;

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return true;
});

// ============================================================================
// Tab Close Handling
// ============================================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  const sessionId = tabToSession.get(tabId);
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      session.attachedTabId = null;
    }
    tabToSession.delete(tabId);
    console.log(`[Background] Tab ${tabId} closed, session ${sessionId} detached`);
    updateBadge();
  }
});

// ============================================================================
// Initialization
// ============================================================================

ensureOffscreenDocument().then(() => {
  console.log('[Background] Initialized with offscreen document');
}).catch(error => {
  console.error('[Background] Failed to create offscreen document:', error);
});

console.log('[Background] Service worker initialized');

// Make this file a module to avoid global scope conflicts
export {};
