// Circuit MCP Bridge - Content Script
// Shows visual indicator when AI is controlling the tab

const BADGE_ID = 'circuit-ai-control-badge';

function showAIBadge(): void {
  // Remove existing badge if any
  const existing = document.getElementById(BADGE_ID);
  if (existing) {
    existing.remove();
  }

  const badge = document.createElement('div');
  badge.id = BADGE_ID;
  badge.innerHTML = '🤖 AI';
  badge.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #2196F3;
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    z-index: 2147483647;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    pointer-events: none;
    user-select: none;
    animation: circuit-badge-pulse 2s infinite;
  `;

  // Add pulse animation
  const style = document.createElement('style');
  style.id = BADGE_ID + '-style';
  style.textContent = `
    @keyframes circuit-badge-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(badge);
}

function hideAIBadge(): void {
  const badge = document.getElementById(BADGE_ID);
  if (badge) {
    badge.remove();
  }
  const style = document.getElementById(BADGE_ID + '-style');
  if (style) {
    style.remove();
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'showAIBadge') {
    showAIBadge();
    sendResponse({ success: true });
  } else if (message.type === 'hideAIBadge') {
    hideAIBadge();
    sendResponse({ success: true });
  }
  return true;
});
