# State Management

Jivam uses [Zustand](https://github.com/pmndrs/zustand) for all renderer-side state. There are six stores, each with a single responsibility.

---

## Data Flow Pattern

```
User action
  → Component calls store action
    → Store action calls window.electron.*  (IPC invoke)
      → Main process handler executes
        → Returns result
          → Store updates state
            → Component re-renders
```

Push events (server status, phase updates) follow the reverse path: main process sends via `webContents.send` → preload forwards via `ipcRenderer.on` → store listener updates state.

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
| `startServer()` | Invokes `jiva:server:start`, transitions status through `starting → running` |
| `stopServer()` | Invokes `jiva:server:stop` |
| `restartServer()` | Invokes `jiva:server:restart` |
| `setServerStatus(status)` | Direct status setter (used by push event listener) |
| `initPhaseListener()` | Registers listeners for `jiva:server:status-changed` and `jiva:phase-update` push events |

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
| `sendMessage(prompt, persona?)` | Appends user message, invokes `jiva:send-message`, appends assistant response |
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
| `loadConversations()` | Invokes `conversations:list`, populates `conversations` |
| `selectConversation(id)` | Invokes `conversations:load` + `jiva:load-conversation`, sets `activeId`, loads messages into `useChatStore` |
| `newConversation()` | Invokes `jiva:reset-conversation`, clears messages, sets `activeId = null` |
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
| `loadPersonas()` | Invokes `personas:list` and `personas:active`, populates state |
| `activatePersona(name)` | Invokes `personas:activate`, updates `activePersona` |

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
| `loadModelConfig()` | Invokes `config:read`, populates `modelConfig` |
| `saveModelConfig(config)` | Invokes `config:write` with the updated config |

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
| `loadWorkspaceDir()` | Invokes `workspace:get-dir`, sets `workspaceDir` |
| `listFiles(dirPath)` | Invokes `workspace:list-files`, populates `entries` |
| `selectFile(entry)` | Invokes `workspace:read-file`, sets `selectedFile` and `fileContent` |
| `pickDirectory()` | Invokes `workspace:pick-dir` (native dialog), then `workspace:set-dir` |
| `openExternal(path)` | Invokes `workspace:open-external` to reveal file in native file manager |

---

## Store Composition Rules

- Stores are independent — no cross-store imports. Components compose multiple stores.
- `useChatStore` and `useConversationStore` are coupled by convention: `selectConversation()` in the conversation store calls `setMessages()` on the chat store internally via the `window.electron` conversation load.
- `useSettingsStore` is the only store with persistence (localStorage). All others are session-only.
