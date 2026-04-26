import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, GitBranch, ChevronLeft, FileCode } from 'lucide-react'
import hljs from 'highlight.js'
import { useGitStore } from '../../store/git.store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', cc: 'cpp', h: 'cpp', hh: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', swift: 'swift', scala: 'scala', lua: 'lua',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', env: 'bash',
  md: 'markdown', css: 'css', scss: 'scss', html: 'xml', xml: 'xml',
  sql: 'sql', graphql: 'graphql', r: 'r', vim: 'vim',
}

function getLang(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
}

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
  const language = getLang(file)

  const highlight = (code: string) => {
    if (!language || !code) return code
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      return code
    }
  }

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
            const isFileHeader = line.startsWith('+++') || line.startsWith('---')
            const isHunk = line.startsWith('@@')
            const isAdd = !isFileHeader && line.startsWith('+')
            const isRem = !isFileHeader && line.startsWith('-')

            // File header and hunk lines — no syntax highlighting
            if (isFileHeader) {
              return (
                <div key={i} style={{ color: 'var(--text-subtle)', whiteSpace: 'pre' }}>
                  {line || ' '}
                </div>
              )
            }
            if (isHunk) {
              return (
                <div key={i} style={{ color: 'var(--accent-blue)', background: 'rgba(59,130,246,0.06)', whiteSpace: 'pre' }}>
                  {line || ' '}
                </div>
              )
            }

            // Code lines — prefix colored, content syntax-highlighted
            const prefix = line[0] ?? ' '
            const code = line.length > 0 ? line.slice(1) : ' '
            const prefixColor = isAdd ? '#22c55e' : isRem ? '#ef4444' : 'var(--text-subtle)'
            const bg = isAdd ? 'rgba(34,197,94,0.1)' : isRem ? 'rgba(239,68,68,0.1)' : 'transparent'

            return (
              <div key={i} style={{ background: bg, whiteSpace: 'pre', display: 'flex' }}>
                <span style={{ color: prefixColor, userSelect: 'none', flexShrink: 0 }}>{prefix}</span>
                <span
                  style={{ color: 'var(--text)' }}
                  dangerouslySetInnerHTML={{ __html: highlight(code) }}
                />
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
    branch, ahead, behind,
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
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch size={13} className="text-[var(--accent)] flex-shrink-0" />
          {branch && (
            <span className="text-xs font-medium text-[var(--text)] truncate">{branch}</span>
          )}
          {ahead > 0 && (
            <span className="text-xs font-medium" style={{ color: '#22c55e' }}>↑{ahead}</span>
          )}
          {behind > 0 && (
            <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>↓{behind}</span>
          )}
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
