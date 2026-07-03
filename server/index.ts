import { augmentPath } from './path-helper'
augmentPath()

import express from 'express'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { initWebSocketServer } from './ws'
import { JivaRunner } from './jiva-runner'
import { CodeRunner } from './code-runner'
import { CloudRunner } from './cloud-runner'

import setupRouter from './routes/setup'
import configRouter from './routes/config'
import conversationsRouter from './routes/conversations'
import gitRouter from './routes/git'
import directiveRouter from './routes/directive'
import workspaceRouter from './routes/workspace'
import { createJivaRouter } from './routes/jiva'
import { createPersonasRouter } from './routes/personas'
import { createMcpRouter } from './routes/mcp'
import { createCodeRouter } from './routes/code'
import { createFilesRouter } from './routes/files'
import { createCloudRouter } from './routes/cloud'

const PORT = parseInt(process.env.JIVAM_PORT ?? '7842', 10)
const IS_DEV = process.env.NODE_ENV === 'development'

const __dirname_cjs = __dirname

const app = express()
app.use(express.json({ limit: '50mb' }))

// Initialise runners
const jivaRunner = new JivaRunner()
const codeRunner = new CodeRunner()
const cloudRunner = new CloudRunner()

// API routes
app.use('/api/setup', setupRouter)
app.use('/api/config', configRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/git', gitRouter)
app.use('/api/directive', directiveRouter)
app.use('/api/workspace', workspaceRouter)
app.use('/api/jiva', createJivaRouter(jivaRunner, cloudRunner))
app.use('/api/personas', createPersonasRouter(jivaRunner))
app.use('/api/mcp', createMcpRouter(jivaRunner))
app.use('/api/code', createCodeRouter(codeRunner))
app.use('/api/files', createFilesRouter(jivaRunner))
app.use('/api/cloud', createCloudRouter(cloudRunner))

// Platform + version endpoints for the frontend shim
app.get('/api/platform', (_req, res) => res.json(process.platform))
app.get('/api/version', (_req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname_cjs, '..', 'package.json'), 'utf-8')) as { version: string }
    res.json(pkg.version)
  } catch { res.json('0.0.0') }
})

// Serve built frontend in production
if (!IS_DEV) {
  const distDir = path.join(__dirname_cjs, '..', 'dist')
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir))
    app.get(/(.*)/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }
}

/**
 * Open Jivam in a clean app-mode window (no address bar, no tabs).
 * Tries Chrome/Edge/Brave --app flag first (best experience), then Safari
 * app mode on macOS, then falls back to the default browser.
 */
async function openAppWindow(url: string): Promise<void> {
  const { execFile, exec } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  const execAsync = promisify(exec)

  if (process.platform === 'darwin') {
    // Try Chrome, Edge, Brave in that order — all support --app flag
    const macBrowsers = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
    for (const browser of macBrowsers) {
      try {
        execFile(browser, [`--app=${url}`, '--disable-extensions'])
        console.log(`Opened in app-mode window: ${browser}`)
        return
      } catch {}
    }
    // Safari: open in new window via osascript
    try {
      await execAsync(
        `osascript -e 'tell application "Safari" to open location "${url}"' -e 'tell application "Safari" to activate'`
      )
      console.log('Opened in Safari')
      return
    } catch {}
  } else if (process.platform === 'win32') {
    const winBrowsers = [
      ['msedge', [`--app=${url}`]],
      ['chrome', [`--app=${url}`]],
      ['brave', [`--app=${url}`]],
    ] as Array<[string, string[]]>
    for (const [browser, args] of winBrowsers) {
      try {
        execFile(`start ${browser}`, args, { shell: true })
        return
      } catch {}
    }
    // PowerShell fallback
    try {
      await execAsync(`start "" "${url}"`)
      return
    } catch {}
  } else {
    // Linux
    const linuxBrowsers = [
      ['google-chrome', [`--app=${url}`]],
      ['google-chrome-stable', [`--app=${url}`]],
      ['chromium-browser', [`--app=${url}`]],
      ['chromium', [`--app=${url}`]],
      ['brave-browser', [`--app=${url}`]],
      ['microsoft-edge', [`--app=${url}`]],
    ] as Array<[string, string[]]>
    for (const [browser, args] of linuxBrowsers) {
      try {
        execFile(browser, args)
        return
      } catch {}
    }
  }

  // Universal fallback — open in default browser (will have address bar)
  try {
    const { default: open } = await import('open')
    await open(url)
    console.log(`Opened in default browser: ${url}`)
  } catch (err) {
    console.error('Could not open browser automatically:', err)
    console.log(`Open manually: ${url}`)
  }
}

const server = http.createServer(app)
initWebSocketServer(server)

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`
  console.log(`Jivam server running at ${url}`)

  if (!IS_DEV) {
    await openAppWindow(url)
  }
})

// Graceful shutdown
async function shutdown() {
  await jivaRunner.cleanup()
  await codeRunner.cleanup()
  server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
