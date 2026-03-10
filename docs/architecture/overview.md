# Architecture Overview

## Three-Process Model

Electron enforces strict process separation. Jivam uses all three Electron processes:

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process  (Node.js)                                    │
│  electron/main.ts                                           │
│  · Creates BrowserWindow                                    │
│  · Loads jiva-core via dynamic import                       │
│  · Registers IPC handlers (ipc-handlers.ts)                 │
│  · Manages JivaRunner lifecycle                             │
└──────────────────────┬──────────────────────────────────────┘
                       │  contextBridge (context isolation ON)
┌──────────────────────▼──────────────────────────────────────┐
│  Preload Script  (Node.js, sandboxed)                       │
│  electron/preload.ts                                        │
│  · Exposes window.electron API to renderer                  │
│  · Wraps ipcRenderer.invoke / ipcRenderer.on               │
└──────────────────────┬──────────────────────────────────────┘
                       │  window.electron.*
┌──────────────────────▼──────────────────────────────────────┐
│  Renderer Process  (Chromium, no Node access)               │
│  src/  (React + TypeScript + Vite)                          │
│  · All UI components and Zustand stores                     │
│  · Calls window.electron.* for all system operations        │
└─────────────────────────────────────────────────────────────┘
```

Context isolation is **enabled** — the renderer has no direct Node.js or Electron API access. All privileged operations go through the preload bridge.

---

## Key Directories

| Directory | Process | Purpose |
|-----------|---------|---------|
| `electron/` | Main | IPC handlers, jiva-core runner, config, persona, directive managers |
| `src/` | Renderer | React components, Zustand stores, types |
| `src/components/` | Renderer | UI component tree |
| `src/store/` | Renderer | Zustand state stores |
| `src/types/` | Shared | TypeScript interfaces including `ElectronAPI` |

---

## Data Persistence

| Data | Location | Manager |
|------|----------|---------|
| AI model config / API keys | Platform-specific (see below) | `electron/config-manager.ts` |
| Conversations | `~/.jiva/conversations/*.json` | jiva-core's ConversationManager |
| Personas | `~/.jiva/personas/<name>/` | `electron/persona-manager.ts` |
| Active persona | `~/.jiva/active-persona.txt` | `electron/persona-manager.ts` |
| Directive | `~/.jiva/jiva-directive.md` | `electron/directive-manager.ts` |
| Workspace dir preference | Inside config.json | `electron/config-manager.ts` |
| UI preferences (theme) | `localStorage` | `src/store/settings.store.ts` |

### Platform-Specific Config Paths

jiva-core stores `config.json` at OS-appropriate locations, **not** `~/.jiva/config.json`. `getJivaConfigPath()` in `electron/config-manager.ts` returns the correct path:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\jiva-nodejs\Config\config.json` |
| macOS | `~/Library/Preferences/jiva-nodejs/config.json` |
| Linux | `$XDG_CONFIG_HOME/jiva-nodejs/config.json` (default: `~/.config/jiva-nodejs/config.json`) |

---

## Build System

| Tool | Role |
|------|------|
| `vite` | Bundles the renderer (React app) |
| `vite-plugin-electron` | Co-builds main + preload alongside renderer |
| `electron-builder` | Packages the app for distribution |
| `build.sh` | Wrapper script: cleans, builds, packages all platforms |

**Packaging targets:**

| Platform | Formats |
|----------|---------|
| macOS | DMG (installer) + ZIP (portable) |
| Windows | NSIS installer + portable EXE |
| Linux | AppImage + `.deb` |
