import { augmentPath } from './path-helper'
augmentPath()

import express from 'express'
import http from 'http'
import path from 'path'
import fs from 'fs'
import os from 'os'
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

// ---------------------------------------------------------------------------
// jivam --install  (macOS only for now)
// Creates ~/Applications/Jivam.app — a self-contained shell wrapper that
// starts the server if not running, waits for it, then opens Chrome --app.
// Also adds the app to the Dock via `defaults write`.
// ---------------------------------------------------------------------------
/**
 * Install Jivam as a genuine Safari web app — a real, separate .app bundle
 * under ~/Applications/Safari Apps/ with its own bundle identifier
 * (com.apple.Safari.WebApp.<uuid>). This gives native macOS Dock semantics
 * for free: a distinct Dock icon and click-to-focus on the existing window
 * instead of spawning duplicates, which `chrome --app=` can never provide
 * (it shares Chrome's bundle ID).
 *
 * Safari's "Add to Dock" (macOS Sonoma+) has no CLI or URL-scheme trigger,
 * so this drives the File > Add to Dock menu item via System Events UI
 * scripting. This requires the user to grant Accessibility permission
 * (System Settings → Privacy & Security → Accessibility) to the calling
 * process (e.g. Terminal) the first time — if that's denied, or the OS is
 * pre-Sonoma, or anything else about this fails, it returns null and the
 * caller falls back to `chrome/edge/brave --app=` or plain Safari.
 */
function findSafariWebAppBundle(existingBefore: Set<string>): string | null {
  // Safari writes the bundle either into ~/Applications/Safari Apps/ or
  // directly into ~/Applications/, depending on macOS version. Scan both,
  // identifying by Info.plist content (CFBundleIdentifier + CFBundleName)
  // rather than filename, since we can't fully control the exact name.
  const searchDirs = [
    path.join(os.homedir(), 'Applications', 'Safari Apps'),
    path.join(os.homedir(), 'Applications'),
  ]
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.app'))
    for (const entry of entries) {
      if (existingBefore.has(`${dir}::${entry}`)) continue
      const plistPath = path.join(dir, entry, 'Contents', 'Info.plist')
      if (!fs.existsSync(plistPath)) continue
      try {
        const plistContent = fs.readFileSync(plistPath, 'utf-8')
        if (plistContent.includes('com.apple.Safari.WebApp') && plistContent.includes('<string>Jivam</string>')) {
          return path.join(dir, entry)
        }
      } catch {}
    }
  }
  return null
}

function snapshotExistingApps(): Set<string> {
  const searchDirs = [
    path.join(os.homedir(), 'Applications', 'Safari Apps'),
    path.join(os.homedir(), 'Applications'),
  ]
  const existing = new Set<string>()
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir).filter(f => f.endsWith('.app'))) {
      existing.add(`${dir}::${entry}`)
    }
  }
  return existing
}

/**
 * Install Jivam as a genuine Safari web app — a real, separate .app bundle
 * with its own bundle identifier (com.apple.Safari.WebApp.<uuid>). This
 * gives native macOS Dock semantics for free: a distinct Dock icon and
 * click-to-focus on the existing window instead of spawning duplicates,
 * which `chrome --app=` can never provide (it shares Chrome's bundle ID).
 *
 * Assumes `url` is already reachable — the caller is responsible for
 * ensuring the server is running before calling this.
 *
 * Safari's "Add to Dock" (macOS Sonoma+) has no CLI or URL-scheme trigger,
 * so this drives the File > Add to Dock… menu item via System Events UI
 * scripting. This requires the user to grant Accessibility permission
 * (System Settings → Privacy & Security → Accessibility) to the calling
 * process (e.g. Terminal) the first time — if that's denied, or the OS is
 * pre-Sonoma, or anything else about this fails, it returns null and the
 * caller falls back to a plain `--app=` wrapper.
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
      console.warn('Safari Add to Dock requires macOS Sonoma (14) or later — skipping.')
      return null
    }

    const existingBefore = snapshotExistingApps()

    const scriptPath = path.join(os.tmpdir(), 'jivam-add-to-dock.applescript')
    // Note: the real menu item name has a trailing ellipsis ("Add to Dock…").
    // It's also disabled unless Safari's process is explicitly frontmost via
    // System Events (not just `activate`), hence the extra frontmost dance.
    const script = `
on run
  tell application "Safari"
    activate
    if (count of windows) = 0 then
      make new document
    end if
    set URL of front document to "${url}"
  end tell
  delay 2
  tell application "Safari" to activate
  delay 1
  tell application "System Events" to tell process "Safari" to set frontmost to true
  delay 1
  tell application "System Events"
    tell process "Safari"
      click menu item "Add to Dock…" of menu "File" of menu bar 1
    end tell
  end tell
  delay 2
end run
`
    fs.writeFileSync(scriptPath, script)
    try {
      await execAsync(`osascript "${scriptPath}"`, { timeout: 20000 })
    } finally {
      fs.rmSync(scriptPath, { force: true })
    }

    // Safari's confirmation panel is deliberately excluded from the
    // Accessibility API (same category as Touch ID/Apple Pay prompts) —
    // installing an app is a security-sensitive action Apple requires a
    // genuine human click for, and that can't (and shouldn't) be scripted
    // around. Prompt the user, then poll for the resulting bundle.
    console.log('\nA "Add to Dock" confirmation opened in Safari — click Add to finish setting up Jivam as an app.')
    console.log('Waiting up to 60s for you to click it...')
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const found = findSafariWebAppBundle(existingBefore)
      if (found) return found
    }

    console.warn('No click detected within 60s — falling back to --app mode. Run `jivam --install` again anytime to retry.')
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('assistive access') || message.includes('-1719')) {
      console.warn(
        '\nSafari Add to Dock needs Accessibility permission (one-time setup) to control Safari\'s menus.\n' +
        'Opening System Settings — enable access for Terminal (or whichever app you ran this from),\n' +
        'then re-run: jivam --install\n' +
        'Falling back to --app mode for now — Jivam will still work, just without the native single-window Dock experience.',
      )
      try {
        await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"')
      } catch {}
    } else {
      console.warn('Safari Add to Dock automation failed, falling back to --app mode:', err)
    }
    return null
  }
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
const WIN_TASK_NAME = 'JivamServer'

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
  const launcherScript = `#!/bin/bash
URL="${url}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

if [ -f "$CHROME" ]; then
  "$CHROME" --app="$URL" --disable-extensions &
elif [ -f "$EDGE" ]; then
  "$EDGE" --app="$URL" --disable-extensions &
elif [ -f "$BRAVE" ]; then
  "$BRAVE" --app="$URL" --disable-extensions &
else
  osascript -e "tell application \\"Safari\\" to open location \\"$URL\\"" \\
            -e "tell application \\"Safari\\" to activate"
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
  console.log('Installing Jivam as a Safari web app (this may take a few seconds)...')
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

/**
 * Registers "JivamServer" as a Windows Scheduled Task: starts at logon,
 * restarts automatically on failure, runs hidden (no console window). This
 * is the Windows equivalent of the macOS LaunchAgent — the server runs
 * persistently in the background instead of being started on-demand by
 * whatever opens the Desktop/Start Menu shortcut.
 */
async function winRegisterTask(jivamBinPath: string): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const isQuotedCmd = jivamBinPath.startsWith('"')
  const [command, ...restArgs] = isQuotedCmd
    ? jivamBinPath.split('" "').map(s => s.replace(/^"|"$/g, ''))
    : [jivamBinPath]
  const args = [...restArgs, '--server-only'].join(' ')

  const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${command}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`
  const xmlPath = path.join(os.tmpdir(), 'jivam-task.xml')
  // Task Scheduler XML must be UTF-16LE with BOM
  fs.writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(taskXml, 'utf16le')]))
  try {
    await execAsync(`schtasks /Create /TN "${WIN_TASK_NAME}" /XML "${xmlPath}" /F`)
  } finally {
    fs.rmSync(xmlPath, { force: true })
  }
}

async function winServiceControl(action: 'start' | 'stop' | 'restart' | 'status'): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  try {
    await execAsync(`schtasks /Query /TN "${WIN_TASK_NAME}"`)
  } catch {
    console.log('Jivam background service is not installed. Run: jivam --install')
    return
  }

  if (action === 'start' || action === 'restart') {
    if (action === 'restart') {
      try { await execAsync(`schtasks /End /TN "${WIN_TASK_NAME}"`) } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    try {
      await execAsync(`schtasks /Run /TN "${WIN_TASK_NAME}"`)
      console.log(`Jivam background service ${action === 'restart' ? 'restarted' : 'started'}.`)
    } catch (err) {
      console.error(`Failed to ${action} service:`, err)
    }
  } else if (action === 'stop') {
    try {
      await execAsync(`schtasks /End /TN "${WIN_TASK_NAME}"`)
      console.log('Jivam background service stopped.')
    } catch {
      console.warn('Service was not running (or already stopped).')
    }
  } else if (action === 'status') {
    try {
      const { stdout } = await execAsync(`schtasks /Query /TN "${WIN_TASK_NAME}" /FO LIST /V`)
      const statusMatch = stdout.match(/Status:\s*(.+)/)
      console.log(statusMatch ? `Jivam background service status: ${statusMatch[1].trim()}` : 'Jivam background service is registered.')
    } catch {
      console.log('Jivam background service is not running.')
    }
  }
}

// ---------------------------------------------------------------------------
// jivam --install  (Windows)
// Registers a Scheduled Task so the server runs persistently in the
// background (started at logon, restarted automatically on failure), then
// creates Desktop + Start Menu shortcuts that just open the browser — no
// server-start logic needed there anymore since the task keeps it alive.
// ---------------------------------------------------------------------------
async function runInstallWindows(): Promise<void> {
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

  const url = `http://localhost:${PORT}`

  // ── 1. Resolve the jivam binary and register the background task ─────────
  console.log('Setting up the Jivam background service...')
  const jivamBinPath = await winFindJivamBin()
  await winRegisterTask(jivamBinPath)
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

  // ── 3. Shortcut launcher — just opens the browser (server is already up) ──
  const batScript = `@echo off
set URL=${url}
set CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe
set EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe

if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --disable-extensions
) else if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --disable-extensions
) else (
  start "" %URL%
)
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

  console.log('\nDone! Double-click the Jivam icon on your Desktop to launch.')
  console.log('The server runs continuously in the background — manage it with:')
  console.log('  jivam stop      jivam start      jivam restart      jivam status')
  process.exit(0)
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

    if (browserOverride === 'safari') {
      // Safari regular window — user hasn't installed PWA yet
      try {
        await execAsync(
          `osascript -e 'tell application "Safari" to open location "${url}"' -e 'tell application "Safari" to activate'`
        )
        console.log('Opened in Safari (tip: File → Add to Dock for app experience)')
        return
      } catch (err) {
        console.error('Failed to open Safari:', err)
      }
    }

    if (browserOverride !== 'safari') {
      // Try Chrome, Edge, Brave — all support --app flag
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
    }

    // Safari fallback when no Chromium found and no override
    if (!browserOverride) {
      try {
        await execAsync(
          `osascript -e 'tell application "Safari" to open location "${url}"' -e 'tell application "Safari" to activate'`
        )
        console.log('Opened in Safari (tip: File → Add to Dock for app experience)')
        return
      } catch {}
    }
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
