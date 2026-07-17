import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { broadcast } from './ws'

// ---------------------------------------------------------------------------
// npm-registry-based auto-updater.
//
// Detection is periodic and silent; applying an update is not — it only
// happens when the frontend explicitly asks for it (POST /api/system/update),
// which the UI gates behind a user click. This replaces the old
// scheduleUpdateCheck(), which checked once a day and, if a newer version was
// published, silently ran `npm install` and killed the process with zero
// visibility for the user. That's the wrong shape for a real update
// experience — detect quietly, but always let the user decide when to apply.
// ---------------------------------------------------------------------------

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; latestVersion: string }
  | { state: 'installing' }
  | { state: 'restarting' }
  | { state: 'error'; message: string }

let status: UpdateStatus = { state: 'idle' }
let latestKnownVersion: string | null = null

function setStatus(next: UpdateStatus): void {
  status = next
  broadcast('jivam:update-status', next)
}

export function getStatus(): UpdateStatus {
  return status
}

export function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string }
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

async function fetchLatestNpmVersion(pkgName: string): Promise<string | null> {
  const res = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null
  const body = await res.json() as { version?: string }
  return body.version ?? null
}

/** Plain 3-part numeric semver compare — jivamai versions never carry prerelease tags. */
function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(n => parseInt(n, 10) || 0)
  const b = current.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * Checks npmjs.org for a newer `jivamai` release. Only ever transitions to
 * 'available' or back to 'idle' — never applies anything itself. Safe to
 * call repeatedly (e.g. from both the periodic schedule and an on-demand
 * "Check for Updates" click) since it's idempotent and cheap.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  // Don't let a check clobber an in-flight install/restart.
  if (status.state === 'installing' || status.state === 'restarting') return status

  setStatus({ state: 'checking' })
  try {
    const current = getCurrentVersion()
    const latest = await fetchLatestNpmVersion('jivamai')
    if (latest && isNewerVersion(latest, current)) {
      latestKnownVersion = latest
      setStatus({ state: 'available', latestVersion: latest })
    } else {
      setStatus({ state: 'idle' })
    }
  } catch (err) {
    // Quiet failure (offline, registry hiccup) — don't alarm the user over
    // a background check; just settle back to idle.
    console.warn('[updater] Version check failed:', err instanceof Error ? err.message : err)
    setStatus({ state: 'idle' })
  }
  return status
}

/** Checks once shortly after startup, then every 6 hours. Caller decides when this runs (only in --server-only mode). */
export function scheduleUpdateChecks(): void {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000
  setTimeout(() => { void checkForUpdate() }, 30_000)
  setInterval(() => { void checkForUpdate() }, SIX_HOURS_MS)
}

/**
 * Reads the version actually written to disk by the most recent `npm install
 * -g`, straight from the global node_modules — no registry involved, so this
 * is ground truth for "what's installed right now," unlike a fresh registry
 * fetch (which is exactly what falsely-reported success as a "latest" dist-tag
 * propagation lag, see the comment on applyUpdate below).
 */
async function getGlobalPackageVersion(pkgName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['root', '-g'], { shell: process.platform === 'win32' })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      try {
        const pkgJsonPath = path.join(out.trim(), pkgName, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { version?: string }
        resolve(pkg.version ?? null)
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Applies the update the user asked for: spawns a detached "updater process"
 * that runs `npm install -g jivamai@<exact target version> jiva-core`,
 * independent of this process. Once it exits successfully, this
 * (still-running) process broadcasts 'restarting' and exits — the OS-level
 * service supervisor (launchd KeepAlive on macOS, the self-restarting
 * PowerShell loop on Windows) brings the process back up running the
 * newly-installed code.
 *
 * Deliberately a separate child process rather than running npm install
 * in-process: on Windows, a running process's own script files can be
 * locked in ways POSIX doesn't have, so overwriting them out from under the
 * very process that's executing them is the kind of thing worth not risking.
 * A detached child sidesteps that entirely.
 *
 * Two hard-won details here, found by tracing a real report of "update said
 * it worked, but the server came back on the old version with no error":
 *
 * 1. The install is pinned to the exact version `checkForUpdate()` already
 *    confirmed exists (`jivamai@${targetVersion}`), not a bare `jivamai`
 *    (which resolves through the registry's *mutable* `latest` dist-tag).
 *    Right after a fresh publish, a specific version's tarball is available
 *    well before the `latest` pointer has finished propagating across the
 *    registry's CDN/cache layers — so a bare `npm install -g jivamai` run in
 *    that window can silently resolve back to the *previous* version, exit
 *    0 (npm considers "already satisfies the resolved spec" a success, not
 *    a no-op error), and report nothing wrong. Asking for the exact version
 *    number sidesteps dist-tag propagation entirely.
 * 2. Even with that pin, this now verifies the version actually on disk
 *    afterward (`getGlobalPackageVersion`) instead of trusting exit code 0
 *    alone — belt-and-suspenders against any other way npm could exit clean
 *    without the package actually changing.
 */
export async function applyUpdate(): Promise<{ success: boolean; error?: string }> {
  if (status.state === 'installing' || status.state === 'restarting') {
    return { success: false, error: 'An update is already in progress.' }
  }

  const targetVersion = latestKnownVersion
  setStatus({ state: 'installing' })

  const jivamHome = path.join(os.homedir(), '.jivam')
  fs.mkdirSync(jivamHome, { recursive: true })
  const logPath = path.join(jivamHome, 'update.log')
  const logFd = fs.openSync(logPath, 'a')
  fs.writeSync(logFd, `\n--- ${new Date().toISOString()}: starting update (target ${targetVersion ?? 'unknown, unpinned'}) ---\n`)

  const jivamaiSpec = targetVersion ? `jivamai@${targetVersion}` : 'jivamai'

  return new Promise((resolve) => {
    let child
    try {
      child = spawn('npm', ['install', '-g', jivamaiSpec, 'jiva-core'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: process.platform === 'win32',
      })
    } catch (err) {
      fs.closeSync(logFd)
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ state: 'error', message })
      resolve({ success: false, error: message })
      return
    }

    child.on('error', (err) => {
      fs.closeSync(logFd)
      setStatus({ state: 'error', message: err.message })
      resolve({ success: false, error: err.message })
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        fs.closeSync(logFd)
        const message = `Update failed (npm install exited with code ${code}). See ${logPath}`
        setStatus({ state: 'error', message })
        resolve({ success: false, error: message })
        return
      }

      void getGlobalPackageVersion('jivamai').then((installedVersion) => {
        if (targetVersion && installedVersion && installedVersion !== targetVersion) {
          fs.writeSync(logFd, `npm install exited 0 but installed version is ${installedVersion}, expected ${targetVersion} — likely a registry "latest" propagation lag.\n`)
          fs.closeSync(logFd)
          const message = `Update reported success, but ${installedVersion} is installed instead of ${targetVersion}. This usually means npm's registry hadn't fully caught up yet — wait a minute and try again.`
          setStatus({ state: 'error', message })
          resolve({ success: false, error: message })
          return
        }

        fs.closeSync(logFd)
        setStatus({ state: 'restarting' })
        resolve({ success: true })
        // Give the WebSocket broadcast a moment to actually flush to
        // clients before this process (and its WS connections) die.
        setTimeout(() => process.exit(0), 500)
      })
    })

    child.unref()
  })
}

export function getLatestKnownVersion(): string | null {
  return latestKnownVersion
}
