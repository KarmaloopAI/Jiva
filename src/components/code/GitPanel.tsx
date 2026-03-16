import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, GitBranch, ChevronLeft, FileCode } from 'lucide-react'
import { useGitStore } from '../../store/git.store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

function StatusBadge({ status }: { status: string }) {
  const s = status.replace(' ', '')
  if (s === 'M' || s === 'MM')  return <Badge variant="warning">M</Badge>
  if (s === 'A')                return <Badge variant="success">A</Badge>
  if (s === 'D')                return <Badge variant="warning">D</Badge>
  if (s === '??')               return <Badge variant="default">?</Badge>
  if (s === 'R')                return <Badge variant="tool">R</Badge>
  return <Badge variant="default">{s}</Badge>
}

function DiffView({ content, file, onBack }: { content: string; file: string; onBack: () => void }) {
  const lines = content.split('\n')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
           style={{ borderColor: 'var(--card-border)' }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} />
        </Button>
        <span className="text-xs text-[var(--text-muted)] font-mono truncate flex-1">{file}</span>
      </div>

      {/* Diff lines */}
      <div className="flex-1 overflow-auto">
        <pre
          className="text-xs p-3 leading-5"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          {lines.map((line, i) => {
            let bg = 'transparent'
            let color = 'var(--text-muted)'

            if (line.startsWith('+++') || line.startsWith('---')) {
              color = 'var(--text-subtle)'
            } else if (line.startsWith('+')) {
              bg = 'rgba(34,197,94,0.1)'
              color = '#22c55e'
            } else if (line.startsWith('-')) {
              bg = 'rgba(239,68,68,0.1)'
              color = '#ef4444'
            } else if (line.startsWith('@@')) {
              color = 'var(--accent-blue)'
              bg = 'rgba(59,130,246,0.06)'
            }

            return (
              <div key={i} style={{ background: bg, color, whiteSpace: 'pre' }}>
                {line || ' '}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

export function GitPanel() {
  const {
    isRepo, changedFiles, selectedFile, diffContent,
    isLoadingDiff, isLoadingStatus, refresh, selectFile,
  } = useGitStore()

  // Refresh every time component mounts or regains focus
  useEffect(() => { refresh() }, [])

  if (!isRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <GitBranch size={28} className="text-[var(--text-subtle)] mb-3" />
        <p className="text-sm text-[var(--text-subtle)]">Not a git repository</p>
      </div>
    )
  }

  // Show diff view when a file is selected and diff is loaded
  if (selectedFile && diffContent !== null) {
    return (
      <DiffView
        content={diffContent}
        file={selectedFile}
        onBack={() => selectFile(null)}
      />
    )
  }

  // Loading diff
  if (selectedFile && isLoadingDiff) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={16} className="text-[var(--text-subtle)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--card-border)' }}
      >
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-muted)]">Changed Files</span>
          {changedFiles.length > 0 && (
            <Badge variant="tool">{changedFiles.length}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={isLoadingStatus}
        >
          <RefreshCw size={12} className={isLoadingStatus ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto py-1">
        <AnimatePresence>
          {changedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <FileCode size={24} className="text-[var(--text-subtle)] mb-2" />
              <p className="text-xs text-[var(--text-subtle)]">No uncommitted changes</p>
            </div>
          ) : (
            changedFiles.map((f, i) => (
              <motion.button
                key={f.file}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => selectFile(f.file)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--card)] transition-colors"
              >
                <StatusBadge status={f.status} />
                <span
                  className="text-xs truncate flex-1"
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    color: 'var(--text)',
                  }}
                  title={f.file}
                >
                  {f.file}
                </span>
              </motion.button>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
