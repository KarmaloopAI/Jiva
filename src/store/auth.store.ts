import { create } from 'zustand'
import { cloudApiSignIn, cloudApiSignUp, cloudApiSignOut, cloudApiInit } from '../lib/cloud-api'

const STORAGE_KEY = 'jivam-cloud-session'

/**
 * Whether this window is a cloud window.
 * - In Electron: true only when the URL has ?mode=cloud (i.e. we opened the cloud BrowserWindow)
 * - In a web browser (jivamai.com): always true (no window.electron exists)
 */
const isCloudWindow =
  !window.electron ||
  new URLSearchParams(window.location.search).get('mode') === 'cloud'

interface CloudSession {
  userId: string
  email: string
  sessionId: string
}

function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

interface AuthStore {
  isCloudMode: boolean
  cloudUser: { id: string; email: string } | null
  isLoading: boolean
  error: string | null

  restoreSession: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  // isCloudMode is permanently true in the cloud window and false in the local window.
  // It does NOT flip when the user signs out — the window type is fixed at creation.
  isCloudMode: isCloudWindow,
  cloudUser: null,
  isLoading: false,
  error: null,

  restoreSession: () => {
    // Local window never enters cloud mode, even if a cloud session exists in localStorage
    if (!isCloudWindow) return

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const session = JSON.parse(raw) as CloudSession
      if (!session.userId || !session.sessionId) return

      set({ cloudUser: { id: session.userId, email: session.email } })

      // Re-configure cloud runner (fire and forget — failure is non-fatal here)
      cloudApiInit(session.userId, session.sessionId).catch((err) => {
        console.warn('[auth] Failed to restore cloud session:', err)
      })
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const result = await cloudApiSignIn(email, password)

      const sessionId = generateSessionId()
      const session: CloudSession = { userId: result.userId, email: result.email, sessionId }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))

      // Set cloudUser immediately so the app transitions to AppShell without waiting
      // for the Cloud Run session init (which may cold-start slowly)
      set({ cloudUser: { id: result.userId, email: result.email }, isLoading: false, error: null })

      cloudApiInit(result.userId, sessionId).catch((err) => {
        console.warn('[auth] Cloud session init failed (will retry on first message):', err)
      })
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  signUp: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const result = await cloudApiSignUp(email, password)

      const sessionId = generateSessionId()
      const session: CloudSession = { userId: result.userId, email: result.email, sessionId }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))

      // Set cloudUser immediately so the app transitions to AppShell without waiting
      // for the Cloud Run session init (which may cold-start slowly)
      set({ cloudUser: { id: result.userId, email: result.email }, isLoading: false, error: null })

      cloudApiInit(result.userId, sessionId).catch((err) => {
        console.warn('[auth] Cloud session init failed (will retry on first message):', err)
      })
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  signOut: async () => {
    localStorage.removeItem(STORAGE_KEY)
    await cloudApiSignOut()
    // Keep isCloudMode: true — this is the cloud window, it stays that way.
    // Clearing cloudUser sends App.tsx back to the sign-in screen.
    set({ cloudUser: null, error: null })
  },

  clearError: () => set({ error: null }),
}))
