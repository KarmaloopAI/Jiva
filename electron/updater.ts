import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

let _win: BrowserWindow | null = null
let _downloadOnReady = false

export function initAutoUpdater(win: BrowserWindow): void {
  _win = win

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    _win?.webContents.send('updater:available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    // nothing — silent
  })

  autoUpdater.on('download-progress', (progress) => {
    _win?.webContents.send('updater:progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    _win?.webContents.send('updater:ready')
    if (_downloadOnReady) {
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
    _win?.webContents.send('updater:error', err.message)
  })

  // IPC handlers
  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      console.error('[updater] checkForUpdates failed:', e)
    }
  })

  ipcMain.handle('updater:install', async () => {
    _downloadOnReady = true
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      console.error('[updater] downloadUpdate failed:', e)
    }
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((e) => {
    console.error('[updater] background check failed:', e)
  })
}
