import { useEffect, useState } from 'react'
import { Folder, FolderOpen, File, ChevronRight, ChevronDown } from 'lucide-react'
import { useFilesStore, type FileEntry } from '../../store/files.store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface FolderNodeProps {
  entry: FileEntry
  depth: number
}

function FolderNode({ entry, depth }: FolderNodeProps) {
  const { expandedPaths, toggleExpanded, selectFile, selectedFile } = useFilesStore()
  const [children, setChildren] = useState<FileEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const isExpanded = expandedPaths.has(entry.path)

  async function handleToggle() {
    toggleExpanded(entry.path)
    if (!loaded) {
      try {
        const raw = await window.electron.workspace.listFiles(entry.path) as FileEntry[]
        setChildren(raw)
        setLoaded(true)
      } catch {
        setLoaded(true)
      }
    }
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-1.5 py-1 px-2 rounded-lg text-left transition-colors hover:bg-[rgba(139,92,246,0.06)] group"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <span className="flex-shrink-0 text-[var(--text-subtle)]">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {isExpanded ? (
          <FolderOpen size={14} className="flex-shrink-0 text-[var(--accent)]" />
        ) : (
          <Folder size={14} className="flex-shrink-0 text-[var(--text-muted)]" />
        )}
        <span className="text-xs truncate text-[var(--text)]">{entry.name}</span>
      </button>

      {isExpanded && loaded && (
        <div>
          {children.length === 0 && (
            <p
              className="text-[10px] text-[var(--text-subtle)] italic"
              style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}
            >
              Empty
            </p>
          )}
          {children
            .sort((a, b) => {
              if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
              return a.name.localeCompare(b.name)
            })
            .map((child) =>
              child.isDirectory ? (
                <FolderNode key={child.path} entry={child} depth={depth + 1} />
              ) : (
                <FileNode key={child.path} entry={child} depth={depth + 1} />
              )
            )}
        </div>
      )}
    </div>
  )
}

interface FileNodeProps {
  entry: FileEntry
  depth: number
}

function FileNode({ entry, depth }: FileNodeProps) {
  const { selectFile, selectedFile } = useFilesStore()
  const isSelected = selectedFile === entry.path

  return (
    <button
      onClick={() => selectFile(entry.path)}
      className="w-full flex items-center gap-1.5 py-1 px-2 rounded-lg text-left transition-all"
      style={{
        paddingLeft: `${8 + depth * 16}px`,
        background: isSelected ? 'rgba(139,92,246,0.12)' : 'transparent',
        color: isSelected ? 'var(--accent)' : 'var(--text)',
      }}
    >
      <span className="w-3 flex-shrink-0" />
      <File size={13} className="flex-shrink-0 flex-none" style={{ color: isSelected ? 'var(--accent)' : 'var(--text-subtle)' }} />
      <span className="text-xs truncate flex-1">{entry.name}</span>
      <span className="text-[10px] text-[var(--text-subtle)] flex-shrink-0 ml-1">
        {formatSize(entry.size)}
      </span>
    </button>
  )
}

interface FileBrowserProps {
  rootDir: string
}

export function FileBrowser({ rootDir }: FileBrowserProps) {
  const { entries, isLoadingDir, currentDir, navigateTo, selectFile, selectedFile } = useFilesStore()

  useEffect(() => {
    if (rootDir) navigateTo(rootDir)
  }, [rootDir])

  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  if (isLoadingDir) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-xs text-[var(--text-subtle)]">Loading...</p>
      </div>
    )
  }

  return (
    <div className="py-1">
      {sorted.length === 0 && (
        <p className="text-xs text-[var(--text-subtle)] text-center py-6 italic">
          Empty directory
        </p>
      )}
      {sorted.map((entry) =>
        entry.isDirectory ? (
          <FolderNode key={entry.path} entry={entry} depth={0} />
        ) : (
          <FileNode key={entry.path} entry={entry} depth={0} />
        )
      )}
    </div>
  )
}
