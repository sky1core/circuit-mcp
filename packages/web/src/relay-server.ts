// Relay Server for Chrome Extension communication
// WebSocket server that bridges MCP server and Chrome extension
// Architecture: Single WS per extension, session multiplexing via sessionId

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// Message Types
// ============================================================================

export type MessageType =
  // Session lifecycle
  | 'session_create'    // Server → Extension: create new session
  | 'session_created'   // Extension → Server: session creation confirmed
  | 'session_close'     // Bidirectional: close session
  | 'session_list'      // Server → Extension: active sessions (for resync)
  | 'session_sync'      // Extension → Server: session state response

  // CDP operations
  | 'cdp_command'       // Server → Extension
  | 'cdp_response'      // Extension → Server
  | 'cdp_event'         // Extension → Server

  // Tab operations
  | 'tabs_list'
  | 'tab_attach'
  | 'tab_attached'
  | 'tab_detach'
  | 'tab_detached'
  | 'tab_create'        // Server → Extension: create a new tab
  | 'tab_created'       // Extension → Server: new tab created

  // Errors
  | 'error';

export interface RelayMessage {
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
// Session Management
// ============================================================================

export interface RelaySession {
  id: string;
  attachedTabId: number | null;
  createdAt: number;
  lastActivity: number;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
  sessionId: string;
}

// ============================================================================
// Constants
// ============================================================================

// Port range for relay server - extension scans this range
const DEFAULT_PORT_RANGE_START = 19989;
const DEFAULT_PORT_RANGE_END = 19999;

// Session TTL: cleanup sessions inactive for this duration
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (effectively disabled)
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

// WebSocket heartbeat settings
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // Send ping every 30 seconds
const HEARTBEAT_TIMEOUT_MS = 10 * 1000; // Close if no pong within 10 seconds

// ============================================================================
// RelayServer Class
// ============================================================================

export interface RelayServerOptions {
  portRangeStart?: number;
  portRangeEnd?: number;
  sessionTtlMs?: number;
}

export class RelayServer extends EventEmitter {
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;

  // Single extension WebSocket connection (multiplexed)
  private extensionWs: WebSocket | null = null;

  // Sessions managed by this relay
  private sessions: Map<string, RelaySession> = new Map();

  // Pending commands waiting for response
  private pendingCommands: Map<number, PendingCommand> = new Map();
  private commandId = 0;

  // Cleanup interval
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Heartbeat
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private wsAlive: boolean = false;

  private _actualPort: number = 0;
  private portRangeStart: number;
  private portRangeEnd: number;
  private sessionTtlMs: number;

  constructor(options: RelayServerOptions = {}) {
    super();
    this.portRangeStart = options.portRangeStart ?? DEFAULT_PORT_RANGE_START;
    this.portRangeEnd = options.portRangeEnd ?? DEFAULT_PORT_RANGE_END;
    this.sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  }

  get port(): number {
    return this._actualPort;
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    // Find first available port in range
    for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
      try {
        await this.tryStartOnPort(port);
        this.startCleanupInterval();
        return;
      } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
          console.error(`[RELAY] Port ${port} in use, trying next...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error(`No available ports in range ${this.portRangeStart}-${this.portRangeEnd}`);
  }

  private async tryStartOnPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({
            status: 'ok',
            type: 'circuit-relay',
            sessions: this.sessions.size,
            extensionConnected: this.isExtensionConnected()
          }));
        } else {
          res.writeHead(405);
          res.end();
        }
      });

      const wss = new WebSocketServer({ server: httpServer });

      wss.on('error', (error: any) => {
        try { httpServer.close(); } catch { /* ignore */ }
        reject(error);
      });

      httpServer.on('listening', () => {
        this.httpServer = httpServer;
        this.wss = wss;
        this._actualPort = port;
        console.error(`[RELAY] Server listening on http://127.0.0.1:${port}`);

        wss.on('connection', (ws) => {
          this.handleConnection(ws);
        });

        resolve();
      });

      httpServer.on('error', (error: any) => {
        try { wss.close(); } catch { /* ignore */ }
        try { httpServer.close(); } catch { /* ignore */ }
        reject(error);
      });

      httpServer.listen(port, '127.0.0.1');
    });
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, SESSION_CLEANUP_INTERVAL_MS);
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    const staleSessionIds: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const idleTime = now - session.lastActivity;
      if (idleTime > this.sessionTtlMs) {
        staleSessionIds.push(sessionId);
      }
    }

    for (const sessionId of staleSessionIds) {
      console.error(`[RELAY] Cleaning up stale session ${sessionId}`);
      this.destroySession(sessionId);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      if (!this.wsAlive) {
        // No pong received since last ping - connection is dead
        console.error('[RELAY] Heartbeat timeout - closing zombie connection');
        this.extensionWs.terminate();
        return;
      }

      // Send ping
      this.wsAlive = false;
      this.extensionWs.ping();

      // Set timeout for pong response
      this.heartbeatTimeout = setTimeout(() => {
        if (!this.wsAlive && this.extensionWs) {
          console.error('[RELAY] Pong timeout - closing connection');
          this.extensionWs.terminate();
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.wss && !this.httpServer) {
      return;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all pending commands
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Relay server stopped'));
      this.pendingCommands.delete(id);
    }

    // Close extension connection
    if (this.extensionWs) {
      this.extensionWs.close();
      this.extensionWs = null;
    }

    // Clear all sessions
    this.sessions.clear();

    return new Promise((resolve) => {
      const cleanup = () => {
        this.wss = null;
        this.httpServer = null;
        console.error('[RELAY] Server stopped');
        resolve();
      };

      if (this.httpServer) {
        if (this.wss) {
          this.wss.close(() => {
            this.httpServer!.close(cleanup);
          });
        } else {
          this.httpServer.close(cleanup);
        }
      } else if (this.wss) {
        this.wss.close(cleanup);
      } else {
        cleanup();
      }
    });
  }

  // ============================================================================
  // Connection Handling
  // ============================================================================

  private handleConnection(ws: WebSocket): void {
    // Only allow one extension connection at a time
    if (this.extensionWs && this.extensionWs.readyState === WebSocket.OPEN) {
      console.error('[RELAY] Extension already connected, closing old connection');
      this.stopHeartbeat();
      this.extensionWs.close();
    }

    this.extensionWs = ws;
    this.wsAlive = true;
    console.error(`[RELAY] Extension connected (sessions: ${this.sessions.size})`);

    // Start heartbeat
    this.startHeartbeat();

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as RelayMessage;
        this.handleExtensionMessage(message);
      } catch (error) {
        console.error('[RELAY] Failed to parse message:', error);
      }
    });

    ws.on('pong', () => {
      this.wsAlive = true;
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }

      // Keepalive: update all sessions' lastActivity on every pong
      // This prevents session TTL expiration while connection is alive
      const now = Date.now();
      for (const session of this.sessions.values()) {
        session.lastActivity = now;
      }
    });

    ws.on('close', () => {
      this.stopHeartbeat();
      console.error('[RELAY] Extension disconnected');
      if (this.extensionWs === ws) {
        this.extensionWs = null;
      }

      // Reset all session attachedTabId to prevent stale state
      for (const session of this.sessions.values()) {
        session.attachedTabId = null;
      }

      // Immediately reject all pending commands for fast recovery
      for (const [id, pending] of this.pendingCommands) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Extension disconnected'));
        this.pendingCommands.delete(id);
      }

      this.emit('extension_disconnected');
    });

    ws.on('error', (error) => {
      console.error('[RELAY] WebSocket error:', error);
    });

    // Send session list for resynchronization
    this.sendSessionList();

    this.emit('extension_connected');
  }

  private sendSessionList(): void {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const sessions = Array.from(this.sessions.values()).map(s => ({
      sessionId: s.id,
      attachedTabId: s.attachedTabId
    }));

    const message: RelayMessage = {
      sessionId: '_system',
      type: 'session_list',
      sessions
    };

    this.extensionWs.send(JSON.stringify(message));
    console.error(`[RELAY] Sent session_list with ${sessions.length} sessions`);
  }

  private handleExtensionMessage(message: RelayMessage): void {
    const { sessionId, type, id } = message;

    // Handle system messages (sessionId = '_system')
    if (sessionId === '_system') {
      if (type === 'session_sync') {
        // Extension is confirming which sessions it knows about
        console.error('[RELAY] Received session_sync from extension');
        return;
      }
      return;
    }

    // Validate session exists
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[RELAY] Message for unknown session: ${sessionId}`);
      // Send error back to extension
      this.sendToExtension({
        sessionId,
        type: 'error',
        error: `Unknown session: ${sessionId}`
      });
      return;
    }

    // Update session activity
    session.lastActivity = Date.now();

    switch (type) {
      case 'session_created':
        // Extension confirmed session creation
        this.emit('session_ready', sessionId);
        break;

      case 'cdp_response':
      case 'tabs_list':
      case 'tab_attached':
      case 'tab_detached':
      case 'tab_created':
        if (id !== undefined) {
          const pending = this.pendingCommands.get(id);
          if (pending && pending.sessionId === sessionId) {
            clearTimeout(pending.timeout);
            this.pendingCommands.delete(id);

            if (message.error) {
              pending.reject(new Error(message.error));
            } else {
              if (type === 'tabs_list') {
                pending.resolve(message.tabs);
              } else if (type === 'tab_attached') {
                session.attachedTabId = message.tabId || null;
                pending.resolve({ tabId: message.tabId });
              } else if (type === 'tab_detached') {
                session.attachedTabId = null;
                pending.resolve({ success: true });
              } else if (type === 'tab_created') {
                pending.resolve({ tabId: message.tabId });
              } else {
                pending.resolve(message.result);
              }
            }
          }
        }
        break;

      case 'cdp_event':
        this.emit('cdp_event', sessionId, message.method, message.params);
        break;

      case 'error':
        console.error(`[RELAY] Error from extension for session ${sessionId}:`, message.error);
        if (id !== undefined) {
          const pending = this.pendingCommands.get(id);
          if (pending && pending.sessionId === sessionId) {
            clearTimeout(pending.timeout);
            this.pendingCommands.delete(id);
            pending.reject(new Error(message.error || 'Unknown error'));
          }
        }
        break;
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  createSession(): string {
    if (!this._actualPort) {
      throw new Error('Cannot create session: relay server not started. Call start() first.');
    }

    const sessionId = randomUUID();
    const now = Date.now();

    const session: RelaySession = {
      id: sessionId,
      attachedTabId: null,
      createdAt: now,
      lastActivity: now,
    };

    this.sessions.set(sessionId, session);
    console.error(`[RELAY] Session created: ${sessionId} (total: ${this.sessions.size})`);

    // Notify extension about new session
    this.sendToExtension({
      sessionId,
      type: 'session_create'
    });

    return sessionId;
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Notify extension to cleanup
    this.sendToExtension({
      sessionId,
      type: 'session_close'
    });

    // Cancel pending commands for this session
    for (const [id, pending] of this.pendingCommands) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session destroyed'));
        this.pendingCommands.delete(id);
      }
    }

    this.sessions.delete(sessionId);
    console.error(`[RELAY] Session destroyed: ${sessionId}`);
  }

  getSession(sessionId: string): RelaySession | undefined {
    return this.sessions.get(sessionId);
  }

  isExtensionConnected(): boolean {
    return this.extensionWs?.readyState === WebSocket.OPEN;
  }

  // ============================================================================
  // Command Sending
  // ============================================================================

  private sendToExtension(message: RelayMessage): boolean {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.extensionWs.send(JSON.stringify(message));
    return true;
  }

  async sendCommand(
    sessionId: string,
    type: MessageType,
    method?: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected');
    }

    session.lastActivity = Date.now();

    const id = ++this.commandId;
    const message: RelayMessage = { sessionId, type, id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command timeout: ${method || type}`));
      }, 30000);

      this.pendingCommands.set(id, { resolve, reject, timeout, sessionId });
      this.extensionWs!.send(JSON.stringify(message));
    });
  }

  async listTabs(sessionId: string): Promise<Array<{ id: number; title: string; url: string }>> {
    const result = await this.sendCommand(sessionId, 'tabs_list');
    return result as Array<{ id: number; title: string; url: string }>;
  }

  async attachTab(sessionId: string, tabId: number): Promise<void> {
    await this.sendCommand(sessionId, 'tab_attach', undefined, { tabId });
  }

  async detachTab(sessionId: string): Promise<void> {
    await this.sendCommand(sessionId, 'tab_detach');
  }

  async createTab(sessionId: string, url?: string): Promise<number> {
    const result = await this.sendCommand(sessionId, 'tab_create', undefined, { url });
    return (result as { tabId: number }).tabId;
  }

  async sendCDPCommand(sessionId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    return await this.sendCommand(sessionId, 'cdp_command', method, params);
  }

  // Wait for extension to connect
  async waitForExtension(timeout: number = 60000): Promise<void> {
    if (this.extensionWs?.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('extension_connected', onConnect);
        reject(new Error('Timeout waiting for extension connection'));
      }, timeout);

      const onConnect = () => {
        clearTimeout(timeoutId);
        this.removeListener('extension_connected', onConnect);
        resolve();
      };

      this.on('extension_connected', onConnect);
    });
  }
}
