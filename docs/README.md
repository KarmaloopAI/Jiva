# Jivam Documentation

Jivam is a local web app (PWA) that provides a polished graphical interface for
[jiva-core](https://www.npmjs.com/package/jiva-core) AI agents. It handles chat
sessions, conversation history, persona switching, MCP server management, code
mode, git integration, and workspace file browsing.

Jivam publishes to npm as **`jivamai`** (the CLI command is still `jivam`) and
runs as an Express server on `localhost:7842`, with the UI served as a
standard React SPA — no Electron, no code signing required. See
[architecture/overview.md](architecture/overview.md) for why and how.

> Also read `../CLAUDE.md` (repo root) — it's the working-notes file for AI
> coding sessions with hard-won debugging findings that don't belong in
> reference docs. This `docs/` directory is the "what and how"; `CLAUDE.md` is
> the "why and gotchas".

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Server | Express + `ws` (WebSocket) | 5 / 8 |
| UI framework | React | 18 |
| Language | TypeScript | 5.9 |
| Build tool | Vite | 5 |
| Styling | Tailwind CSS | 3 |
| State management | Zustand | 4.5 |
| Animations | Framer Motion | 11 |
| AI engine | jiva-core (global npm) | latest |
| Background service | launchd (macOS) / Task Scheduler (Windows) | — |

---

## Prerequisites (development)

- Node.js 18+
- `jiva-core` installed globally: `npm install -g jiva-core`
- jiva-core configured with an API key (via Jivam's in-app Settings, or `jiva setup`)

---

## Quick Start

```bash
npm install
npm run dev                # Vite dev server (5173) + Express backend (7842), hot-reload
npm run build               # Production build, obfuscated (see below)
npm run build:unobfuscated  # Production build, readable (for debugging a prod issue)
npm start                   # Run the built server directly
npm link                    # Install `jivam` CLI globally from this checkout
jivam --install             # Set up background service + Dock/Desktop icon
```

Jivam is proprietary — `npm run build` obfuscates `dist/` and `dist-server/`
in the last step (`scripts/obfuscate.js`). If you need to debug a production
build, use `npm run build:unobfuscated` instead.

---

## Documentation Index

| Section | Description |
|---------|--------------|
| [architecture/overview.md](architecture/overview.md) | System diagram, key directories, why no Electron |
| [architecture/startup-flow.md](architecture/startup-flow.md) | Boot sequence: CLI → server → background service → browser |
| [architecture/api-contract.md](architecture/api-contract.md) | All REST routes + WebSocket events (formerly `ipc-contract.md`) |
| [architecture/state-management.md](architecture/state-management.md) | Zustand stores, data flow patterns |
| [architecture/jiva-core-integration.md](architecture/jiva-core-integration.md) | How jiva-core is loaded, called, and configured |
| [architecture/code-agent-integration.md](architecture/code-agent-integration.md) | Code mode agent architecture and components |
| [architecture/native-install.md](architecture/native-install.md) | Background service (launchd/Task Scheduler), Dock/Desktop icon install flow |
| [guides/design-guide.md](guides/design-guide.md) | Colors, typography, spacing, components, animations |
| [guides/adding-features.md](guides/adding-features.md) | Step-by-step guide for adding new server-backed features |
| [release_notes/](release_notes/) | Release notes (see individual version files) |
