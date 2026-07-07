# API Contract

Jivam's frontend and server communicate over plain HTTP (`fetch`) for
request/response calls and a single WebSocket (`/ws`) for server-pushed
events — no Electron IPC. `src/lib/electron-shim.ts` wraps both behind a
`window.electron.*` API that mirrors the old Electron preload's method shape,
so most components/stores read as if they were still calling IPC.

All REST routes are mounted under `/api/*`; see `server/index.ts` for the
mount points and `server/routes/*.ts` for handlers.

---

## Setup

| Route | Method | Description |
|-------|--------|--------------|
| `/api/setup/check` | GET | Pre-flight check: Node.js, jiva-core, config |

**Return shape:**
```typescript
{
  nodejs:   { ok: boolean; version?: string }
  jivaCore: { ok: boolean; version?: string }
  config:   { ok: boolean; path: string }
  platform: string   // 'win32' | 'darwin' | 'linux'
  jivaVersionMismatch?: boolean
  requiredJivaVersion?: string
}
```

---

## Jiva Server Lifecycle & Chat — `server/routes/jiva.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/jiva/start` | POST | Initialize JivaRunner (load jiva-core, start DualAgent) |
| `/api/jiva/stop` | POST | Cleanup agent and MCP servers |
| `/api/jiva/restart` | POST | Stop then start |
| `/api/jiva/status` | GET | Returns `{ status: ServerStatus }` |
| `/api/jiva/send-message` | POST | Send a prompt; returns full result when complete |
| `/api/jiva/stop-message` | POST | Abort an in-flight message |
| `/api/jiva/reset-conversation` | POST | Start a new conversation (clears agent memory) |
| `/api/jiva/load-conversation` | POST | Load a saved conversation by ID into the agent |

**`ServerStatus`:** `'stopped' | 'starting' | 'running' | 'error'`

---

## Conversations — `server/routes/conversations.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/conversations` | GET | List saved conversations from `~/.jiva/conversations/` |
| `/api/conversations/:id` | GET | Read a conversation JSON by ID |

---

## Personas — `server/routes/personas.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/personas` | GET | List all persona directories from `~/.jiva/personas/` |
| `/api/personas/activate` | POST | Activate a persona and switch the agent's context |
| `/api/personas/active` | GET | Get the currently active persona name |

---

## Configuration — `server/routes/config.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/config` | GET | Read Jivam's own `JivaConfig` (`~/.jivam/config.json`) |
| `/api/config` | POST | Write config |
| `/api/config/path` | GET | Returns the resolved config path |
| `/api/config/setup-provider` | POST | One-click provider setup (Sarvam/Krutrim/Groq/OpenAI-compatible presets — sets model config + adds default MCP servers) |

---

## MCP Server Management — `server/routes/mcp.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/mcp/status` | GET | List all MCP servers with runtime connection status |
| `/api/mcp/tools` | GET | Get all tools exposed by connected MCP servers |
| `/api/mcp/add` | POST | Add a new MCP server (stdio or HTTP) to config and runtime |
| `/api/mcp/remove` | POST | Remove an MCP server from config and runtime |
| `/api/mcp/toggle` | POST | Enable or disable an MCP server |
| `/api/mcp/reconnect` | POST | Reconnect a specific MCP server |

---

## Workspace / File Browser — `server/routes/workspace.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/workspace/dir` | GET | Get the configured workspace directory |
| `/api/workspace/dir` | POST | Set the workspace directory (persisted to config) |
| `/api/workspace/pick-dir` | POST | Open native folder picker (`osascript`/PowerShell/`zenity`/`kdialog` per platform) |
| `/api/workspace/files` | GET | List files in a directory (restricted to `$HOME`) |
| `/api/workspace/file` | GET | Read a file's text content (max 500 KB) |
| `/api/workspace/open-external` | POST | Reveal a file in the native file manager |

---

## Directive — `server/routes/directive.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/directive` | GET | Read the current directive |
| `/api/directive` | POST | Write the directive |

---

## Files / Attachments — `server/routes/files.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/files/convert` | POST | Convert a server-side file path to a format the agent can read |
| `/api/files/upload-and-convert` | POST | Accept `{ files: [{name, data (base64), mimeType}] }`, convert, return results |
| `/api/files/describe-image` | POST | Pass a data URI to the configured vision model for description |

---

## Code Mode — `server/routes/code.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/code/init` | POST | Initialize CodeRunner for a workspace |
| `/api/code/send-message` | POST | Send a code prompt to the CodeAgent |
| `/api/code/stop-message` | POST | Stop an active code agent turn |
| `/api/code/reset-session` | POST | Tear down CodeRunner for a fresh start |
| `/api/code/mcp-for-code` | GET | MCP servers eligible for code mode |
| `/api/code/conversation-id` | GET | Current code-mode conversation ID |
| `/api/code/mcp-selection/:convId` | GET | Per-conversation MCP server selection |
| `/api/code/mcp-selection` | POST | Update per-conversation MCP server selection |

See [code-agent-integration.md](code-agent-integration.md) for the full data
flow (log parsing, event streaming, `deepRun`/`maxIterations` options).

---

## Git — `server/routes/git.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/git/is-repo` | GET | Whether the workspace is a git repo |
| `/api/git/status` | GET | Branch, ahead/behind, changed files |
| `/api/git/diff-file` | GET | Diff for a specific file |
| `/api/git/init-repo` | POST | `git init` the workspace |
| `/api/git/branch-info` | GET | Current branch + upstream tracking |

---

## Cloud Mode — `server/routes/cloud.ts`

| Route | Method | Description |
|-------|--------|--------------|
| `/api/cloud/sign-in` | POST | Supabase email/password sign-in |
| `/api/cloud/sign-up` | POST | Supabase account creation |
| `/api/cloud/sign-out` | POST | Clear session |
| `/api/cloud/init` | POST | Restore/validate a session for cloud-mode chat |

---

## Platform / Version

| Route | Method | Description |
|-------|--------|--------------|
| `/api/platform` | GET | `process.platform` |
| `/api/version` | GET | Jivam's own `package.json` version |

---

## WebSocket Events (`/ws`) — `server/ws.ts`

Server → client push events, dispatched by `electron-shim.ts` to whatever
`onXxx()` listener a store registered (mirrors the old `ipcRenderer.on`
shape):

| Event | Description |
|-------|--------------|
| `jiva:server:status-changed` | Agent status transitions (`starting`, `running`, `error`, etc.) |
| `jiva:phase-update` | Agent's current reasoning phase during inference |
| `jiva:jiva-log` | Raw jiva-core log lines (chat mode) |
| `jiva:code-log` | Raw jiva-core log lines (code mode) — parsed client-side into `CodeEvent`s, see [code-agent-integration.md](code-agent-integration.md) |

`broadcast(type, payload)` in `server/ws.ts` sends `{ type, ...payload }` as
JSON to every connected client.

---

## Notes

- Invoke-style calls generally return `{ success: boolean; error?: string }`
  on failure unless the route's own shape already documents an error field.
- `window.electron.*` in the frontend is 100% backed by this contract — if
  you're adding a capability, add a route here first, then wire it into
  `electron-shim.ts` with the same method name/shape the old Electron API
  would have used, so stores/components don't need special-casing.
