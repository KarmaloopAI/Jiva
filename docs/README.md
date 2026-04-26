# Jivam Documentation

Jivam is a cross-platform desktop application that provides a polished graphical interface for [jiva-core](https://www.npmjs.com/package/jiva-core) AI agents. It handles chat sessions, conversation history, persona switching, MCP server management, and workspace file browsing — all without exposing a terminal.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Electron | 33 |
| UI framework | React | 18 |
| Language | TypeScript | 5.9 |
| Build tool | Vite + vite-plugin-electron | 5 |
| Styling | Tailwind CSS | 3 |
| State management | Zustand | 4.5 |
| Animations | Framer Motion | 11 |
| AI engine | jiva-core (global npm) | latest |

---

## Prerequisites (development)

- Node.js 20+
- `jiva-core` installed globally: `npm install -g jiva-core`
- jiva-core configured with an API key (run `jiva setup` or configure via the in-app Settings)

---

## Quick Start

```bash
npm install
npm run dev          # Electron + Vite hot-reload
npm run build        # Production build
npm run dist:mac     # Package for macOS (DMG + ZIP)
npm run dist:win     # Package for Windows (NSIS installer + portable)
npm run dist:linux   # Package for Linux (AppImage + deb)
```

---

## Documentation Index

| Section | Description |
|---------|-------------|
| [architecture/overview.md](architecture/overview.md) | System diagram, process model, key directories |
| [architecture/startup-flow.md](architecture/startup-flow.md) | Boot sequence from cold start to ready UI |
| [architecture/ipc-contract.md](architecture/ipc-contract.md) | All IPC channels with payloads and return types |
| [architecture/state-management.md](architecture/state-management.md) | Zustand stores, data flow patterns |
| [architecture/jiva-core-integration.md](architecture/jiva-core-integration.md) | How jiva-core is loaded, called, and configured |
| [architecture/code-agent-integration.md](architecture/code-agent-integration.md) | Code mode agent architecture and components |
| [guides/design-guide.md](guides/design-guide.md) | Colors, typography, spacing, components, animations |
| [guides/adding-features.md](guides/adding-features.md) | Step-by-step guide for adding new IPC-backed features |
| [release_notes/](release_notes/) | Release notes (see individual version files) |
