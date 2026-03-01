# @sky1core/circuit-electron

Electron desktop app automation MCP server for AI agents. Launch and control any Electron application — packaged apps or development projects.

## Quick Start

```json
{
  "mcpServers": {
    "circuit-electron": {
      "command": "npx",
      "args": ["-y", "@sky1core/circuit-electron"]
    }
  }
}
```

## Usage

### Packaged Apps
```javascript
app_launch({ app: "/Applications/Visual Studio Code.app" })
click({ sessionId: "...", selector: "[title='New File']" })
screenshot({ sessionId: "..." })
```

### Development Mode
```javascript
app_launch({
  app: "/path/to/electron-project",
  mode: "development"
})
```

### Electron Forge
```javascript
// Start dev server first: npm run start
// Then connect with MCP:
app_launch({
  app: "/path/to/forge-project",
  mode: "development"
})
```

## Tools (32)

### App Lifecycle
| Tool | Description |
|------|-------------|
| `app_launch` | Launch Electron app (packaged or dev mode) |
| `get_windows` | List all windows |
| `close` | Close session |

### Interaction
| Tool | Description |
|------|-------------|
| `click` | Click element by selector |
| `click_by_text` | Click by text content |
| `click_by_role` | Click by ARIA role |
| `click_nth` | Click nth matching element |
| `smart_click` | Smart click (auto-detect target) |
| `type` | Type text into element |
| `hover` | Hover over element |
| `drag` | Drag element to target |
| `key` | Press keyboard key |
| `keyboard_press` | Press key with modifiers |
| `keyboard_type` | Type with delay |
| `select` | Select dropdown option |
| `upload` | Upload file |

### Content & Inspection
| Tool | Description |
|------|-------------|
| `screenshot` | Take screenshot (JPEG compression supported) |
| `snapshot` | Get accessibility tree |
| `content` | Get HTML content |
| `text_content` | Get visible text |
| `evaluate` | Execute JavaScript |

### Navigation & Waiting
| Tool | Description |
|------|-------------|
| `back` | Navigate back |
| `forward` | Navigate forward |
| `refresh` | Reload page |
| `wait_for_selector` | Wait for element |
| `wait_for_load_state` | Wait for page state (load, networkidle) |
| `add_locator_handler` | Handle recurring modals/dialogs |

### Electron-Specific
| Tool | Description |
|------|-------------|
| `ipc_invoke` | Call IPC method |
| `fs_write_file` | Write file in app context |
| `fs_read_file` | Read file in app context |

### Monitoring
| Tool | Description |
|------|-------------|
| `browser_network_requests` | Get network history |
| `browser_console_messages` | Get console history |

## CLI Options

```
npx @sky1core/circuit-electron [options]

Options:
  --name <name>  Server name for MCP handshake (default: circuit-electron)
```

## Links

- GitHub: https://github.com/sky1core/circuit-mcp
- Issues: https://github.com/sky1core/circuit-mcp/issues
