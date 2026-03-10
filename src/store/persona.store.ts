import { create } from 'zustand'
import type { PersonaInfo } from '../types/persona'

interface PersonaStore {
  personas: PersonaInfo[]
  activePersonaName: string | null
  isLoading: boolean
  isSwitching: boolean

  loadPersonas: () => Promise<void>
  switchPersona: (name: string) => Promise<void>
}

export const usePersonaStore = create<PersonaStore>((set) => ({
  personas: [],
  activePersonaName: 'chat',
  isLoading: false,
  isSwitching: false,

  loadPersonas: async () => {
    set({ isLoading: true })
    try {
      const personas = await window.electron.personas.list() as PersonaInfo[]
      set({ personas, isLoading: false })
    } catch (err) {
      console.error('[PersonaStore] Failed to load personas:', err)
      set({ isLoading: false })
    }
  },

  switchPersona: async (name: string) => {
    set({ isSwitching: true })
    try {
      const result = await window.electron.personas.activate(name) as { success: boolean }
      if (result.success) {
        set({ activePersonaName: name, isSwitching: false })
      } else {
        console.error('[PersonaStore] Failed to activate persona:', name)
        set({ isSwitching: false })
      }
    } catch (err) {
      console.error('[PersonaStore] Error switching persona:', err)
      set({ isSwitching: false })
    }
  },
}))
