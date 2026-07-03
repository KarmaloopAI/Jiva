# Jivam

Jivam is the desktop UI for [Jiva](https://github.com/karmaloop-ai/jiva), the autonomous AI agent. It runs as a local web server (`localhost:7842`) served from an npm package — no Electron, no code signing, no app store required.

Install once with a single command and get a native app experience: a clean, address-bar-free window pinned to your Dock (macOS) or Desktop (Windows), with automatic background updates on every launch.

## Quick Install

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/karmaloop-ai/jivam/main/scripts/install.sh | bash
```

**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/karmaloop-ai/jivam/main/scripts/install.ps1 | iex
```

The installer will:
1. Install Node.js (via nvm on Mac/Linux, winget on Windows) if not already present
2. Recommend installing Google Chrome for the best app-window experience
3. Install `jivam` and `jiva-core` globally via npm
4. Create a native app launcher and add it to your Dock / Desktop

After installation, click the **Jivam** icon to launch. The server starts automatically.

## Manual Install

If you prefer to install manually:

```bash
npm install -g jivamai jiva-core

# Create the native app launcher + add to Dock/Desktop
jivam --install

# Or just run directly in the terminal
jivam
```

## How it works

- `jivam` starts an Express server on `localhost:7842` and opens the UI in a Chrome `--app` window (no address bar, no tabs — looks and feels like a native app)
- On macOS, `jivam --install` creates `~/Applications/Jivam.app` — a self-contained shell wrapper that starts the server if not running, waits for it to be ready, then opens the browser window
- On Windows, it creates a silent VBScript launcher with Desktop and Start Menu shortcuts
- Each launch checks for updates to `jivam` and `jiva-core` in the background (at most once per day), so you always stay current without any manual intervention

## Features

- Multi-panel chat UI with Jiva autonomous agent
- Deep Run mode for complex multi-step tasks
- File attachments with automatic format conversion
- MCP (Model Context Protocol) server management
- One-click provider setup (Sarvam, Krutrim, Groq, OpenAI-compatible)
- Persona management and customizable settings
- Cloud mode for remote Jiva instances
- Works with any Chromium browser (Chrome, Edge, Brave) for the app-window experience

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

- Node.js 18+
- [jiva-core](https://www.npmjs.com/package/jiva-core) (installed automatically by the install scripts)
- Google Chrome, Microsoft Edge, or Brave for the app-window experience (Safari works but without the frameless window)

## License

MIT © Karmaloop AI
