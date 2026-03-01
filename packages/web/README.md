# @sky1core/circuit-web

Web browser automation MCP server for AI agents. Control browsers via Playwright or connect to the user's actual Chrome browser via extension.

## Quick Start

```json
{
  "mcpServers": {
    "circuit-web": {
      "command": "npx",
      "args": ["-y", "@sky1core/circuit-web"]
    }
  }
}
```

## Two Modes

### Playwright Mode (default)
Launch and control new browser instances (Chromium, Firefox, WebKit).

```javascript
browser_launch({ headed: true, browser: "chromium" })
browser_navigate({ sessionId: "...", url: "https://example.com" })
click({ sessionId: "...", selector: "button.submit" })
screenshot({ sessionId: "..." })
```

### Extension Mode
Control the user's actual Chrome browser with existing login sessions.

```json
{
  "mcpServers": {
    "circuit-web": {
      "command": "npx",
      "args": ["-y", "@sky1core/circuit-web", "--extension"]
    }
  }
}
```

**Chrome Extension Setup:**
1. Open `chrome://extensions` → Enable Developer mode
2. Click "Load unpacked" → Select `node_modules/@sky1core/circuit-web/extension`
3. The extension auto-discovers the relay server

```javascript
browser_connect()  // Connect to user's Chrome
browser_navigate({ sessionId: "...", url: "https://github.com" })
// Control pages with existing cookies, login sessions, etc.
```

## Tools (35)

### Browser Lifecycle
| Tool | Description |
|------|-------------|
| `browser_launch` | Launch new browser (Playwright) |
| `browser_connect` | Connect to Chrome via extension |
| `browser_navigate` | Navigate to URL |
| `close` | Close session |

### Interaction
| Tool | Description |
|------|-------------|
| `click` | Click element |
| `type` | Type text into element |
| `hover` | Hover over element |
| `drag` | Drag element to target |
| `key` | Press keyboard key |
| `select` | Select dropdown option |
| `upload` | Upload file |

### Content & Inspection
| Tool | Description |
|------|-------------|
| `screenshot` | Take screenshot (JPEG compression supported) |
| `snapshot` | Get accessibility tree |
| `pdf` | Generate PDF |
| `content` | Get HTML content |
| `text_content` | Get visible text |
| `element_exists` | Check if element exists (fast) |
| `element_text` | Get element text (fast) |
| `element_attribute` | Get element attribute (fast) |
| `evaluate` | Execute JavaScript |

### Navigation
| Tool | Description |
|------|-------------|
| `back` | Navigate back |
| `forward` | Navigate forward |
| `refresh` | Reload page |

### Scrolling
| Tool | Description |
|------|-------------|
| `scroll` | Scroll in direction |
| `scroll_to_element` | Scroll to element |
| `scroll_to_top` | Scroll to top |
| `scroll_to_bottom` | Scroll to bottom |

### Tab Management
| Tool | Description |
|------|-------------|
| `browser_tab_new` | Create new tab |
| `browser_tab_list` | List all tabs |
| `browser_tab_select` | Switch tab |
| `browser_tab_close` | Close tab |

### Browser Control
| Tool | Description |
|------|-------------|
| `browser_resize` | Resize viewport |
| `browser_handle_dialog` | Handle alert/confirm/prompt |
| `wait_for_selector` | Wait for element |
| `browser_network_requests` | Get network history |
| `browser_console_messages` | Get console history |

## CLI Options

```
npx @sky1core/circuit-web [options]

Options:
  --browser <type>    Browser engine: chromium, firefox, webkit (default: chromium)
  --headed            Run in headed mode (default: headless)
  --extension         Enable Chrome extension mode
  --output-dir <dir>  Directory for screenshot/pdf output
  --name <name>       Server name for MCP handshake
```

## Links

- GitHub: https://github.com/sky1core/circuit-mcp
- Issues: https://github.com/sky1core/circuit-mcp/issues
