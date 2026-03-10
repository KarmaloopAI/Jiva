import { create } from 'zustand'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: number
}

interface FilesStore {
  /** The directory currently being viewed */
  currentDir: string
  /** Files/folders in the current directory */
  entries: FileEntry[]
  /** The path of the currently selected/previewed file (null = none) */
  selectedFile: string | null
  /** Content of the selected file */
  fileContent: string | null
  /** Set of expanded folder paths in the tree */
  expandedPaths: Set<string>

  isLoadingDir: boolean
  isLoadingFile: boolean
  error: string | null

  /** Navigate to a directory and load its contents */
  navigateTo: (dirPath: string) => Promise<void>
  /** Select a file and load its preview content */
  selectFile: (filePath: string) => Promise<void>
  /** Toggle whether a folder is expanded in the tree */
  toggleExpanded: (dirPath: string) => void
  /** Open a file/folder in Finder */
  openExternal: (filePath: string) => Promise<void>
  /** Clear selected file */
  clearSelection: () => void
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  currentDir: '',
  entries: [],
  selectedFile: null,
  fileContent: null,
  expandedPaths: new Set(),
  isLoadingDir: false,
  isLoadingFile: false,
  error: null,

  navigateTo: async (dirPath: string) => {
    set({ isLoadingDir: true, error: null })
    try {
      const raw = await window.electron.workspace.listFiles(dirPath) as FileEntry[]
      set({
        currentDir: dirPath,
        entries: raw,
        isLoadingDir: false,
        selectedFile: null,
        fileContent: null,
      })
    } catch (err) {
      set({
        isLoadingDir: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  selectFile: async (filePath: string) => {
    const { selectedFile } = get()
    if (selectedFile === filePath) return
    set({ selectedFile: filePath, isLoadingFile: true, fileContent: null, error: null })
    try {
      const content = await window.electron.workspace.readFile(filePath) as string | null
      set({ fileContent: content, isLoadingFile: false })
    } catch (err) {
      set({
        isLoadingFile: false,
        fileContent: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  toggleExpanded: (dirPath: string) => {
    const next = new Set(get().expandedPaths)
    if (next.has(dirPath)) {
      next.delete(dirPath)
    } else {
      next.add(dirPath)
    }
    set({ expandedPaths: next })
  },

  openExternal: async (filePath: string) => {
    await window.electron.workspace.openExternal(filePath)
  },

  clearSelection: () => {
    set({ selectedFile: null, fileContent: null })
  },
}))
