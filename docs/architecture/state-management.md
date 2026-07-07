# State Management

Jivam uses [Zustand](https://github.com/pmndrs/zustand) for all frontend
state. There are nine stores, each with a single responsibility.

---

## Data Flow Pattern

```
User action
  → Component calls store action
    → Store action calls window.electron.*  (electron-shim.ts → fetch)
      → Server route handler executes (server/routes/*.ts)
        → Returns result
          → Store updates state
            → Component re-renders
```

Push events (server status, phase updates, log streams) follow the reverse
path: server broadcasts over the WebSocket (`server/ws.ts`) →
`electron-shim.ts`'s WebSocket client dispatches to the registered
`onXxx()` callback → store listener updates state. See
[api-contract.md](api-contract.md) for the full WebSocket event list.

---

## Stores

### `useJivaStore` — `src/store/jiva.store.ts`

Manages the jiva-core agent lifecycle and runtime state.

| State | Type | Description |
|-------|------|-------------|
| `serverStatus` | `'stopped' \| 'starting' \| 'running' \| 'error'` | Current agent status |
| `currentPhase` | `string \| null` | Agent's current reasoning phase |
| `isInitializing` | `boolean` | True while `startServer()` is in progress |

| Action | Description |
|--------|-------------|
| `startServer()` | Calls `POST /api/jiva/start`, transitions status through `starting → running` |
| `stopServer()` | Calls `POST /api/jiva/stop` |
| `restartServer()` | Calls `POST /api/jiva/restart` |
| `setServerStatus(status)` | Direct status setter (used by WebSocket listener) |
| `initPhaseListener()` | Registers listeners for `jiva:server:status-changed` and `jiva:phase-update` WebSocket events |

---

### `useChatStore` — `src/store/chat.store.ts`

Manages the chat message history and streaming state for the active session.

| State | Type | Description |
|-------|------|-------------|
| `messages` | `ChatMessage[]` | Array of user and assistant messages |
| `isStreaming` | `boolean` | True while awaiting agent response |
| `streamError` | `string \| null` | Error from the last failed send |

| Action | Description |
|--------|-------------|
| `sendMessage(prompt, persona?)` | Appends user message, calls `POST /api/jiva/send-message`, appends assistant response |
| `clearMessages()` | Clears the message array (used when starting a new conversation) |
| `setMessages(messages)` | Bulk-replaces messages (used when loading a saved conversation) |

**`ChatMessage` shape:**
```typescript
{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  phase?: string       // reasoning phase tag, shown on assistant messages
}
```

---

### `useConversationStore` — `src/store/conversation.store.ts`

Manages the conversation list in the sidebar and the active conversation ID.

| State | Type | Description |
|-------|------|-------------|
| `conversations` | `ConversationSummary[]` | Sidebar list, sorted newest-first |
| `activeId` | `string \| null` | ID of the currently loaded conversation |
| `isLoading` | `boolean` | True while fetching the list |

| Action | Description |
|--------|-------------|
| `loadConversations()` | Calls `GET /api/conversations`, populates `conversations` |
| `selectConversation(id)` | Calls `GET /api/conversations/:id` + `POST /api/jiva/load-conversation`, sets `activeId`, loads messages into `useChatStore` |
| `newConversation()` | Calls `POST /api/jiva/reset-conversation`, clears messages, sets `activeId = null` |
| `refreshConversations()` | Re-fetches the list (called after a chat completes to capture new titles) |

---

### `usePersonaStore` — `src/store/persona.store.ts`

Manages the persona list and active persona.

| State | Type | Description |
|-------|------|-------------|
| `personas` | `PersonaInfo[]` | All discovered personas from `~/.jiva/personas/` |
| `activePersona` | `string \| null` | Name of the currently active persona |
| `isLoading` | `boolean` | True while fetching |

| Action | Description |
|--------|-------------|
| `loadPersonas()` | Calls `GET /api/personas` and `GET /api/personas/active`, populates state |
| `activatePersona(name)` | Calls `POST /api/personas/activate`, updates `activePersona` |

---

### `useSettingsStore` — `src/store/settings.store.ts`

Manages UI preferences. Persisted to `localStorage` via Zustand's `persist` middleware.

| State | Type | Description |
|-------|------|-------------|
| `theme` | `'light' \| 'dark' \| 'system'` | Active color theme |
| `modelConfig` | `ModelConfig \| null` | Cached model configuration for the Settings UI |

| Action | Description |
|--------|-------------|
| `setTheme(theme)` | Updates theme, persisted automatically |
| `loadModelConfig()` | Calls `GET /api/config`, populates `modelConfig` |
| `saveModelConfig(config)` | Calls `POST /api/config` with the updated config |

---

### `useFilesStore` — `src/store/files.store.ts`

Manages the workspace file browser state.

| State | Type | Description |
|-------|------|-------------|
| `workspaceDir` | `string` | Current workspace root directory |
| `entries` | `FileEntry[]` | Files and subdirectories in the current directory |
| `selectedFile` | `FileEntry \| null` | File currently open in the preview panel |
| `fileContent` | `string \| null` | Text content of the selected file |
| `isLoading` | `boolean` | True while listing or reading |

| Action | Description |
|--------|-------------|
| `loadWorkspaceDir()` | Calls `GET /api/workspace/dir`, sets `workspaceDir` |
| `listFiles(dirPath)` | Calls `GET /api/workspace/files`, populates `entries` |
| `selectFile(entry)` | Calls `GET /api/workspace/file`, sets `selectedFile` and `fileContent` |
| `pickDirectory()` | Calls `POST /api/workspace/pick-dir` (native dialog), then `POST /api/workspace/dir` |
| `openExternal(path)` | Calls `POST /api/workspace/open-external` to reveal file in native file manager |

---

### `useCodeStore` — `src/store/code.store.ts`

Manages code mode session state — see [code-agent-integration.md](code-agent-integration.md) for the full picture.

| State | Type | Description |
|-------|------|-------------|
| `deepRun` | `boolean` | Whether deep-run mode is enabled for the session |
| `maxIterations` | `10 \| 50 \| 100` | Iteration budget for the code agent |

| Action | Description |
|--------|-------------|
| `startSession(dir, mcpServers?, opts?)` | Calls `POST /api/code/init` with workspace dir + options |
| `sendMessage(content)` | Calls `POST /api/code/send-message` |
| `loadConversation(id)` | Loads a saved code-mode conversation |
| `clearSession()` | Tears down the current session |
| `initLogListener()` | Registers the `jiva:code-log` WebSocket listener |
| `setDeepRun(value)` / `setMaxIterations(value)` | Direct setters for session options |
| `toggleWorkPanel(id)` | Expand/collapse a tool-event panel in the UI |

---

### `useGitStore` — `src/store/git.store.ts`

Manages git status for the workspace, used by `GitPanel` in code mode.

| Action | Description |
|--------|-------------|
| `setWorkspaceDir(dir)` | Set which directory git status applies to |
| `checkIsRepo()` | Calls `GET /api/git/is-repo` |
| `refresh()` | Calls `GET /api/git/status` + `GET /api/git/branch-info` |
| `selectFile(file)` | Calls `GET /api/git/diff-file` for the selected file |
| `initRepo()` | Calls `POST /api/git/init-repo` |

---

### `useAuthStore` — `src/store/auth.store.ts`

Manages cloud-mode authentication state — see
[cloud-mode.md](cloud-mode.md).

| Action | Description |
|--------|-------------|
| `restoreSession()` | Reads a persisted session from `localStorage` on load |
| `signIn(email, password)` | Calls `POST /api/cloud/sign-in` |
| `signUp(email, password)` | Calls `POST /api/cloud/sign-up` |
| `signOut()` | Calls `POST /api/cloud/sign-out`, clears local session |
| `clearError()` | Clears the last auth error |

---

## Store Composition Rules

- Stores are independent — no cross-store imports. Components compose multiple stores.
- `useChatStore` and `useConversationStore` are coupled by convention: `selectConversation()` in the conversation store calls `setMessages()` on the chat store internally.
- `useSettingsStore` and `useAuthStore` are the only stores with `localStorage` persistence. All others are session-only.
