import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { ipcMain, shell } from 'electron'

let _win: BrowserWindow | null = null
let _downloadedFilePath: string | undefined

export function initAutoUpdater(win: BrowserWindow): void {
  _win = win

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    _win?.webContents.send('updater:available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    _win?.webContents.send('updater:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    _win?.webContents.send('updater:progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', (info) => {
    _downloadedFilePath = info.downloadedFile
    _win?.webContents.send('updater:ready')
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
    _win?.webContents.send('updater:error', err.message)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      console.error('[updater] checkForUpdates failed:', e)
    }
  })

  ipcMain.handle('updater:quit-and-install', () => {
    if (process.platform === 'darwin') {
      // Squirrel.Mac silently refuses to install unsigned/unnotarized builds.
      // Reveal the downloaded zip in Finder so the user can install manually,
      // then still attempt quitAndInstall (works correctly once the app is signed).
      if (_downloadedFilePath) {
        shell.showItemInFolder(_downloadedFilePath)
      }
      autoUpdater.quitAndInstall(false, true)
    } else {
      // Windows: silent NSIS install (/S flag) avoids the UAC elevation prompt
      // that blocked Windows 11. With perMachine:false in electron-builder.yml the
      // installer writes to %LocalAppData% which needs no elevation at all.
      autoUpdater.quitAndInstall(true, true)
    }
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((e) => {
    console.error('[updater] background check failed:', e)
  })
}
