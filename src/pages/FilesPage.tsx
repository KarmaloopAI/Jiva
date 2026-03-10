import { useEffect, useState } from 'react'
import { FolderOpen, ChevronRight, Home, Settings2 } from 'lucide-react'
import { FileBrowser } from '../components/files/FileBrowser'
import { FilePreview } from '../components/files/FilePreview'
import { useFilesStore } from '../store/files.store'

function Breadcrumb({ dir }: { dir: string }) {
  const homeDir = dir.replace(/^\/Users\/[^/]+/, '~')
  const parts = homeDir.split('/').filter(Boolean)

  return (
    <div className="flex items-center gap-1 text-[11px] text-[var(--text-subtle)] min-w-0 overflow-hidden">
      <Home size={11} className="flex-shrink-0" />
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <ChevronRight size={9} className="flex-shrink-0" />
          <span className={`truncate ${i === parts.length - 1 ? 'text-[var(--text)]' : ''}`}>
            {part}
          </span>
        </span>
      ))}
    </div>
  )
}

export function FilesPage() {
  const [workspaceDir, setWorkspaceDir] = useState<string>('')
  const [isReady, setIsReady] = useState(false)
  const { currentDir, openExternal } = useFilesStore()

  useEffect(() => {
    if (!window.electron?.workspace) return
    window.electron.workspace.getDir().then((dir) => {
      setWorkspaceDir(dir as string)
      setIsReady(true)
    })
  }, [])

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--text-subtle)]">Loading workspace...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: file tree */}
      <div
        className="w-64 flex-shrink-0 flex flex-col overflow-hidden border-r"
        style={{
          borderColor: 'var(--card-border)',
          background: 'var(--sidebar-bg)',
        }}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <div className="flex items-center gap-1.5">
            <FolderOpen size={13} className="text-[var(--accent)]" />
            <span className="text-xs font-semibold text-[var(--text)]">Files</span>
          </div>
          <button
            onClick={() => openExternal(currentDir || workspaceDir)}
            className="text-[10px] text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors"
            title="Open in Finder"
          >
            Finder ↗
          </button>
        </div>

        {/* Breadcrumb */}
        <div
          className="px-3 py-1.5 border-b flex-shrink-0"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <Breadcrumb dir={currentDir || workspaceDir} />
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto px-1 py-1">
          <FileBrowser rootDir={workspaceDir} />
        </div>
      </div>

      {/* Right panel: preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FilePreview />
      </div>
    </div>
  )
}
