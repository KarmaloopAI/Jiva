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
 * Applies the update the user asked for: spawns a detached "updater process"
 * that runs `npm install -g jivamai jiva-core`, independent of this process.
 * Once it exits successfully, this (still-running) process broadcasts
 * 'restarting' and exits — the OS-level service supervisor (launchd
 * KeepAlive on macOS, the self-restarting PowerShell loop on Windows) brings
 * the process back up running the newly-installed code.
 *
 * Deliberately a separate child process rather than running npm install
 * in-process: on Windows, a running process's own script files can be
 * locked in ways POSIX doesn't have, so overwriting them out from under the
 * very process that's executing them is the kind of thing worth not risking.
 * A detached child sidesteps that entirely.
 */
export async function applyUpdate(): Promise<{ success: boolean; error?: string }> {
  if (status.state === 'installing' || status.state === 'restarting') {
    return { success: false, error: 'An update is already in progress.' }
  }

  setStatus({ state: 'installing' })

  const jivamHome = path.join(os.homedir(), '.jivam')
  fs.mkdirSync(jivamHome, { recursive: true })
  const logPath = path.join(jivamHome, 'update.log')
  const logFd = fs.openSync(logPath, 'a')
  fs.writeSync(logFd, `\n--- ${new Date().toISOString()}: starting update ---\n`)

  return new Promise((resolve) => {
    let child
    try {
      child = spawn('npm', ['install', '-g', 'jivamai', 'jiva-core'], {
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
      fs.closeSync(logFd)
      if (code === 0) {
        setStatus({ state: 'restarting' })
        resolve({ success: true })
        // Give the WebSocket broadcast a moment to actually flush to
        // clients before this process (and its WS connections) die.
        setTimeout(() => process.exit(0), 500)
      } else {
        const message = `Update failed (npm install exited with code ${code}). See ${logPath}`
        setStatus({ state: 'error', message })
        resolve({ success: false, error: message })
      }
    })

    child.unref()
  })
}

export function getLatestKnownVersion(): string | null {
  return latestKnownVersion
}
