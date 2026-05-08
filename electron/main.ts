import { app, BrowserWindow, ipcMain, nativeTheme, Menu } from 'electron'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { setupIpcHandlers } from './ipc-handlers'
import { JivaRunner } from './jiva-runner'
import { CodeRunner } from './code-runner'
import { initAutoUpdater, checkForUpdates } from './updater'

/**
 * Augment process.env.PATH so that npm/npx/node are findable in packaged apps.
 * macOS apps launched from Finder/Dock get a minimal PATH (/usr/bin:/bin only).
 * Strategy: ask the user's login shell for its PATH first; fallback to known locations.
 */
function augmentPath() {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL ?? '/bin/zsh'
    const shellPath = execSync(`${shell} -l -c 'echo $PATH'`, { timeout: 3000 }).toString().trim()
    if (shellPath) {
      process.env.PATH = shellPath
      return
    }
  } catch {}
  // Fallback: prepend well-known Node.js binary locations
  const home = os.homedir()
  const candidates = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    `${home}/.npm-global/bin`,
    '/usr/local/opt/node/bin',
  ]
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmDir)) {
      const v = fs.readdirSync(nvmDir).sort().reverse()[0]
      if (v) candidates.push(path.join(nvmDir, v, 'bin'))
    }
  } catch {}
  const current = process.env.PATH ?? ''
  const existing = new Set(current.split(':').filter(Boolean))
  const toAdd = candidates.filter(p => !existing.has(p))
  if (toAdd.length) process.env.PATH = [...toAdd, current].join(':')
}

augmentPath()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
let cloudWin: BrowserWindow | null = null
let jivaRunner: JivaRunner | null = null
let codeRunner: CodeRunner | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createAppMenu() {
  const isMac = process.platform === 'darwin'
  const isDev = !!VITE_DEV_SERVER_URL

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          { role: 'toggleDevTools' as const },
          { type: 'separator' as const },
        ] : []),
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#F5F3FF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => {
    win?.show()
  })

  nativeTheme.on('updated', () => {
    win?.webContents.send('native-theme-changed', nativeTheme.shouldUseDarkColors)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  win.on('closed', () => {
    win = null
  })

  return win
}

function createCloudWindow() {
  // If cloud window already open, just focus it instead of spawning a duplicate
  if (cloudWin && !cloudWin.isDestroyed()) {
    cloudWin.focus()
    return cloudWin
  }

  cloudWin = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 780,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#F5F3FF',
    title: 'Jivam Cloud',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  cloudWin.once('ready-to-show', () => cloudWin?.show())
  cloudWin.on('closed', () => { cloudWin = null })

  if (VITE_DEV_SERVER_URL) {
    cloudWin.loadURL(`${VITE_DEV_SERVER_URL}?mode=cloud`)
  } else {
    cloudWin.loadFile(path.join(process.env.DIST!, 'index.html'), { query: { mode: 'cloud' } })
  }

  return cloudWin
}

function initJivaRunner() {
  jivaRunner = new JivaRunner()
  return jivaRunner
}

function initCodeRunner() {
  codeRunner = new CodeRunner()
  return codeRunner
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', async () => {
  if (jivaRunner) await jivaRunner.cleanup()
  if (codeRunner) await codeRunner.cleanup()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  app.name = 'Jivam'
  const runner = initJivaRunner()
  const cRunner = initCodeRunner()
  setupIpcHandlers(runner, cRunner, () => win)
  createAppMenu()

  // Cloud window — open on renderer request
  ipcMain.handle('cloud:open-window', () => { createCloudWindow() })

  const mainWin = createWindow()

  // Auto-updater: init after window is created, check silently after load
  if (app.isPackaged) {
    mainWin.webContents.once('did-finish-load', () => {
      initAutoUpdater(mainWin)
      // Small delay so the user sees the app first before any update notification
      setTimeout(checkForUpdates, 5000)
    })
  }
})
