import { augmentPath } from './path-helper'
augmentPath()

import express from 'express'
import http from 'http'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { initWebSocketServer, broadcast } from './ws'
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

// ---------------------------------------------------------------------------
// jivam --install  (macOS only for now)
// Creates ~/Applications/Jivam.app — a self-contained shell wrapper that
// starts the server if not running, waits for it, then opens Safari (or
// Chrome/Edge/Brave as a fallback). Also adds the app to the Dock via
// `defaults write`.
// ---------------------------------------------------------------------------
function findSafariWebAppBundle(sinceMs: number): string | null {
  // Safari writes the bundle either into ~/Applications/Safari Apps/ or
  // directly into ~/Applications/, depending on macOS version — and when a
  // same-named bundle already exists there (e.g. our own fallback wrapper,
  // or a previous install), it overwrites it IN PLACE rather than picking a
  // new name. So identify by Info.plist content (not "is this a new
  // directory entry") and only accept it if its Info.plist was written
  // after `sinceMs`, so we don't false-positive on an unrelated older bundle.
  const searchDirs = [
    path.join(os.homedir(), 'Applications', 'Safari Apps'),
    path.join(os.homedir(), 'Applications'),
  ]
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.app'))
    for (const entry of entries) {
      const plistPath = path.join(dir, entry, 'Contents', 'Info.plist')
      if (!fs.existsSync(plistPath)) continue
      try {
        const stat = fs.statSync(plistPath)
        if (stat.mtimeMs < sinceMs) continue
        const plistContent = fs.readFileSync(plistPath, 'utf-8')
        if (plistContent.includes('com.apple.Safari.WebApp') && plistContent.includes('<string>Jivam</string>')) {
          return path.join(dir, entry)
        }
      } catch {}
    }
  }
  return null
}

/**
 * Finds the shortcut Edge creates when a site is installed as an app via
 * "Install this site as an app" (the Windows equivalent of Safari's Add to
 * Dock). Edge places these in the Start Menu — sometimes directly in the
 * Programs folder, sometimes nested under a "Microsoft Edge Apps" subfolder
 * depending on Windows/Edge version — so this checks both, one level deep.
 * `sinceMs` filters to shortcuts written after that time, same mtime-based
 * approach as findSafariWebAppBundle, so we don't false-positive on an
 * unrelated older shortcut. Pass 0 to accept any existing match (used by
 * openAppWindow to find an already-installed PWA on a later launch).
 */
function findEdgePwaShortcut(sinceMs: number): string | null {
  const startMenuDirs = [
    path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ]
  const searchDirs: string[] = []
  for (const dir of startMenuDirs) {
    if (!dir || !fs.existsSync(dir)) continue
    searchDirs.push(dir)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) searchDirs.push(path.join(dir, entry.name))
    }
  }
  for (const dir of searchDirs) {
    let entries: string[]
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.lnk')) continue
      if (!entry.toLowerCase().includes('jivam')) continue
      const lnkPath = path.join(dir, entry)
      try {
        const stat = fs.statSync(lnkPath)
        if (stat.mtimeMs < sinceMs) continue
        return lnkPath
      } catch {}
    }
  }
  return null
}

/**
 * Guide the user to install Jivam as a genuine Safari web app — a real,
 * separate .app bundle with its own bundle identifier
 * (com.apple.Safari.WebApp.<uuid>). This gives native macOS Dock semantics
 * for free: a distinct Dock icon and click-to-focus on the existing window
 * instead of spawning duplicates, which `chrome --app=` can never provide
 * (it shares Chrome's bundle ID).
 *
 * Assumes `url` is already reachable — the caller is responsible for
 * ensuring the server is running before calling this.
 *
 * Earlier versions of this drove the File > Add to Dock… menu item directly
 * via System Events UI scripting. That required the user to grant
 * Accessibility permission (System Settings → Privacy & Security →
 * Accessibility) to the calling process (e.g. Terminal) — and when that
 * permission wasn't granted in time (or was denied), the whole flow fell
 * back to a Chrome/Edge/Brave `--app=` wrapper instead, silently abandoning
 * the Safari-first strategy for anyone who didn't grant Accessibility fast
 * enough. Since the confirmation panel itself can never be scripted anyway
 * (deliberately excluded from the Accessibility API — see CLAUDE.md), the
 * System Events step was only ever saving the user one menu click, at the
 * cost of an intimidating permission prompt. Simpler and more reliable: just
 * open the page in a plain Safari tab and let the page itself (see
 * AddToDockGuide in src/App.tsx) show the two-click walkthrough — no
 * Accessibility permission needed at all, since `tell application "Safari"`
 * (unlike `tell application "System Events"`) only needs the lightweight,
 * rarely-denied Automation permission.
 */
async function installSafariAddToDock(url: string): Promise<string | null> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  try {
    // Add to Dock requires macOS Sonoma (14) or later
    const { stdout: versionOut } = await execAsync('sw_vers -productVersion')
    const majorVersion = parseInt(versionOut.trim().split('.')[0] ?? '0', 10)
    if (majorVersion < 14) {
      console.warn('Safari Add to Dock requires macOS Sonoma (14) or later — falling back to --app mode.')
      return null
    }

    const automationStartMs = Date.now()
    const guideUrl = `${url}/?installGuide=safari-dock`

    try {
      await execAsync(
        `osascript -e 'tell application "Safari" to open location "${guideUrl}"' -e 'tell application "Safari" to activate'`,
      )
    } catch (err) {
      console.warn('Could not open Safari automatically — falling back to --app mode:', err)
      return null
    }

    console.log('\nOpened Jivam in Safari with on-screen instructions.')
    console.log('Click File > Add to Dock… in Safari\'s menu bar, then click Add to confirm.')
    console.log('Waiting up to 2 minutes for you to finish...')
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const found = findSafariWebAppBundle(automationStartMs)
      if (found) {
        // Tell the running background server to relay the news over
        // WebSocket to whichever tab is showing AddToDockGuide — this CLI
        // process and the server are separate processes, so it can't call
        // ws.ts's broadcast() itself.
        try {
          await fetch(`${url}/api/system/pwa-installed`, { method: 'POST' })
        } catch {}
        return found
      }
    }

    console.warn('No Dock install detected within 2 minutes — falling back to --app mode. Run `jivam --install` again anytime to retry.')
    return null
  } catch (err) {
    console.warn('Safari Add to Dock setup failed, falling back to --app mode:', err)
    return null
  }
}

/**
 * Guide the user to install Jivam as an app via Edge's own "Install this
 * site as an app" feature — the Windows equivalent of installSafariAddToDock
 * above, and built the same way on purpose: earlier attempts at scripting
 * Windows app-installation automatically (driving Edge's UI, or relying on
 * winget/MSI installers that need elevation) ran into the same class of
 * permission problems as the old macOS Accessibility approach — some of them
 * silently fail for standard (non-admin) accounts. Since Edge ships by
 * default on every Windows install, there's no need for a Chrome fallback
 * chain here either: just open a plain Edge tab with on-screen instructions
 * (see AddToDockGuide in src/App.tsx, which also handles this platform) and
 * poll for the resulting Start Menu shortcut.
 */
async function installEdgeAppGuide(url: string): Promise<string | null> {
  const { execFile } = await import('child_process')

  const edgePaths = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  const edgePath = edgePaths.find(p => fs.existsSync(p))
  if (!edgePath) {
    console.warn('Microsoft Edge was not found — falling back to a plain shortcut wrapper.')
    return null
  }

  const automationStartMs = Date.now()
  const guideUrl = `${url}/?installGuide=edge-app`

  try {
    execFile(edgePath, [guideUrl])
  } catch (err) {
    console.warn('Could not open Edge automatically — falling back to a plain shortcut wrapper:', err)
    return null
  }

  console.log('\nOpened Jivam in Edge with on-screen instructions.')
  console.log('Click the install icon in Edge\'s address bar (or ⋯ menu > Apps > Install this site as an app).')
  console.log('Waiting up to 2 minutes for you to finish...')
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const found = findEdgePwaShortcut(automationStartMs)
    if (found) {
      try {
        await fetch(`${url}/api/system/pwa-installed`, { method: 'POST' })
      } catch {}
      return found
    }
  }

  console.warn('No app install detected within 2 minutes — falling back to a plain shortcut wrapper. Run `jivam --install` again anytime to retry.')
  return null
}

// ---------------------------------------------------------------------------
// Background service management (macOS: launchd, Windows: Task Scheduler)
//
// The Jivam server now runs persistently in the background — started at
// login and kept alive by the OS — instead of being launched on-demand by
// whatever opens the Dock/Desktop icon. This removes the "click icon before
// server is up" race entirely: by the time any icon is clicked, the server
// has (almost certainly) already been running for a while.
// ---------------------------------------------------------------------------

const JIVAM_LABEL = 'ai.karmaloop.jivam'

function macPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${JIVAM_LABEL}.plist`)
}

async function macFindJivamBin(): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  try {
    const { stdout } = await execAsync('which jivam')
    if (stdout.trim()) return stdout.trim()
  } catch {}

  const candidates = [
    '/usr/local/bin/jivam',
    path.join(os.homedir(), '.npm-global', 'bin', 'jivam'),
    '/opt/homebrew/bin/jivam',
    '/usr/bin/jivam',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).sort().reverse()
      for (const v of versions) {
        const p = path.join(nvmDir, v, 'bin', 'jivam')
        if (fs.existsSync(p)) return p
      }
    } catch {}
  }
  return `"${process.execPath}" "${process.argv[1]}"`
}

async function macWriteLaunchAgent(jivamBinPath: string): Promise<string> {
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.nvm', 'versions', 'node'),
    '/usr/bin',
    '/bin',
  ].join(':')

  const jivamHome = path.join(os.homedir(), '.jivam')
  fs.mkdirSync(jivamHome, { recursive: true })
  const logPath = path.join(jivamHome, 'jivam.log')

  const isQuotedCmd = jivamBinPath.startsWith('"')
  const programArgs = isQuotedCmd
    // "node" "script" form — split back into two <string> entries
    ? jivamBinPath.split('" "').map(s => s.replace(/^"|"$/g, ''))
    : [jivamBinPath]

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${JIVAM_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${programArgs.map(a => `<string>${a}</string>`).join('\n    ')}
    <string>--server-only</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${extraPaths}:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`
  const plistPath = macPlistPath()
  fs.mkdirSync(path.dirname(plistPath), { recursive: true })
  fs.writeFileSync(plistPath, plist)
  return plistPath
}

async function macServiceControl(action: 'start' | 'stop' | 'restart' | 'status'): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const plistPath = macPlistPath()
  const uid = process.getuid?.() ?? 0
  const domainTarget = `gui/${uid}`
  const serviceTarget = `${domainTarget}/${JIVAM_LABEL}`

  if (!fs.existsSync(plistPath)) {
    console.log('Jivam background service is not installed. Run: jivam --install')
    return
  }

  if (action === 'start') {
    try {
      await execAsync(`launchctl bootstrap ${domainTarget} "${plistPath}"`)
      console.log('Jivam background service started.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already bootstrapped') || message.includes('Service already loaded')) {
        console.log('Jivam background service is already running.')
      } else {
        console.error('Failed to start service:', err)
      }
    }
  } else if (action === 'stop') {
    try {
      await execAsync(`launchctl bootout ${serviceTarget}`)
      console.log('Jivam background service stopped.')
    } catch (err) {
      console.warn('Service was not running (or already stopped).')
    }
  } else if (action === 'restart') {
    try {
      await execAsync(`launchctl kickstart -k ${serviceTarget}`)
      console.log('Jivam background service restarted.')
    } catch (err) {
      // Not loaded yet — just start it fresh
      try {
        await execAsync(`launchctl bootstrap ${domainTarget} "${plistPath}"`)
        console.log('Jivam background service started.')
      } catch (startErr) {
        console.error('Failed to restart service:', startErr)
      }
    }
  } else if (action === 'status') {
    try {
      const { stdout } = await execAsync(`launchctl print ${serviceTarget}`)
      const isRunning = /state = running/.test(stdout)
      console.log(isRunning ? 'Jivam background service is running.' : 'Jivam background service is loaded but not running.')
      const pidMatch = stdout.match(/pid = (\d+)/)
      if (pidMatch) console.log(`  PID: ${pidMatch[1]}`)
    } catch {
      console.log('Jivam background service is not running.')
    }
  }
}

// ---------------------------------------------------------------------------
// jivam --install  (macOS)
// Sets up a launchd LaunchAgent so the server runs persistently in the
// background (started at login, restarted automatically if it crashes),
// then installs Jivam as a genuine Safari web app for a native Dock icon.
// ---------------------------------------------------------------------------
/**
 * Creates a minimal fallback .app wrapper that just opens Chrome/Edge/Brave
 * in --app= mode (or Safari as a last resort). No server-start logic is
 * needed here anymore — the LaunchAgent guarantees the server is already
 * running — so this is much simpler than the old wrapper.
 */
async function macCreateFallbackWrapper(): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const appPath = path.join(os.homedir(), 'Applications', 'Jivam.app')
  const macOSDir = path.join(appPath, 'Contents', 'MacOS')
  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  fs.mkdirSync(macOSDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })

  const url = `http://localhost:${PORT}`
  // Safari first (Jivam's preferred macOS browser — see openAppWindow/
  // installSafariAddToDock); Chrome/Edge/Brave only as a fallback for
  // users who don't have Safari available or have overridden the choice.
  const launcherScript = `#!/bin/bash
URL="${url}?installGuide=safari-dock"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

if osascript -e "tell application \\"Safari\\" to open location \\"$URL\\"" -e "tell application \\"Safari\\" to activate" 2>/dev/null; then
  :
elif [ -f "$CHROME" ]; then
  "$CHROME" --app="${url}" --disable-extensions &
elif [ -f "$EDGE" ]; then
  "$EDGE" --app="${url}" --disable-extensions &
elif [ -f "$BRAVE" ]; then
  "$BRAVE" --app="${url}" --disable-extensions &
fi
`
  fs.writeFileSync(path.join(macOSDir, 'jivam-launcher'), launcherScript, { mode: 0o755 })

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>jivam-launcher</string>
  <key>CFBundleIdentifier</key>
  <string>ai.karmaloop.jivam</string>
  <key>CFBundleName</key>
  <string>Jivam</string>
  <key>CFBundleDisplayName</key>
  <string>Jivam</string>
  <key>CFBundleIconFile</key>
  <string>Jivam</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
`
  fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), infoPlist)

  // Convert PNG → .icns via sips + iconutil
  const iconSrcCandidates = [
    path.join(__dirname, '..', 'dist', 'icon-512.png'),
    path.join(__dirname, '..', 'public', 'icon-512.png'),
  ]
  const iconSrc = iconSrcCandidates.find(p => fs.existsSync(p))
  if (iconSrc) {
    try {
      const iconsetDir = path.join(os.tmpdir(), 'Jivam.iconset')
      fs.mkdirSync(iconsetDir, { recursive: true })
      const sizes: Array<[number, string]> = [
        [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
        [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
        [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png'],
      ]
      for (const [size, name] of sizes) {
        await execAsync(`sips -z ${size} ${size} "${iconSrc}" --out "${path.join(iconsetDir, name)}"`)
      }
      await execAsync(`iconutil -c icns "${iconsetDir}" --output "${path.join(resourcesDir, 'Jivam.icns')}"`)
      fs.rmSync(iconsetDir, { recursive: true, force: true })
    } catch (err) {
      console.warn('Could not convert icon (sips/iconutil failed):', err)
    }
  }

  return appPath
}

async function macAddToDock(appPath: string): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  // Bust the Dock's icon cache and force LaunchServices to re-read the bundle
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  try {
    await execAsync(`touch "${appPath}"`)
    await execAsync(`"${lsregister}" -f "${appPath}"`)
  } catch {}

  const dockEntry = `<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>${appPath}</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>`
  try {
    await execAsync(`defaults write com.apple.dock persistent-apps -array-add '${dockEntry}' && killall Dock`)
    console.log(`Added to Dock: ${appPath}`)
  } catch (err) {
    console.warn('Could not add to Dock automatically — drag the app to your Dock manually.')
    console.warn(err)
  }
}

// ---------------------------------------------------------------------------
// jivam --install  (macOS)
// Sets up a launchd LaunchAgent so the server runs persistently in the
// background (started at login, restarted automatically if it crashes),
// then installs Jivam as a genuine Safari web app for a native Dock icon.
// ---------------------------------------------------------------------------
async function runInstall(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('--install is currently only supported on macOS.')
    process.exit(1)
  }

  const url = `http://localhost:${PORT}`

  // ── 1. Resolve the jivam binary and set up the LaunchAgent ────────────────
  console.log('Setting up the Jivam background service...')
  const jivamBinPath = await macFindJivamBin()
  await macWriteLaunchAgent(jivamBinPath)
  await macServiceControl('restart') // bootstraps if not loaded, kickstarts if it is

  // ── 2. Wait for the server to come up ──────────────────────────────────────
  let serverReady = false
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${url}/api/version`)
      if (res.ok) { serverReady = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!serverReady) {
    console.warn('Server did not come up within 15s — continuing anyway (check ~/.jivam/jivam.log).')
  } else {
    console.log('Jivam server is running.')
  }

  // ── 3. Install as a genuine Safari web app (best experience) ──────────────
  console.log('Setting up Jivam as a Safari web app...')
  const pwaAppPath = await installSafariAddToDock(url)

  // ── 4. Add the resulting app to the Dock, falling back to a plain wrapper ──
  const appToAdd = pwaAppPath ?? await macCreateFallbackWrapper()
  await macAddToDock(appToAdd)

  console.log('\nDone! Click the Jivam icon in your Dock to launch.')
  console.log('The server runs continuously in the background — manage it with:')
  console.log('  jivam stop      jivam start      jivam restart      jivam status')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// jivam --install  (Windows)
// Creates %LOCALAPPDATA%\Jivam\jivam-launcher.bat (hidden via a VBScript
// wrapper so no terminal flickers), a .ico icon, and Desktop + Start-Menu
// shortcuts with the icon baked in.
// ---------------------------------------------------------------------------
async function winFindJivamBin(): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  try {
    const { stdout } = await execAsync('where jivam')
    const first = stdout.split('\n')[0].trim()
    if (first) return first
  } catch {}

  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const candidates = [
    path.join(localAppData, 'npm', 'jivam.cmd'),
    path.join(process.env.APPDATA ?? '', 'npm', 'jivam.cmd'),
    'C:\\Program Files\\nodejs\\jivam.cmd',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return `"${process.execPath}" "${process.argv[1]}"`
}

function winServiceDir(): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'Jivam')
}

function winServicePs1Path(): string {
  return path.join(winServiceDir(), 'jivam-service.ps1')
}

function winServiceVbsPath(): string {
  return path.join(winServiceDir(), 'jivam-service-launcher.vbs')
}

function winServicePidPath(): string {
  return path.join(winServiceDir(), 'jivam-service.pid')
}

function winStartupShortcutPath(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Jivam Server.lnk')
}

/**
 * Sets up Jivam's background server to start automatically — without any
 * elevation. A Windows Scheduled Task with a logon trigger was the obvious
 * choice here (and what this used to do), but creating one requires
 * SeCreateGlobalPrivilege, which only administrators hold — this isn't a
 * run-level thing (LeastPrivilege doesn't help), it's specifically a
 * restriction on the *trigger type* itself. A standard, non-admin Windows
 * account gets a flat "Access is denied" trying to create it.
 *
 * Instead: a small self-restarting PowerShell supervisor, launched via a
 * shortcut placed in the current user's own Startup folder
 * (%APPDATA%\...\Startup). Windows runs everything in that folder
 * automatically at logon — it's a pure per-user filesystem operation with
 * no privilege requirements at all. The supervisor loop approximates a
 * Scheduled Task's RestartOnFailure by just re-launching jivam --server-only
 * a few seconds after any exit, and records its own PID so
 * start/stop/restart/status have something to act on (taskkill /T to stop
 * the whole tree, since Windows has no launchctl-style service registry to
 * query).
 */
async function winSetupStartupService(jivamBinPath: string): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const serviceDir = winServiceDir()
  fs.mkdirSync(serviceDir, { recursive: true })
  const jivamHome = path.join(os.homedir(), '.jivam')
  fs.mkdirSync(jivamHome, { recursive: true })
  const logPath = path.join(jivamHome, 'jivam.log')
  const ps1Path = winServicePs1Path()
  const vbsPath = winServiceVbsPath()
  const pidPath = winServicePidPath()

  const isQuotedCmd = jivamBinPath.startsWith('"')
  const [command, ...restArgs] = isQuotedCmd
    ? jivamBinPath.split('" "').map(s => s.replace(/^"|"$/g, ''))
    : [jivamBinPath]
  const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`
  const psArgs = [...restArgs, '--server-only'].map(psQuote).join(' ')

  const ps1 = `
$pidPath = ${psQuote(pidPath)}
$PID | Out-File -FilePath $pidPath -Encoding ascii -Force
$logPath = ${psQuote(logPath)}
while ($true) {
  "$(Get-Date -Format o): starting jivam server" | Out-File -Append -FilePath $logPath
  & ${psQuote(command)} ${psArgs} *>> $logPath
  "$(Get-Date -Format o): jivam server exited — restarting in 5s" | Out-File -Append -FilePath $logPath
  Start-Sleep -Seconds 5
}
`.trim()
  fs.writeFileSync(ps1Path, ps1)

  const vbs = `Set oShell = CreateObject("WScript.Shell")
oShell.Run "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & "${ps1Path.replace(/\\/g, '\\\\')}" & Chr(34), 0, False
`
  fs.writeFileSync(vbsPath, vbs)

  // Startup-folder shortcut — Windows launches this automatically at every
  // logon. Same CreateShortcut approach used for the Desktop/Start Menu app
  // shortcuts elsewhere in this file — a per-user COM call, no elevation.
  const shortcutPath = winStartupShortcutPath()
  const shortcutPs = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '//B "${vbsPath.replace(/\\/g, '\\\\')}"'
$s.WorkingDirectory = '${serviceDir.replace(/\\/g, '\\\\')}'
$s.Description = 'Jivam background server'
$s.Save()
`.trim()
  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true })
    await execAsync(`powershell -NoProfile -NonInteractive -Command "${shortcutPs.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`)
  } catch (err) {
    console.warn('Could not create Startup shortcut:', err)
  }
}

function winReadServicePid(): number | null {
  try {
    const raw = fs.readFileSync(winServicePidPath(), 'utf-8').trim()
    const pid = parseInt(raw, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function winIsProcessAlive(pid: number): Promise<boolean> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  try {
    const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`)
    return stdout.includes(String(pid))
  } catch {
    return false
  }
}

async function winServiceControl(action: 'start' | 'stop' | 'restart' | 'status'): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const vbsPath = winServiceVbsPath()
  if (!fs.existsSync(vbsPath)) {
    console.log('Jivam background service is not installed. Run: jivam --install')
    return
  }

  const startSupervisor = async () => {
    try {
      await execAsync(`wscript.exe //B "${vbsPath}"`)
    } catch (err) {
      console.error('Failed to start service:', err)
    }
  }

  const stopSupervisor = async () => {
    const pid = winReadServicePid()
    if (pid && await winIsProcessAlive(pid)) {
      // /T kills the whole process tree — the supervisor AND the jivam
      // server process it spawned — /F forces it.
      try { await execAsync(`taskkill /PID ${pid} /T /F`) } catch {}
    }
  }

  if (action === 'start') {
    const pid = winReadServicePid()
    if (pid && await winIsProcessAlive(pid)) {
      console.log('Jivam background service is already running.')
      return
    }
    await startSupervisor()
    console.log('Jivam background service started.')
  } else if (action === 'stop') {
    await stopSupervisor()
    console.log('Jivam background service stopped.')
  } else if (action === 'restart') {
    await stopSupervisor()
    await new Promise(resolve => setTimeout(resolve, 1000))
    await startSupervisor()
    console.log('Jivam background service restarted.')
  } else if (action === 'status') {
    const pid = winReadServicePid()
    if (pid && await winIsProcessAlive(pid)) {
      console.log(`Jivam background service is running. Supervisor PID: ${pid}`)
    } else {
      console.log('Jivam background service is not running.')
    }
  }
}

// ---------------------------------------------------------------------------
// jivam --install  (Windows)
// Registers a Scheduled Task so the server runs persistently in the
// background (started at logon, restarted automatically on failure), then
// guides the user through installing Jivam as an Edge app — the real,
// single-instance kind, not a `--app=` window sharing Edge's own identity.
// Only falls back to a plain shortcut wrapper if that doesn't complete.
// ---------------------------------------------------------------------------
async function runInstallWindows(): Promise<void> {
  const url = `http://localhost:${PORT}`

  // ── 1. Resolve the jivam binary and set up the background service ─────────
  console.log('Setting up the Jivam background service...')
  const jivamBinPath = await winFindJivamBin()
  await winSetupStartupService(jivamBinPath)
  await winServiceControl('restart')

  // ── 2. Wait for the server to come up ──────────────────────────────────────
  let serverReady = false
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${url}/api/version`)
      if (res.ok) { serverReady = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!serverReady) {
    console.warn('Server did not come up within 15s — continuing anyway (check %LOCALAPPDATA%\\Jivam\\jivam.log).')
  } else {
    console.log('Jivam server is running.')
  }

  // ── 3. Guide the user through installing Jivam as an Edge app ─────────────
  console.log('Setting up Jivam as an Edge app...')
  const pwaShortcut = await installEdgeAppGuide(url)

  if (pwaShortcut) {
    console.log(`\nDone! Jivam is installed as an app: ${pwaShortcut}`)
  } else {
    await winCreateFallbackWrapper(url)
    console.log('\nDone! Double-click the Jivam icon on your Desktop to launch.')
  }
  console.log('The server runs continuously in the background — manage it with:')
  console.log('  jivam stop      jivam start      jivam restart      jivam status')
  process.exit(0)
}

/**
 * Fallback for when installEdgeAppGuide doesn't complete in time (or Edge
 * isn't found at all): a Desktop + Start Menu shortcut that just opens a
 * plain Edge tab. No --app mode and no Chrome/Brave fallback chain here —
 * Edge ships by default on every Windows install, so there's nothing to
 * fall back further to.
 */
async function winCreateFallbackWrapper(url: string): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const installDir = path.join(localAppData, 'Jivam')
  const batPath = path.join(installDir, 'jivam-launcher.bat')
  const vbsPath = path.join(installDir, 'jivam-launcher.vbs')
  const icoPath = path.join(installDir, 'Jivam.ico')
  const desktopPath = path.join(os.homedir(), 'Desktop', 'Jivam.lnk')
  const startMenuDir = path.join(localAppData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const startMenuPath = path.join(startMenuDir, 'Jivam.lnk')

  fs.mkdirSync(installDir, { recursive: true })

  // ── Shortcut launcher — just opens Edge (server is already up) ────────────
  const batScript = `@echo off
set URL=${url}?installGuide=edge-app
start "" msedge "%URL%"
`

  // ── VBScript wrapper — runs the .bat silently (no terminal window) ─────────
  const vbsScript = `Set oShell = CreateObject("WScript.Shell")
oShell.Run Chr(34) & "${batPath.replace(/\\/g, '\\\\')}" & Chr(34), 0, False
`

  fs.writeFileSync(batPath, batScript)
  fs.writeFileSync(vbsPath, vbsScript)
  console.log(`Created launcher at ${installDir}`)

  // ── Convert PNG → .ico via PowerShell + System.Drawing ───────────────────
  const iconSrcCandidates = [
    path.join(__dirname_cjs, '..', 'dist', 'icon-512.png'),
    path.join(__dirname_cjs, '..', 'public', 'icon-512.png'),
  ]
  const iconSrc = iconSrcCandidates.find(p => fs.existsSync(p))

  if (iconSrc) {
    // PowerShell script: resize to 256×256 and save as .ico
    const ps1 = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${iconSrc.replace(/\\/g, '\\\\')}')
$bmp = New-Object System.Drawing.Bitmap($src, 256, 256)
$ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create('${icoPath.replace(/\\/g, '\\\\')}')
$ico.Save($fs)
$fs.Close()
$ico.Dispose()
$bmp.Dispose()
$src.Dispose()
Write-Host "Icon written"
`.trim()
    try {
      await execAsync(`powershell -NoProfile -NonInteractive -Command "${ps1.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`)
      console.log('Icon created.')
    } catch (err) {
      console.warn('Could not create icon (PowerShell/System.Drawing failed):', err)
    }
  }

  // ── Create .lnk shortcuts via PowerShell ─────────────────────────────────
  const iconArg = fs.existsSync(icoPath) ? `$s.IconLocation = '${icoPath.replace(/\\/g, '\\\\')}'` : ''

  const mkShortcut = (lnkPath: string) => `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${lnkPath.replace(/\\/g, '\\\\')}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '//B "${vbsPath.replace(/\\/g, '\\\\')}"'
$s.WorkingDirectory = '${installDir.replace(/\\/g, '\\\\')}'
$s.Description = 'Jivam - AI Agent UI'
${iconArg}
$s.Save()
`.trim()

  try {
    fs.mkdirSync(startMenuDir, { recursive: true })
    for (const lnkPath of [desktopPath, startMenuPath]) {
      const ps = mkShortcut(lnkPath)
      await execAsync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`)
    }
    console.log(`Created Desktop shortcut: ${desktopPath}`)
    console.log(`Created Start Menu entry: ${startMenuPath}`)
  } catch (err) {
    console.warn('Could not create shortcuts:', err)
  }
}

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

// `jivam --install` runs as a separate one-off CLI process from the
// persistent background server, so it can't call ws.ts's broadcast()
// directly — it hits this endpoint instead once it detects the Safari
// "Add to Dock" bundle, and the server (which owns the WebSocket
// connections) relays the news to any open tab showing AddToDockGuide.
app.post('/api/system/pwa-installed', (_req, res) => {
  broadcast('jivam:pwa-installed', {})
  res.json({ success: true })
})

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
  const execAsync = promisify(exec)

  // JIVAM_BROWSER=safari|chrome|edge|brave overrides auto-detection
  const browserOverride = (process.env.JIVAM_BROWSER ?? '').toLowerCase()

  if (process.platform === 'darwin') {
    // If the PWA was previously installed via Safari "Add to Dock",
    // it lives in ~/Applications/Safari Apps/Jivam.app — launch it directly.
    if (browserOverride !== 'chrome' && browserOverride !== 'edge' && browserOverride !== 'brave') {
      const safariAppPaths = [
        path.join(os.homedir(), 'Applications', 'Safari Apps', 'Jivam.app'),
        path.join(os.homedir(), 'Applications', 'Jivam.app'),
        '/Applications/Jivam.app',
      ]
      for (const appPath of safariAppPaths) {
        if (fs.existsSync(appPath)) {
          try {
            await execAsync(`open "${appPath}"`)
            console.log(`Launched Safari PWA: ${appPath}`)
            return
          } catch {}
        }
      }
    }

    // Safari is Jivam's preferred macOS browser — no PWA installed yet, so
    // open a plain Safari tab with the in-page Add to Dock walkthrough
    // (see AddToDockGuide in src/App.tsx). Only skip this if the user has
    // explicitly overridden to a Chromium browser via JIVAM_BROWSER.
    if (!browserOverride || browserOverride === 'safari') {
      try {
        await execAsync(
          `osascript -e 'tell application "Safari" to open location "${url}/?installGuide=safari-dock"' -e 'tell application "Safari" to activate'`
        )
        console.log('Opened in Safari — follow the on-screen instructions to add Jivam to your Dock.')
        return
      } catch (err) {
        console.warn('Failed to open Safari, falling back to Chromium browsers:', err)
      }
    }

    // Chrome, Edge, Brave — only tried if Safari failed or was explicitly
    // overridden. All support the --app flag.
    const macBrowsers: Array<[string, string]> = [
      ['chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      ['edge',   '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      ['brave',  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    ]
    for (const [key, browserPath] of macBrowsers) {
      if (browserOverride && browserOverride !== key) continue
      try {
        execFile(browserPath, [`--app=${url}`, '--disable-extensions'])
        console.log(`Opened in app-mode window: ${browserPath}`)
        return
      } catch {}
    }
  } else if (process.platform === 'win32') {
    // If Jivam was previously installed as a real Edge app, launch that
    // shortcut directly rather than opening a browser tab.
    const existingShortcut = findEdgePwaShortcut(0)
    if (existingShortcut) {
      try {
        await execAsync(`start "" "${existingShortcut}"`)
        console.log(`Launched Edge app: ${existingShortcut}`)
        return
      } catch {}
    }

    // No PWA installed yet — open a plain Edge tab with the in-page install
    // walkthrough (see AddToDockGuide in src/App.tsx). Edge ships by default
    // on every Windows install, so there's no Chrome/Brave fallback chain
    // here, and no --app= mode (that shares Edge's own window identity
    // rather than being a real, single-instance app).
    try {
      const edgePaths = [
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
      const edgePath = edgePaths.find(p => fs.existsSync(p))
      if (edgePath) {
        execFile(edgePath, [`${url}/?installGuide=edge-app`])
        console.log('Opened in Edge — follow the on-screen instructions to install Jivam as an app.')
        return
      }
    } catch {}

    // Last resort: default browser, whatever it is.
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

/**
 * Checks once a day whether newer jivamai/jiva-core versions are published.
 * If so, runs the update then exits — the OS-level service manager
 * (launchd KeepAlive on macOS, Scheduled Task RestartOnFailure on Windows)
 * brings the process back up running the new code. Only active in
 * --server-only mode (the persistent background instance).
 */
function scheduleUpdateCheck(): void {
  const DAY_MS = 24 * 60 * 60 * 1000

  const check = async () => {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      const currentPkg = JSON.parse(
        fs.readFileSync(path.join(__dirname_cjs, '..', 'package.json'), 'utf-8'),
      ) as { version: string }
      const { stdout } = await execAsync('npm view jivamai version')
      const latest = stdout.trim()

      if (latest && latest !== currentPkg.version) {
        console.log(`Update available: jivamai ${currentPkg.version} → ${latest}. Updating...`)
        await execAsync('npm install -g jivamai jiva-core')
        console.log('Update installed — restarting to pick it up.')
        process.exit(1) // non-zero so Windows RestartOnFailure also triggers; macOS KeepAlive restarts regardless
        return
      }
    } catch (err) {
      console.warn('Update check failed (probably offline):', err)
    }
    setTimeout(check, DAY_MS)
  }

  // First check after 24h — the install script already updates at install time
  setTimeout(check, DAY_MS)
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
const cliSubcommand = process.argv[2]
const isServiceAction = cliSubcommand === 'start' || cliSubcommand === 'stop'
  || cliSubcommand === 'restart' || cliSubcommand === 'status'

if (process.argv.includes('--install')) {
  const installFn = process.platform === 'win32' ? runInstallWindows : runInstall
  installFn().catch(err => { console.error(err); process.exit(1) })
} else if (isServiceAction) {
  const controlFn = process.platform === 'win32' ? winServiceControl : macServiceControl
  controlFn(cliSubcommand as 'start' | 'stop' | 'restart' | 'status')
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1) })
} else {

const isServerOnly = process.argv.includes('--server-only')

const server = http.createServer(app)
initWebSocketServer(server)

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`
  console.log(`Jivam server running at ${url}`)

  if (!IS_DEV && !isServerOnly) {
    await openAppWindow(url)
  }
  if (isServerOnly) {
    scheduleUpdateCheck()
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

} // end of non-install/non-service-action block
