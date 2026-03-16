import { create } from 'zustand'
import type { GitFile } from '../types/electron'

interface GitStore {
  isRepo: boolean
  workspaceDir: string
  changedFiles: GitFile[]
  selectedFile: string | null
  diffContent: string | null
  isLoadingDiff: boolean
  isLoadingStatus: boolean

  setWorkspaceDir: (dir: string) => void
  checkIsRepo: () => Promise<void>
  refresh: () => Promise<void>
  selectFile: (file: string | null) => Promise<void>
  initRepo: () => Promise<{ success: boolean; error?: string }>
}

export const useGitStore = create<GitStore>((set, get) => ({
  isRepo: false,
  workspaceDir: '',
  changedFiles: [],
  selectedFile: null,
  diffContent: null,
  isLoadingDiff: false,
  isLoadingStatus: false,

  setWorkspaceDir: (dir: string) => {
    set({ workspaceDir: dir, selectedFile: null, diffContent: null, changedFiles: [] })
  },

  checkIsRepo: async () => {
    const { workspaceDir } = get()
    if (!workspaceDir) return
    try {
      const result = await window.electron.git.isRepo(workspaceDir)
      set({ isRepo: result })
      if (result) get().refresh()
    } catch {
      set({ isRepo: false })
    }
  },

  refresh: async () => {
    const { workspaceDir, isRepo } = get()
    if (!workspaceDir || !isRepo) return
    set({ isLoadingStatus: true })
    try {
      const files = await window.electron.git.status(workspaceDir)
      set({ changedFiles: files, isLoadingStatus: false })
    } catch {
      set({ isLoadingStatus: false })
    }
  },

  initRepo: async () => {
    const { workspaceDir } = get()
    if (!workspaceDir) return { success: false, error: 'No workspace directory set' }
    const result = await window.electron.git.initRepo(workspaceDir)
    if (result.success) {
      set({ isRepo: true })
      get().refresh()
    }
    return result
  },

  selectFile: async (file: string | null) => {
    if (!file) {
      set({ selectedFile: null, diffContent: null })
      return
    }
    set({ selectedFile: file, isLoadingDiff: true, diffContent: null })
    try {
      const { workspaceDir } = get()
      const diff = await window.electron.git.diffFile(workspaceDir, file)
      set({ diffContent: diff, isLoadingDiff: false })
    } catch {
      set({ isLoadingDiff: false })
    }
  },
}))
