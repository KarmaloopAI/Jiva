import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface SettingsStore {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('jivam-theme') as Theme | null
  if (stored) return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: 'light', // Will be set on first render

  toggleTheme: () => {
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem('jivam-theme', next)
      document.documentElement.setAttribute('data-theme', next)
      return { theme: next }
    })
  },

  setTheme: (theme) => {
    localStorage.setItem('jivam-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
}))

// Initialize theme on module load
if (typeof window !== 'undefined') {
  const theme = getInitialTheme()
  document.documentElement.setAttribute('data-theme', theme)
  useSettingsStore.getState().setTheme(theme)
}
