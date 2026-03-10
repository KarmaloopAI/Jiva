# Changelog

All notable changes to Jivam will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Changed — Architecture: Direct SDK Integration

After investigation, the Jiva HTTP server (`jiva-core/dist/interfaces/http/index.js`) is designed
for Cloud Run deployment and requires GCS storage configuration to start. It exits immediately
when run locally. The architecture was pivoted to use the **jiva-core Node.js SDK directly**
in the Electron main process — the same pattern Claude Desktop uses with the Anthropic SDK.

- **Replaced** `electron/jiva-server.ts` (HTTP server spawn) with `electron/jiva-runner.ts`
  — a `JivaRunner` class that imports `jiva-core` SDK directly via dynamic ESM import
  (`await import('jiva-core')`), initializes `DualAgent` with `ModelOrchestrator`,
  `MCPServerManager`, `WorkspaceManager`, `ConversationManager`, and `PersonaManager`,
  and exposes a `chat(prompt, onPhase)` method
- **Updated** `electron/main.ts` — uses `JivaRunner` instead of `JivaServer`
- **Updated** `electron/ipc-handlers.ts` — added `jiva:send-message` IPC handler backed by
  `JivaRunner.chat()`; added `jiva:reset-conversation`; removed HTTP health check logic
- **Updated** `electron/preload.ts` — added `sendMessage()`, `onPhaseUpdate()`, `resetConversation()`
  to `window.electron.jiva` context bridge API
- **Updated** `src/store/jiva.store.ts` — removed WebSocket/`connectWebSocket` logic; `sendMessage()`
  now calls IPC directly; added `initPhaseListener()` for one-time phase event registration
- **Updated** `src/types/jiva.ts` — added `JivaRunResult` interface; removed WebSocket protocol types
- **Updated** `src/types/electron.d.ts` — updated `ElectronAPI` to include `sendMessage`,
  `onPhaseUpdate`, `resetConversation`
- **Updated** `src/components/chat/ChatInput.tsx` — `handleSend` is now `async/await`
  instead of callback-based
- **Updated** `src/App.tsx` — removed WebSocket connection flow; calls `initPhaseListener()`
  on mount; splash dismissed after Jiva SDK initializes

### Architecture Decision Record

| Question | Answer |
|---|---|
| How does Claude Desktop talk to Claude? | HTTP + SSE (not WebSockets) |
| How does Claude Desktop talk to MCP servers? | STDIO child process with JSON-RPC 2.0 |
| Does jiva-core expose a Node.js SDK? | Yes — `DualAgent`, `MCPServerManager`, etc. |
| Does `jiva run` support streaming? | No — all-at-once after full pipeline |
| Can the jiva HTTP server run locally? | No — requires Cloud Run / GCS storage |
| Best Electron pattern for Jivam? | Direct SDK in main process via dynamic `import()` |

---

## [0.1.0] — Initial Build

### Added

#### Electron Main Process
- `electron/main.ts` — `BrowserWindow` with macOS `hiddenInset` title bar, `vibrancy: 'under-window'`,
  traffic lights at `(18, 18)`, IPC handler setup, `JivaRunner` lifecycle (cleanup on `before-quit`)
- `electron/preload.ts` — Context bridge exposing `window.electron` API covering jiva control,
  config, personas, conversations, and window controls
- `electron/ipc-handlers.ts` — All `ipcMain.handle()` registrations
- `electron/config-manager.ts` — Read/write `~/.jiva/config.json`
- `electron/persona-manager.ts` — Reads `~/.jiva/personas/` directory, parses `.jiva-plugin/plugin.json`,
  maps persona names to emoji icons

#### Built-in Personas
- `~/.jiva/personas/chat/.jiva-plugin/plugin.json` + `skills/conversation/SKILL.md`
  — Conversational assistant persona
- `~/.jiva/personas/research/.jiva-plugin/plugin.json` + `skills/deep-research/SKILL.md`
  — Research coordinator persona with orchestrated sub-agents (Research Analyst, Data Analyst,
  Fact Checker), structured report output format

#### React Renderer
- **State management** (Zustand stores):
  - `chat.store.ts` — messages array, `isThinking`, `thinkingStartTime`, `agentWork` per message,
    `toggleWorkPanel()`
  - `jiva.store.ts` — server/connection status, `sendMessage()`, `currentPhase`
  - `persona.store.ts` — available personas list, active persona name
  - `settings.store.ts` — theme (light/dark) with `localStorage` persistence

- **Layout components**:
  - `AppShell.tsx` — main container with sidebar + settings panel integration
  - `TopBar.tsx` — logo, Chat/Cowork/Code tabs, status indicator dot, settings/personas icons
  - `NavTab.tsx` — individual tab with "Coming Soon" badge support

- **Chat components**:
  - `ChatView.tsx` — container composing `MessageList` + `ChatInput`
  - `MessageList.tsx` — scrollable message list with auto-scroll to bottom
  - `UserMessage.tsx` — user message bubble with avatar and timestamp
  - `AgentMessage.tsx` — agent response bubble with markdown rendering and work panel toggle
  - `AgentWorkPanel.tsx` — expandable framer-motion panel showing Manager plan subtasks (numbered
    list), tool usage badges, iteration count, and response duration
  - `TypingIndicator.tsx` — phase-based animated typing indicator:
    - 0–3 s: "Connecting…"
    - 3–15 s: "Planning your request…"
    - 15–60 s: "Working on it…"
    - 60 s+: "Still working… (Xs elapsed)"
  - `ChatInput.tsx` — auto-resize textarea, Enter to send / Shift+Enter for newline,
    active persona chip display

- **Markdown rendering**:
  - `MarkdownRenderer.tsx` — `react-markdown` + `remark-gfm` + `rehype-highlight`
  - `CodeBlock.tsx` — syntax-highlighted code blocks with one-click copy button

- **Persona system**:
  - `PersonaSidebar.tsx` — slide-out sidebar with persona list
  - `PersonaCard.tsx` — individual persona card with icon, name, description, tags

- **Settings**:
  - `SettingsPanel.tsx` — slide-out drawer with dark mode toggle, model configuration display,
    and MCP server list

- **UI primitives**: `Button.tsx`, `Badge.tsx`, `Spinner.tsx`

- **Pages**: `ChatPage.tsx` (active), `CoworkPage.tsx` (coming soon), `CodePage.tsx` (coming soon)

- **Utilities**:
  - `src/lib/logo.ts` — fetches Jivam logo from `https://karmaloop.ai/favicon.ico`
  - `src/lib/constants.ts` — shared constants

- **Types**: `chat.ts`, `jiva.ts`, `persona.ts`, `electron.d.ts`, `assets.d.ts`

#### Styling & Design System
- `src/index.css` — full CSS custom property theming (light/dark modes), aurora gradient
  animation, typing indicator `@keyframes`, markdown body styles, glassmorphic card styles
- `tailwind.config.js` — custom Jivam color tokens (`jivam.*`), Inter font, custom keyframes
- Color scheme: purple `#8B5CF6` / blue `#3B82F6` / indigo `#6366F1`
- Light mode default background: `#F5F3FF` (lavender)
- Dark mode background: `#0A0A0B`
- Glassmorphic cards: `backdrop-filter: blur(12px)` + semi-transparent backgrounds
- Aurora radial-gradient background with CSS animation

#### Build & Config
- Electron 33 + React 18 + TypeScript + Vite 5 + Tailwind CSS 3 project scaffold
- `vite.config.ts` — `vite-plugin-electron` with separate entries for main and preload;
  preload compiled as CJS (`format: 'cjs'`) for Electron compatibility
- `tailwind.config.js` + `postcss.config.js` — using CJS `module.exports` (not ESM)
- `electron-builder.yml` — macOS DMG packaging configuration

### Fixed

- **`--openssl-legacy-provider is not allowed in NODE_OPTIONS`**
  - Cause: `~/.zshrc` sets `NODE_OPTIONS=--openssl-legacy-provider` for an Angular project;
    Electron 33's modern Node.js rejects this flag
  - Fix: Prefixed all `package.json` scripts with `NODE_OPTIONS=''` to clear the inherited value

- **Two Electron windows appearing**
  - Cause: Running both `npm run dev` (launches Electron via `vite-plugin-electron`) and
    `npm run start` simultaneously
  - Fix: Only `npm run dev` should be used in development; it handles everything

- **`Unable to load preload script` / `require() of ES Module not supported`**
  - Cause: `"type": "module"` in `package.json` causes Node.js to treat all `.js` files as ESM,
    but Electron's preload loading uses `require()` (CommonJS)
  - Attempts: Tried `.cjs` extension and separate Vite output config — still failed due to
    double-build conflict in dev mode
  - Fix: Removed `"type": "module"` entirely from `package.json`; renamed `tailwind.config.cjs`
    → `tailwind.config.js` and `postcss.config.cjs` → `postcss.config.js` (both use CJS syntax);
    simplified vite preload output to `{ format: 'cjs', entryFileNames: '[name].js' }`

- **`Dynamic require of "events" is not supported`**
  - Cause: `JivaWebSocketClient extends EventEmitter` imported Node's built-in `events` module,
    which is not available in the browser renderer process
  - Fix: Replaced with a self-contained `MiniEmitter` class using `Map<string, Listener[]>`
    (no Node.js dependencies)

- **WebSocket `ERR_CONNECTION_REFUSED`**
  - Cause: The Jiva HTTP server (`jiva-core/dist/interfaces/http/index.js`) exits immediately
    when run locally — it calls `createStorageProvider()` which requires GCS configuration
    (designed for Cloud Run deployment, not local dev)
  - Fix: Switched to direct SDK integration (see [Unreleased] above)
