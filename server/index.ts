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
async function runInstall(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('--install is currently only supported on macOS.')
    process.exit(1)
  }

  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  const os_tmpdir = os.tmpdir()

  const appDir = path.join(os.homedir(), 'Applications')
  const appPath = path.join(appDir, 'Jivam.app')
  const macOSDir = path.join(appPath, 'Contents', 'MacOS')
  const resourcesDir = path.join(appPath, 'Contents', 'Resources')

  // ── 1. Resolve the absolute path to the jivam binary ──────────────────────
  // Dock-launched apps don't inherit shell PATH, so we must bake in the full
  // path. Try `which jivam` first; if that fails, scan common npm global dirs.
  let jivamBinPath = ''
  try {
    const { stdout } = await execAsync('which jivam')
    jivamBinPath = stdout.trim()
  } catch {
    // `which` failed — search common npm global bin locations
    const candidates = [
      '/usr/local/bin/jivam',
      path.join(os.homedir(), '.npm-global', 'bin', 'jivam'),
      path.join(os.homedir(), '.nvm', 'versions', 'node'),  // nvm — resolved below
      '/opt/homebrew/bin/jivam',
      '/usr/bin/jivam',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) { jivamBinPath = c; break }
    }
    // nvm: find the active node version and check its bin
    if (!jivamBinPath) {
      const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
      if (fs.existsSync(nvmDir)) {
        try {
          const versions = fs.readdirSync(nvmDir).sort().reverse()
          for (const v of versions) {
            const p = path.join(nvmDir, v, 'bin', 'jivam')
            if (fs.existsSync(p)) { jivamBinPath = p; break }
          }
        } catch {}
      }
    }
  }

  if (!jivamBinPath) {
    // Last resort: use the node binary + this very script
    const nodeBin = process.execPath
    const scriptArg = process.argv[1]
    jivamBinPath = `"${nodeBin}" "${scriptArg}"`
  }

  // ── 2. Build the launcher shell script ────────────────────────────────────
  // Augment PATH so that node/npm side effects (e.g. npx calls inside jivam)
  // work correctly even without a login shell.
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.nvm', 'versions', 'node'),
    '/usr/bin',
    '/bin',
  ].join(':')

  // Resolve npm binary alongside the jivam binary
  const npmBinDir = path.dirname(jivamBinPath.replace(/^"/, '').replace(/"$/, '').split('"')[0])
  const npmBin = path.join(npmBinDir, 'npm')
  const npmCmd = fs.existsSync(npmBin) ? `"${npmBin}"` : 'npm'

  const launcherScript = `#!/bin/bash
# Jivam launcher — auto-updates jivam + jiva-core, starts the server, opens Chrome --app.
export PATH="${extraPaths}:$PATH"

PORT=7842
URL="http://localhost:$PORT"
LOG="$HOME/.jivam/jivam.log"
UPDATE_STAMP="$HOME/.jivam/.last-update"

mkdir -p "$HOME/.jivam"
echo "--- $(date): launcher started ---" >> "$LOG"

# ── Auto-update (at most once per day, runs in background so launch stays fast)
should_update=false
if [ ! -f "$UPDATE_STAMP" ]; then
  should_update=true
else
  # mtime of stamp file vs now — update if older than 86400 s
  stamp_age=$(( $(date +%s) - $(stat -f %m "$UPDATE_STAMP" 2>/dev/null || echo 0) ))
  [ "$stamp_age" -gt 86400 ] && should_update=true
fi

if [ "$should_update" = true ]; then
  (
    echo "$(date): checking for updates..." >> "$LOG"
    touch "$UPDATE_STAMP"
    ${npmCmd} install -g jivam-app jiva-core >> "$LOG" 2>&1
    echo "$(date): update check complete" >> "$LOG"
  ) &
fi

# ── Start server if not already running
if ! curl -sf "$URL/api/version" > /dev/null 2>&1; then
  ${jivamBinPath} >> "$LOG" 2>&1 &
  SERVER_PID=$!
  echo "$(date): started jivam server (pid $SERVER_PID)" >> "$LOG"

  # Wait up to 20 s for the server to become ready (40 × 0.5 s)
  for i in $(seq 1 40); do
    sleep 0.5
    if curl -sf "$URL/api/version" > /dev/null 2>&1; then
      echo "$(date): server ready" >> "$LOG"
      break
    fi
  done
fi

# ── Open in Chrome --app mode (best experience), fall back to Safari
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

  // ── 3. Info.plist ─────────────────────────────────────────────────────────
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

  // ── 4. Write bundle ────────────────────────────────────────────────────────
  fs.mkdirSync(macOSDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })

  const launcherPath = path.join(macOSDir, 'jivam-launcher')
  fs.writeFileSync(launcherPath, launcherScript, { mode: 0o755 })
  fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), infoPlist)

  // ── 5. Convert PNG → .icns via sips + iconutil ───────────────────────────
  // Searching: dist/icon-512.png (production) or public/icon-512.png (dev)
  const iconSrcCandidates = [
    path.join(__dirname_cjs, '..', 'dist', 'icon-512.png'),
    path.join(__dirname_cjs, '..', 'public', 'icon-512.png'),
  ]
  const iconSrc = iconSrcCandidates.find(p => fs.existsSync(p))

  if (iconSrc) {
    try {
      const iconsetDir = path.join(os_tmpdir, 'Jivam.iconset')
      fs.mkdirSync(iconsetDir, { recursive: true })

      // sips generates all required icon sizes from our 512px source
      const sizes: Array<[number, string]> = [
        [16,  'icon_16x16.png'],
        [32,  'icon_16x16@2x.png'],
        [32,  'icon_32x32.png'],
        [64,  'icon_32x32@2x.png'],
        [128, 'icon_128x128.png'],
        [256, 'icon_128x128@2x.png'],
        [256, 'icon_256x256.png'],
        [512, 'icon_256x256@2x.png'],
        [512, 'icon_512x512.png'],
      ]
      for (const [size, name] of sizes) {
        await execAsync(
          `sips -z ${size} ${size} "${iconSrc}" --out "${path.join(iconsetDir, name)}"`,
        )
      }
      // iconutil assembles the iconset into an .icns file
      const icnsPath = path.join(resourcesDir, 'Jivam.icns')
      await execAsync(`iconutil -c icns "${iconsetDir}" --output "${icnsPath}"`)
      // Cleanup temp iconset
      fs.rmSync(iconsetDir, { recursive: true, force: true })
      console.log('Icon created successfully.')
    } catch (err) {
      console.warn('Could not convert icon (sips/iconutil failed):', err)
    }
  } else {
    console.warn('No icon found at dist/icon-512.png or public/icon-512.png — app will use default macOS icon.')
  }

  console.log(`Created ${appPath}`)

  // ── 6. Register with LaunchServices + flush Dock icon cache ───────────────
  // `touch` bumps the bundle's mtime so the Dock invalidates its cached icon.
  // lsregister -f forces LaunchServices to re-read the bundle immediately.
  // Then killall Dock picks up both the new entry and the fresh icon.
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  try {
    await execAsync(`touch "${appPath}"`)
    await execAsync(`"${lsregister}" -f "${appPath}"`)
  } catch {}

  // ── 7. Add to Dock ────────────────────────────────────────────────────────
  const dockEntry = `<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>${appPath}</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>`
  try {
    await execAsync(
      `defaults write com.apple.dock persistent-apps -array-add '${dockEntry}' && killall Dock`
    )
    console.log('Added Jivam to the Dock.')
  } catch (err) {
    console.warn('Could not add to Dock automatically — drag Jivam.app to your Dock manually.')
    console.warn(err)
  }

  console.log('\nDone! Click the Jivam icon in your Dock to launch.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// jivam --install  (Windows)
// Creates %LOCALAPPDATA%\Jivam\jivam-launcher.bat (hidden via a VBScript
// wrapper so no terminal flickers), a .ico icon, and Desktop + Start-Menu
// shortcuts with the icon baked in.
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

  // ── Resolve jivam binary ──────────────────────────────────────────────────
  let jivamBinPath = ''
  try {
    const { stdout } = await execAsync('where jivam')
    jivamBinPath = stdout.split('\n')[0].trim()
  } catch {
    const candidates = [
      path.join(localAppData, 'npm', 'jivam.cmd'),
      path.join(process.env.APPDATA ?? '', 'npm', 'jivam.cmd'),
      'C:\\Program Files\\nodejs\\jivam.cmd',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) { jivamBinPath = c; break }
    }
  }
  if (!jivamBinPath) {
    jivamBinPath = `"${process.execPath}" "${process.argv[1]}"`
  }

  // Resolve npm alongside jivam on Windows
  const winNpmCmd = path.join(path.dirname(jivamBinPath), 'npm.cmd')
  const winNpm = fs.existsSync(winNpmCmd) ? `"${winNpmCmd}"` : 'npm'

  // ── Batch launcher ────────────────────────────────────────────────────────
  // Auto-updates jivam + jiva-core (once per day), starts the server if not
  // running, waits for it, then opens Chrome/Edge --app mode.
  const batScript = `@echo off
setlocal enabledelayedexpansion
set PORT=7842
set URL=http://localhost:%PORT%
set JIVAM_DIR=%LOCALAPPDATA%\\Jivam
set LOG=%JIVAM_DIR%\\jivam.log
set UPDATE_STAMP=%JIVAM_DIR%\\.last-update

if not exist "%JIVAM_DIR%" mkdir "%JIVAM_DIR%"
echo --- %date% %time%: launcher started --- >> "%LOG%"

:: ── Auto-update (at most once per day, runs async so launch is fast)
set DO_UPDATE=0
if not exist "%UPDATE_STAMP%" (
  set DO_UPDATE=1
) else (
  :: Compare today's date to the stamp file's date
  for /F "usebackq" %%A in ('%UPDATE_STAMP%') do set STAMP_DATE=%%~tA
  if not "%STAMP_DATE:~0,10%" == "%date%" set DO_UPDATE=1
)

if "%DO_UPDATE%"=="1" (
  echo %date% %time%: checking for updates >> "%LOG%"
  echo. > "%UPDATE_STAMP%"
  start /B "" cmd /C "${winNpm} install -g jivam-app jiva-core >> "%LOG%" 2>&1"
)

:: ── Start server if not already running
curl -sf %URL%/api/version > nul 2>&1
if %errorlevel% neq 0 (
  echo %date% %time%: starting jivam server >> "%LOG%"
  start /B "" "${jivamBinPath}" >> "%LOG%" 2>&1

  :: Wait up to 20 s (40 x 500 ms)
  for /L %%i in (1,1,40) do (
    ping -n 1 -w 500 127.0.0.1 > nul
    curl -sf %URL%/api/version > nul 2>&1
    if !errorlevel! equ 0 (
      echo %date% %time%: server ready >> "%LOG%"
      goto :open
    )
  )
)

:open
:: Open in Chrome --app mode; fall back to Edge, then default browser
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

// Handle --install flag before starting the server
if (process.argv.includes('--install')) {
  const installFn = process.platform === 'win32' ? runInstallWindows : runInstall
  installFn().catch(err => { console.error(err); process.exit(1) })
} else {

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

} // end of non-install block
