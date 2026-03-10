# Startup Flow

This document traces the full boot sequence from process launch to a fully interactive UI.

---

## Phase 1 — Electron Main Process Starts

**File:** `electron/main.ts`

1. Electron creates the `BrowserWindow` with `contextIsolation: true` and `nodeIntegration: false`.
2. The preload script (`electron/preload.ts`) is loaded into the window context.
3. The window loads the renderer: dev server URL in development, `dist/index.html` in production.
4. `setupIpcHandlers(jivaRunner, getWindow)` is called, registering all `ipcMain.handle()` listeners.
5. `JivaRunner` instance is created but **not yet initialized** — it waits for the renderer to request it.

---

## Phase 2 — Renderer Mounts, Pre-flight Check

**File:** `src/App.tsx`

1. React mounts. `setupDone` state is initialized to `null` (pre-flight in progress).
2. `window.electron.setup.check()` is invoked — this calls `setup:check` IPC.

**Main process handles `setup:check`** (`electron/ipc-handlers.ts`):

- Runs `npm --version` (ok flag) + `node --version` (display version)
- Checks `npm root -g` for `jiva-core/package.json`
- Checks `getJivaConfigPath()` for a config file with a non-empty `apiKey`
- Returns `{ nodejs, jivaCore, config, platform }`

3. If all three checks pass → `setupDone = true` → proceed to Phase 3.
4. If any fail → `setupDone = false` → `<SetupScreen>` renders with the check results.
   - SetupScreen auto-polls every 3 seconds until all checks pass.
   - User can configure the AI model in-app via the Settings overlay.
   - Once all pass, user clicks "Continue" → `setupDone = true`.

---

## Phase 3 — Jiva Agent Initialization

**File:** `src/store/jiva.store.ts` → `startServer()` → `window.electron.jiva.server.start()`

**Main process handles `jiva:server:start`** (`electron/ipc-handlers.ts`):

1. Calls `jivaRunner.initialize()`.

**`JivaRunner.initialize()`** (`electron/jiva-runner.ts`):

1. `augmentPath()` — spawns `$SHELL -l -c 'echo $PATH'` to capture the login shell's PATH (needed in packaged apps where the process PATH is minimal).
2. `resolveJivaCoreEntryPath()` — runs `npm root -g` to locate the global `jiva-core` install. Falls back to `~/.npm-global` and local `node_modules`.
3. Dynamic ESM import: `const { DualAgent, ConversationManager, MCPServerManager } = await import(entryPath)`
4. Reads config via `readConfig()` → `getJivaConfigPath()`.
5. `directive-manager.ts` writes a date-aware `~/.jiva/jiva-directive.md` (injected as system context).
6. `persona-manager.ts` resolves the active persona directory.
7. `DualAgent` is constructed with the config, persona, directive, and MCP server config.
8. MCP servers from `config.mcpServers` are started via `MCPServerManager`.
9. Runner emits `status-changed: 'ready'`.

---

## Phase 4 — Status Events and UI Ready

**File:** `electron/ipc-handlers.ts`

The runner's `status-changed` event is forwarded to the renderer via `win.webContents.send('jiva:server:status-changed', ...)`.

**File:** `src/store/jiva.store.ts`

`initPhaseListener()` registers `window.electron.jiva.onStatusChange()` and `window.electron.jiva.onPhaseUpdate()`. Status updates flow:

```
JivaRunner emits 'status-changed'
  → ipcMain forwards to renderer
  → jiva.store sets serverStatus
  → App.tsx reacts: setShowSplash(false)
  → AppShell renders
```

---

## Phase 5 — App Shell Renders

**File:** `src/components/layout/AppShell.tsx`

- `loadPersonas()` is called from `App.tsx` once `showSplash` clears.
- `AppShell` renders the sidebar, topbar, and active tab panel.
- The user can now chat, switch personas, browse conversations, manage MCP servers, and browse files.

---

## Sequence Summary

```
main.ts                    → BrowserWindow, setupIpcHandlers
  preload.ts               → window.electron exposed
    App.tsx mounts         → setup:check IPC
      [SetupScreen if needed]
      setupDone = true
        jiva:server:start  → JivaRunner.initialize()
          augmentPath → resolveJivaCoreEntryPath → import(jiva-core)
          DualAgent created, MCP servers started
          status-changed: 'ready'
        showSplash = false
          AppShell renders
          loadPersonas()
```
