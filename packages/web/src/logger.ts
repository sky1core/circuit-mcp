// Circuit MCP Logger
// Logs all tool calls to ~/.circuit-mcp/logs/YYYY-MM-DD.jsonl

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LogEntry {
  timestamp: string;
  sessionId: string;
  sessionType: 'playwright' | 'extension';
  tool: string;
  params: Record<string, unknown>;
  result?: 'success' | 'error';
  error?: string;
  duration?: number;
}

export class Logger {
  private logDir: string;
  private enabled: boolean = true;

  constructor() {
    this.logDir = path.join(os.homedir(), '.circuit-mcp', 'logs');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('[LOGGER] Failed to create log directory:', error);
      this.enabled = false;
    }
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `${date}.jsonl`);
  }

  log(entry: Omit<LogEntry, 'timestamp'>): void {
    if (!this.enabled) return;

    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      const line = JSON.stringify(fullEntry) + '\n';
      fs.appendFileSync(this.getLogFilePath(), line, 'utf8');
    } catch (error) {
      console.error('[LOGGER] Failed to write log:', error);
    }
  }

  logToolCall(
    sessionId: string,
    sessionType: 'playwright' | 'extension',
    tool: string,
    params: Record<string, unknown>
  ): () => void {
    const startTime = Date.now();

    // Log start
    this.log({
      sessionId,
      sessionType,
      tool,
      params: this.sanitizeParams(params),
    });

    // Return function to log completion
    return (error?: string) => {
      const duration = Date.now() - startTime;
      this.log({
        sessionId,
        sessionType,
        tool,
        params: this.sanitizeParams(params),
        result: error ? 'error' : 'success',
        error,
        duration,
      });
    };
  }

  sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    // Remove sensitive data or large data from logs
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (key === 'sessionId') {
        // Keep sessionId but truncate
        sanitized[key] = typeof value === 'string' ? value.substring(0, 8) + '...' : value;
      } else if (key === 'text' && typeof value === 'string' && value.length > 100) {
        // Truncate long text
        sanitized[key] = value.substring(0, 100) + '...';
      } else if (key === 'script' && typeof value === 'string' && value.length > 200) {
        // Truncate long scripts
        sanitized[key] = value.substring(0, 200) + '...';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  getLogDir(): string {
    return this.logDir;
  }
}

// Singleton instance
export const logger = new Logger();
