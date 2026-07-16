import { create } from 'zustand'
import type { UpdateStatus } from '../types/electron'

type Phase = 'idle' | 'checking' | 'available' | 'installing' | 'restarting' | 'reconnecting' | 'reload-ready' | 'error'

interface UpdaterStore {
  phase: Phase
  currentVersion: string | null
  latestVersion: string | null
  errorMessage: string | null
  modalOpen: boolean
  reloadCountdown: number | null

  init: () => void
  checkForUpdate: () => Promise<void>
  applyUpdate: () => Promise<void>
  openModal: () => void
  closeModal: () => void
  dismissBanner: () => void
  cancelReload: () => void
}

let initialized = false
let reconnectPollTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

function clearTimers(): void {
  if (reconnectPollTimer) { clearInterval(reconnectPollTimer); reconnectPollTimer = null }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
}

// Once the backend has been killed for the restart, the frontend must not
// treat the resulting disconnect as an error — it quietly polls a cheap,
// always-available endpoint until the server answers again, then counts
// down to a reload rather than talking to the (possibly still-settling)
// backend any further than that.
function startReconnectPolling(set: (partial: Partial<UpdaterStore>) => void): void {
  clearTimers()
  const startedAt = Date.now()
  const TIMEOUT_MS = 2 * 60 * 1000

  reconnectPollTimer = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      clearTimers()
      set({
        phase: 'error',
        errorMessage: 'Jivam is taking longer than expected to restart. Try refreshing the page in a minute, or run `jivam status` from a terminal.',
      })
      return
    }
    try {
      const res = await fetch('/api/version')
      if (!res.ok) return
      const newVersion = await res.json().catch(() => null) as string | null
      clearTimers()
      set({ phase: 'reload-ready', reloadCountdown: 3, ...(newVersion ? { currentVersion: newVersion } : {}) })
      startReloadCountdown()
    } catch {
      // Still down — expected while the server restarts. Keep polling quietly.
    }
  }, 1500)
}

function startReloadCountdown(): void {
  countdownTimer = setInterval(() => {
    const { reloadCountdown } = useUpdaterStore.getState()
    if (reloadCountdown === null) {
      clearTimers()
      return
    }
    const next = reloadCountdown - 1
    if (next <= 0) {
      clearTimers()
      window.location.reload()
      return
    }
    useUpdaterStore.setState({ reloadCountdown: next })
  }, 1000)
}

// `respectDismiss` suppresses re-surfacing the banner for a version the user
// already dismissed — used for passive status arrivals (initial getStatus on
// mount, WebSocket broadcasts from the periodic background check). An
// explicit user-initiated check (the About tab's "Check for Updates") always
// shows the real result regardless, since dismissing the passive banner
// shouldn't block a check the user asked for directly.
function applyStatus(set: (partial: Partial<UpdaterStore>) => void, status: UpdateStatus, respectDismiss = true): void {
  if ('currentVersion' in status && status.currentVersion) {
    set({ currentVersion: status.currentVersion })
  }
  switch (status.state) {
    case 'idle':
      set({ phase: 'idle' })
      break
    case 'checking':
      set({ phase: 'checking' })
      break
    case 'available':
      if (respectDismiss && localStorage.getItem('jivam-update-dismissed') === status.latestVersion) {
        set({ phase: 'idle', latestVersion: status.latestVersion })
      } else {
        set({ phase: 'available', latestVersion: status.latestVersion })
      }
      break
    case 'installing':
      set({ phase: 'installing' })
      break
    case 'restarting':
      set({ phase: 'reconnecting' })
      startReconnectPolling(set)
      break
    case 'error':
      clearTimers()
      set({ phase: 'error', errorMessage: status.message })
      break
  }
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  phase: 'idle',
  currentVersion: null,
  latestVersion: null,
  errorMessage: null,
  modalOpen: false,
  reloadCountdown: null,

  init: () => {
    if (initialized || !window.electron?.updater) return
    initialized = true

    window.electron.updater.onStatus((status) => applyStatus(set, status))
    window.electron.updater.getStatus().then((status) => applyStatus(set, status)).catch(() => {})
  },

  checkForUpdate: async () => {
    if (!window.electron?.updater) return
    try {
      const status = await window.electron.updater.check()
      applyStatus(set, status, false)
    } catch {
      set({ phase: 'idle' })
    }
  },

  applyUpdate: async () => {
    set({ modalOpen: true })
    if (!window.electron?.updater) return
    try {
      const result = await window.electron.updater.apply()
      if (!result.success) {
        set({ phase: 'error', errorMessage: result.error ?? 'Update failed to start.' })
      }
      // Success case: phase transitions (installing → restarting → ...)
      // arrive via the onStatus WebSocket listener, not this response.
    } catch (err) {
      set({ phase: 'error', errorMessage: err instanceof Error ? err.message : 'Update failed to start.' })
    }
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  dismissBanner: () => {
    const { latestVersion } = get()
    if (latestVersion) localStorage.setItem('jivam-update-dismissed', latestVersion)
    set({ phase: 'idle' })
  },

  cancelReload: () => {
    clearTimers()
    set({ reloadCountdown: null, phase: 'idle', modalOpen: false })
  },
}))
