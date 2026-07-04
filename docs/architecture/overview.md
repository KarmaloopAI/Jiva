# Architecture Overview

## Why no Electron

Jivam used to be an Electron app. Shipping an unsigned Electron binary hits
macOS Gatekeeper and Windows SmartScreen warnings unless you pay for code
signing (~$100+/yr on both platforms). Jivam moved to a **local Express
server + browser-based PWA** instead: `jivam` starts a server on
`localhost:7842` and opens the UI in the user's already-installed,
already-trusted browser (Chrome/Edge/Brave in `--app=` mode for a clean
window, or as a genuine installed Safari web app — see
[native-install.md](native-install.md)). No unsigned binary of ours ever
runs, so there's nothing for Gatekeeper/SmartScreen to block.

## Process model

```
┌─────────────────────────────────────────────────────────────┐
│  Node process  (server/index.ts)                            │
│  · Express app, routes mounted under /api/*                 │
│  · WebSocket server on /ws (server/ws.ts)                    │
│  · Loads jiva-core via dynamic ESM import at runtime         │
│  · Serves built frontend (dist/) as static files in prod     │
│  · Also the CLI entry point: jivam / --install / start/stop  │
└──────────────────────┬────────────────────────────────────────┘
                       │  HTTP (fetch) + WebSocket, localhost:7842
┌──────────────────────▼────────────────────────────────────────┐
│  Browser tab/window  (React + TypeScript + Vite)              │
│  src/                                                          │
│  · All UI components and Zustand stores — unchanged from the  │
│    Electron era                                                │
│  · src/lib/electron-shim.ts sets window.electron = {...},     │
│    implementing the SAME method shape the old Electron         │
│    preload API had, backed by fetch()/WebSocket instead of     │
│    ipcRenderer. This is why most components/stores never       │
│    needed to change during the migration.                      │
└─────────────────────────────────────────────────────────────┘
```

There is no context isolation / preload bridge anymore — it's a normal web
page talking to a normal HTTP+WebSocket server. `electron-shim.ts` exists
purely to preserve the `window.electron.*` call shape so the rest of the
frontend didn't need a rewrite.

---

## Key Directories

| Directory | Runs in | Purpose |
|-----------|---------|---------|
| `server/` | Node (the Express process) | Route handlers, jiva-core runner, config/persona/directive managers, CLI/install logic |
| `server/routes/` | Node | One file per API resource — see [api-contract.md](api-contract.md) |
| `bin/jivam.js` | Node | CLI shim: `require('../dist-server/index.js')` |
| `scripts/` | Dev machine only | `install.sh`/`install.ps1` (fetched via `curl`/`irm`, not shipped in the npm package), `obfuscate.js` (build step) |
| `src/` | Browser | React components, Zustand stores, types |
| `src/lib/electron-shim.ts` | Browser | The compatibility shim described above — first place to look when wiring up a new server capability to the UI |
| `src/components/` | Browser | UI component tree |
| `src/store/` | Browser | Zustand state stores |
| `public/manifest.json` | Browser | PWA manifest — required for Safari/Chrome "install as app" |

---

## Data Persistence

| Data | Location | Manager |
|------|----------|---------|
| Jivam's own model config / API keys | `~/.jivam/config.json` | `server/config-manager.ts` (`getJivamConfigPath()`) |
| jiva-core CLI's config (one-time migration source only) | Platform-specific, see below | `server/config-manager.ts` (`getJivaCoreConfigPath()`) |
| Conversations | `~/.jiva/conversations/*.json` | jiva-core's ConversationManager |
| Personas | `~/.jiva/personas/<name>/` | `server/persona-manager.ts` |
| Directive | `~/.jiva/jiva-directive.md` | `server/directive-manager.ts` |
| Workspace dir preference | Inside `~/.jivam/config.json` | `server/config-manager.ts` |
| UI preferences (theme) | `localStorage` (browser) | `src/store/settings.store.ts` |
| Background service logs | `~/.jivam/jivam.log` | launchd/Task Scheduler redirect |

**Jivam maintains its own config, separate from jiva-core's.** On first run,
if `~/.jivam/config.json` doesn't exist but jiva-core's own config does,
`migrateFromJivaCoreIfNeeded()` copies it once so existing `jiva setup`
credentials carry over. After that, Jivam manages its own copy —
jiva-core's config file is never written to by Jivam.

### jiva-core's own config path (migration source only)

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\jiva-nodejs\Config\config.json` |
| macOS | `~/Library/Preferences/jiva-nodejs/config.json` |
| Linux | `$XDG_CONFIG_HOME/jiva-nodejs/config.json` (default: `~/.config/jiva-nodejs/config.json`) |

---

## Build System

| Tool | Role |
|------|------|
| `vite` | Bundles the frontend (`dist/`) |
| `vite.server.config.ts` | Separate Vite config that bundles `server/index.ts` into a single CJS file (`dist-server/index.js`), with jiva-core and Node built-ins marked external |
| `scripts/obfuscate.js` | Runs `javascript-obfuscator` over `dist-server/index.js` and `dist/assets/*.js` in place, then strips sourcemaps — last step of `npm run build` (Jivam is proprietary; see `../CLAUDE.md`) |
| `npm publish` | Ships `dist/`, `dist-server/`, `bin/`, `public/` — see `.npmignore` for what's excluded (source, docs, `CLAUDE.md`, scripts) |

**No packaging targets** (no DMG/NSIS/AppImage) — the "package" is just the
npm tarball; `jivam --install` handles OS-native integration (Dock/Desktop
icon, background service) at install time instead of at build time. See
[native-install.md](native-install.md).
