# IPC Contract

All communication between the renderer and the main process uses Electron's `ipcRenderer.invoke` / `ipcMain.handle` (request-response) or `ipcRenderer.on` / `webContents.send` (push events).

The preload script (`electron/preload.ts`) exposes these as typed methods on `window.electron`. The full TypeScript interface is in `src/types/electron.d.ts`.

---

## Setup

| Channel | Direction | Description |
|---------|-----------|-------------|
| `setup:check` | invoke | Pre-flight check: Node.js, jiva-core, config |

**`setup:check` return:**
```typescript
{
  nodejs:   { ok: boolean; version?: string }
  jivaCore: { ok: boolean; version?: string }
  config:   { ok: boolean; path: string }
  platform: string   // 'win32' | 'darwin' | 'linux'
}
```

---

## Jiva Server Lifecycle

| Channel | Direction | Description |
|---------|-----------|-------------|
| `jiva:server:start` | invoke | Initialize JivaRunner (load jiva-core, start DualAgent) |
| `jiva:server:stop` | invoke | Cleanup agent and MCP servers |
| `jiva:server:restart` | invoke | Stop then start |
| `jiva:server:status` | invoke | Returns `{ status: ServerStatus; port: number }` |
| `jiva:server:status-changed` | push | Renderer receives status updates from runner |
| `jiva:phase-update` | push | Agent phase updates during inference (`thinking`, `calling-tool`, etc.) |

**`ServerStatus`:** `'stopped' | 'starting' | 'running' | 'error'`

---

## Chat / Messaging

| Channel | Direction | Description |
|---------|-----------|-------------|
| `jiva:send-message` | invoke | Send a prompt; returns full result when complete |
| `jiva:reset-conversation` | invoke | Start a new conversation (clears agent memory) |
| `jiva:load-conversation` | invoke | Load a saved conversation by ID into the agent |

**`jiva:send-message` payload:** `(prompt: string, persona?: string)`
**`jiva:send-message` return:** `{ success: boolean; result?: AgentResult; conversationId?: string; error?: string }`

---

## Conversations

| Channel | Direction | Description |
|---------|-----------|-------------|
| `conversations:list` | invoke | List saved conversations from `~/.jiva/conversations/` |
| `conversations:load` | invoke | Read a conversation JSON by ID |

**`conversations:list` return:**
```typescript
Array<{
  id: string
  summary: string       // title from metadata, or first user message (truncated to 60 chars)
  messageCount: number
  lastModified: number  // ms timestamp
}>
```

---

## Personas

| Channel | Direction | Description |
|---------|-----------|-------------|
| `personas:list` | invoke | List all persona directories from `~/.jiva/personas/` |
| `personas:activate` | invoke | Activate a persona and switch the agent's context |
| `personas:active` | invoke | Get the currently active persona name |

**`personas:list` return:** `PersonaInfo[]` (see `electron/persona-manager.ts`)

---

## Configuration

| Channel | Direction | Description |
|---------|-----------|-------------|
| `config:read` | invoke | Read `JivaConfig` from the platform-specific path |
| `config:write` | invoke | Write `JivaConfig` to the platform-specific path |

Config is read from / written to `getJivaConfigPath()` — see `electron/config-manager.ts`.

---

## MCP Server Management

| Channel | Direction | Description |
|---------|-----------|-------------|
| `mcp:list-status` | invoke | List all MCP servers with runtime connection status |
| `mcp:get-tools` | invoke | Get all tools exposed by connected MCP servers |
| `mcp:add-server` | invoke | Add a new MCP server (stdio or HTTP) to config and runtime |
| `mcp:remove-server` | invoke | Remove an MCP server from config and runtime |
| `mcp:toggle-server` | invoke | Enable or disable an MCP server |
| `mcp:reconnect-server` | invoke | Reconnect a specific MCP server |

**`mcp:list-status` return item:**
```typescript
{
  name: string
  enabled: boolean
  connected: boolean
  toolCount: number
  command: string        // stdio servers
  args: string[]
  env: Record<string, string>
  url?: string           // HTTP servers
  type: 'stdio' | 'http'
  error?: string
}
```

---

## Workspace / File Browser

| Channel | Direction | Description |
|---------|-----------|-------------|
| `workspace:get-dir` | invoke | Get the configured workspace directory |
| `workspace:set-dir` | invoke | Set the workspace directory (persisted to config) |
| `workspace:pick-dir` | invoke | Open native folder picker dialog |
| `workspace:list-files` | invoke | List files in a directory (restricted to `$HOME`) |
| `workspace:read-file` | invoke | Read a file's text content (max 500 KB) |
| `workspace:open-external` | invoke | Reveal a file in the native file manager |

---

## Window Controls

| Channel | Direction | Description |
|---------|-----------|-------------|
| `window:minimize` | invoke | Minimize the window |
| `window:maximize` | invoke | Toggle maximize/restore |
| `window:close` | invoke | Close the window |
| `window:isMaximized` | invoke | Returns `boolean` |

---

## System / Native Events

| Channel | Direction | Description |
|---------|-----------|-------------|
| `native-theme-changed` | push | System light/dark mode changed; payload: `isDark: boolean` |

---

## Notes

- All invoke handlers return `{ success: boolean; error?: string }` on failure unless otherwise specified.
- Push events use `ipcRenderer.on` in the preload and are exposed as `onXxx(callback)` methods on `window.electron`.
- The `persona` parameter on `jiva:send-message` is accepted but intentionally ignored to avoid destroying conversation history mid-chat. Use `personas:activate` for explicit persona switches.
