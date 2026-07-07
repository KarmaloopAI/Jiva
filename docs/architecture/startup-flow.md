# Startup Flow

This document traces the full boot sequence, from CLI invocation to a fully
interactive UI. There are two entry paths depending on how the user launches
Jivam — read [native-install.md](native-install.md) for the full picture on
why both exist.

---

## Path A — Manual CLI launch (`jivam` in a terminal)

**File:** `server/index.ts` (module top-level, dispatched via `bin/jivam.js`)

1. CLI arg dispatch at the bottom of `server/index.ts` checks `process.argv`
   for `--install`, `start`/`stop`/`restart`/`status`, or `--server-only`. With
   none of those, it falls through to the default path below.
2. Express app is created, all routes mounted (`server/routes/*.ts`), static
   `dist/` serving configured for production.
3. `server.listen(PORT, '127.0.0.1', ...)` starts the HTTP+WebSocket server.
4. In production (`!IS_DEV`), `openAppWindow(url)` is called — tries, in
   order: an already-installed Safari web app bundle
   (`~/Applications/Jivam.app` or `~/Applications/Safari Apps/Jivam.app`),
   then Chrome/Edge/Brave `--app=` mode, then plain Safari via `osascript`,
   then the OS default browser (`open` npm package) as a last resort.
5. `SIGINT`/`SIGTERM` trigger `shutdown()`: `jivaRunner.cleanup()`,
   `codeRunner.cleanup()`, `server.close()`.

## Path B — Background service launch (Dock/Desktop icon click)

1. The Dock/Desktop icon is a thin launcher that assumes the server is
   already running (started by the OS service manager at login) and just
   opens a browser window pointed at `localhost:7842` — see
   [native-install.md](native-install.md) for the launchd/Task Scheduler
   plumbing.
2. If for some reason the background service isn't running, the click
   surfaces a normal browser connection error — `jivam start` fixes it. This
   is an intentional tradeoff over the old "start server on icon click"
   design (see `../CLAUDE.md` for why that approach was abandoned).

---

## Phase 1 — Browser tab loads, pre-flight check

**File:** `src/App.tsx`

1. React mounts. `setupDone` state starts `null` (pre-flight in progress).
2. `window.electron.setup.check()` is called — `electron-shim.ts` turns this
   into `GET /api/setup/check`.

**Server handles `GET /api/setup/check`** (`server/routes/setup.ts`):

- Runs `npm --version` (ok flag) + `node --version` (display version)
- Checks `npm root -g` for `jiva-core/package.json`
- Checks `getJivamConfigPath()` for a config file with a non-empty `apiKey`
- Returns `{ nodejs, jivaCore, config, platform }`

3. All three checks pass → `setupDone = true` → Phase 2.
4. Any fail → `setupDone = false` → `<SetupScreen>` renders, auto-polling
   every 3s until checks pass (or the user configures a model in-app via
   Settings, then clicks "Continue").

---

## Phase 2 — jiva-core Agent Initialization

**File:** `src/store/jiva.store.ts` → `startServer()` → `window.electron.jiva.server.start()`
→ `electron-shim.ts` → `POST /api/jiva/start`

**Server handles it** (`server/routes/jiva.ts` → `server/jiva-runner.ts`):

1. `JivaRunner.initialize()` resolves the global jiva-core install path
   (`npm root -g`, with `~/.npm-global` and local `node_modules` fallbacks).
2. Dynamic ESM import: `const { DualAgent, ConversationManager,
   MCPServerManager } = await import(pathToFileURL(entryPath).href)`.
3. Reads config via `readConfig()` (`getJivamConfigPath()`).
4. `directive-manager.ts` writes a date-aware `~/.jiva/jiva-directive.md`.
5. `persona-manager.ts` resolves the active persona directory.
6. `DualAgent` is constructed; MCP servers from `config.mcpServers` are
   started via `MCPServerManager`.
7. Runner emits `status-changed: 'ready'`.

---

## Phase 3 — Status Events over WebSocket

**File:** `server/routes/jiva.ts` / `server/ws.ts`

The runner's `status-changed` event is forwarded over the WebSocket via
`broadcast('jiva:server:status-changed', ...)`.

**File:** `src/lib/electron-shim.ts` / `src/store/jiva.store.ts`

The shim's WebSocket client dispatches incoming `jiva:server:status-changed`
and `jiva:phase-update` messages to whatever `window.electron.jiva.onStatusChange`
listener the store registered — same callback shape as the old IPC push
events, just delivered over `/ws` instead of `ipcRenderer.on`.

```
JivaRunner emits 'status-changed'
  → server broadcasts over WebSocket (server/ws.ts)
    → electron-shim.ts WebSocket client receives it
      → dispatches to the registered onStatusChange callback
        → jiva.store sets serverStatus
          → App.tsx reacts: setShowSplash(false)
            → AppShell renders
```

---

## Phase 4 — App Shell Renders

**File:** `src/components/layout/AppShell.tsx`

- `loadPersonas()` is called from `App.tsx` once `showSplash` clears.
- `AppShell` renders the sidebar, topbar, and active tab panel.
- The user can now chat, switch personas, browse conversations, manage MCP
  servers, use code mode, browse git status, and browse workspace files.
