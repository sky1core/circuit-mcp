// Circuit MCP Bridge - Popup Script
// Supports multiple relay connections for multi-LLM control

interface ConnectionInfo {
  relayUrl: string;
  connected: boolean;
  attachedTabId: number | null;
}

interface StatusResponse {
  connected: boolean;
  attachedTabId: number | null;
  connections: ConnectionInfo[];
  discoveredRelayUrls: string[];
}

class PopupUI {
  private relaysList: HTMLElement;
  private statusBadge: HTMLElement;
  private statusText: HTMLElement;

  constructor() {
    this.relaysList = document.getElementById('relaysList') as HTMLElement;
    this.statusBadge = document.getElementById('statusBadge') as HTMLElement;
    this.statusText = document.getElementById('statusText') as HTMLElement;

    this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getStatus' }) as StatusResponse;
      await this.updateUI(response);
    } catch (error) {
      console.error('Failed to refresh:', error);
    }
  }

  private async updateUI(status: StatusResponse): Promise<void> {
    const connectedCount = status.connections.filter(c => c.connected).length;
    const attachedCount = status.connections.filter(c => c.attachedTabId !== null).length;

    if (attachedCount > 0) {
      this.statusBadge.className = 'status attached';
      this.statusText.textContent = `${attachedCount} Tab${attachedCount > 1 ? 's' : ''} Controlled`;
    } else if (connectedCount > 0) {
      this.statusBadge.className = 'status connected';
      this.statusText.textContent = `${connectedCount} Connected`;
    } else {
      this.statusBadge.className = 'status disconnected';
      this.statusText.textContent = 'Disconnected';
    }

    await this.renderRelaysList(status);
  }

  private async renderRelaysList(status: StatusResponse): Promise<void> {
    this.relaysList.innerHTML = '';

    // Group connections by relay URL
    const connectionsByUrl = new Map<string, ConnectionInfo[]>();
    for (const conn of status.connections) {
      const existing = connectionsByUrl.get(conn.relayUrl) || [];
      existing.push(conn);
      connectionsByUrl.set(conn.relayUrl, existing);
    }

    // Add discovered URLs that aren't connected
    for (const url of status.discoveredRelayUrls) {
      if (!connectionsByUrl.has(url)) {
        connectionsByUrl.set(url, []);
      }
    }

    if (connectionsByUrl.size === 0) {
      this.relaysList.innerHTML = '<div class="relay-item empty">No relays found. Start a circuit-web server.</div>';
      return;
    }

    // Get tab info for attached tabs
    const attachedTabIds = status.connections
      .filter(c => c.attachedTabId !== null)
      .map(c => c.attachedTabId!);

    const tabInfoMap = new Map<number, { title: string; url: string }>();
    if (attachedTabIds.length > 0) {
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id && attachedTabIds.includes(tab.id)) {
            tabInfoMap.set(tab.id, {
              title: tab.title || 'Untitled',
              url: tab.url || ''
            });
          }
        }
      } catch {
        // Ignore errors
      }
    }

    for (const [url, conns] of connectionsByUrl) {
      const connectedConns = conns.filter(c => c.connected);
      const attachedConns = conns.filter(c => c.attachedTabId !== null);
      const isConnected = connectedConns.length > 0;
      const hasAttached = attachedConns.length > 0;

      const relayEl = document.createElement('div');
      let className = 'relay-item';
      if (hasAttached) {
        className += ' attached';
      } else if (isConnected) {
        className += ' connected';
      }
      relayEl.className = className;

      let dotColor = '#999'; // gray = disconnected
      if (isConnected) {
        dotColor = hasAttached ? '#4CAF50' : '#FFC107'; // green = active, yellow = waiting
      }
      const statusDot = `<span style="display:inline-block;width:10px;height:10px;background:${dotColor};border-radius:50%;"></span>`;

      const port = url.match(/:(\d+)/)?.[1] || '?';
      const countBadge = connectedConns.length > 1 ? ` <span style="font-size:10px;color:#888;">(×${connectedConns.length})</span>` : '';

      // Show all attached tabs for this relay
      let tabInfo = '';
      for (const conn of attachedConns) {
        if (conn.attachedTabId) {
          const tab = tabInfoMap.get(conn.attachedTabId);
          if (tab) {
            const shortTitle = tab.title.length > 25 ? tab.title.substring(0, 25) + '...' : tab.title;
            tabInfo += `<div class="relay-tab-info">${this.escapeHtml(shortTitle)}</div>`;
          }
        }
      }

      relayEl.innerHTML = `
        <div class="relay-info">
          <span class="relay-status">${statusDot}</span>
          <span class="relay-port">:${port}${countBadge}</span>
        </div>
        ${tabInfo}
      `;

      this.relaysList.appendChild(relayEl);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new PopupUI();
});
