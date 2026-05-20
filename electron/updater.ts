import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

let _win: BrowserWindow | null = null

export function initAutoUpdater(win: BrowserWindow): void {
  _win = win

  // Download starts automatically as soon as an update is found.
  // autoInstallOnAppQuit means if the user never clicks "Restart & Install",
  // the update is applied silently the next time they quit the app.
  autoUpdater.autoDownload = true
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
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
    _win?.webContents.send('updater:error', err.message)
  })

  // Manual check (exposed to renderer for future use)
  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      console.error('[updater] checkForUpdates failed:', e)
    }
  })

  // Called only when the user explicitly clicks "Restart & Install"
  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((e) => {
    console.error('[updater] background check failed:', e)
  })
}
