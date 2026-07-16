# Jivam

Jivam is the desktop UI for [Jiva](https://github.com/KarmaloopAI/Jiva), the autonomous AI agent. It runs as a local web server (`localhost:7842`) served from an npm package — no Electron, no code signing, no app store required.

Install once with a single command and get a native app experience: a clean, address-bar-free window pinned to your Dock (macOS, via Safari's native "Add to Dock") or Start Menu (Windows, via Edge's "Install this site as an app"), with a background service that's already running by the time you click the icon.

## Quick Install

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/KarmaloopAI/Jivam/main/scripts/install.sh | bash
```

**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/KarmaloopAI/Jivam/main/scripts/install.ps1 | iex
```

The installer will:
1. Install Node.js 20+ if not already present (via nvm on Mac/Linux; via winget, or a no-admin portable install if that's not available, on Windows)
2. Install `jivamai` and `jiva-core` globally via npm
3. Set up Jivam as a persistent background service (a macOS LaunchAgent, or a Startup-folder entry on Windows — no admin rights needed either way)
4. Open Safari (macOS) or Edge (Windows) with an on-screen walkthrough for the one manual step — adding Jivam to your Dock / installing it as an app

After that, click the **Jivam** icon to launch — the server is already running in the background, so there's no wait.

## Manual Install

If you prefer to install manually:

```bash
npm install -g jivamai jiva-core

# Set up the background service + Dock/Start Menu icon
jivam --install

# Or just run directly in the terminal
jivam
```

`jivam` also supports `--version`, `--help`, and `start`/`stop`/`restart`/`status` for managing the background service.

## How it works

- `jivam` starts an Express server on `localhost:7842` and serves the UI — a real web app, no bundled browser
- On macOS, `jivam --install` guides you through Safari's native "Add to Dock" (Sonoma+), which creates a genuinely separate, single-instance `.app` bundle — not a `--app=` window sharing a browser's own identity
- On Windows, it guides you through Edge's "Install this site as an app," with Desktop/Start Menu shortcuts as a fallback if that isn't completed
- The server runs as a persistent background service (started at login, auto-restarted on crash) so it's already up by the time any icon is clicked
- Jivam checks for updates in the background and shows a non-intrusive banner when one's available — nothing is installed until you click Update

## Features

- Multi-panel chat UI with Jiva autonomous agent
- Deep Run mode for complex multi-step tasks
- File attachments with automatic format conversion
- MCP (Model Context Protocol) server management
- One-click provider setup (Sarvam, Krutrim, Groq, Together AI, OpenAI-compatible), with a live model picker and mid-session model switching
- Persona management and customizable settings
- Cloud mode for remote Jiva instances

## Development

```bash
# Install dependencies
npm install

# Run in development mode (Vite dev server + Express backend in parallel)
npm run dev

# Build for production
npm run build

# Start the production server
npm start
```

The dev server runs the React frontend on port `5173` (with HMR) and the Express backend on port `7842`. API and WebSocket requests are proxied automatically.

## Publishing

Releases are handled via GitHub Actions:

- Push to `develop` → publishes a `dev`-tagged prerelease to npm (`x.y.z-dev.<sha>`)
- Create a GitHub Release on `main` → publishes the stable release to npm

Requires an `NPM_TOKEN` secret set in the repository's GitHub Actions settings.

## Requirements

- Node.js 20+
- [jiva-core](https://www.npmjs.com/package/jiva-core) (installed automatically by the install scripts)
- macOS 12+ or Windows 10/11 (or Linux, without the Dock/Start Menu app step)

## License

MIT © Karmaloop AI
