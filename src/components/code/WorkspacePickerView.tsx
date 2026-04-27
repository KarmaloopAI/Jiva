import { useState, useEffect, useCallback } from 'react'
import { FolderInput, GitBranch, Terminal, Loader2, AlertCircle, CheckCircle2, FolderOpen } from 'lucide-react'
import { motion } from 'framer-motion'
import { useCodeStore } from '../../store/code.store'
import { useGitStore } from '../../store/git.store'

type GitStatus = 'checking' | 'repo' | 'not-repo' | 'initing' | 'inited' | 'error'

export function WorkspacePickerView() {
  const [dir, setDir] = useState<string>('')
  const [gitStatus, setGitStatus] = useState<GitStatus>('checking')
  const [gitError, setGitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const { startSession, initLogListener } = useCodeStore()
  const { setWorkspaceDir, initRepo } = useGitStore()

  // Pre-populate with configured workspace dir
  useEffect(() => {
    initLogListener()
    window.electron.workspace.getDir().then((d) => {
      if (d) setDir(d)
    })
  }, [initLogListener])

  // Re-check git status whenever the dir changes
  const checkGit = useCallback(async (directory: string) => {
    if (!directory.trim()) return
    setGitStatus('checking')
    setGitError(null)
    try {
      const isRepo = await window.electron.git.isRepo(directory)
      setGitStatus(isRepo ? 'repo' : 'not-repo')
    } catch {
      setGitStatus('error')
      setGitError('Could not check directory')
    }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (dir.trim()) checkGit(dir.trim())
    }, 400)
    return () => clearTimeout(timeout)
  }, [dir, checkGit])

  async function handleBrowse() {
    const picked = await window.electron.workspace.pickDir()
    if (picked) setDir(picked)
  }

  async function handleInitRepo() {
    setGitStatus('initing')
    setGitError(null)
    // Temporarily set the dir in git store so initRepo() has a workspaceDir
    setWorkspaceDir(dir.trim())
    const result = await initRepo()
    if (result.success) {
      setGitStatus('inited')
    } else {
      setGitStatus('error')
      setGitError(result.error ?? 'git init failed')
    }
  }

  async function handleStart() {
    const trimmedDir = dir.trim()
    if (!trimmedDir) return
    setIsStarting(true)
    setStartError(null)

    // Set workspace dir in git store for future git panel ops
    setWorkspaceDir(trimmedDir)

    const result = await startSession(trimmedDir)
    if (!result.success) {
      setIsStarting(false)
      setStartError(result.error ?? 'Failed to start session')
    }
    // On success, CodePage re-renders with isSessionStarted=true automatically
  }

  const canStart = dir.trim().length > 0 &&
    (gitStatus === 'repo' || gitStatus === 'inited') &&
    !isStarting

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 340 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.08))',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            <Terminal size={26} className="text-[var(--accent-blue)]" />
          </div>
          <h2 className="text-xl font-semibold gradient-text mb-1">Choose Workspace</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-xs leading-relaxed">
            Select a directory for this code session. Jivam will read and edit files here.
          </p>
        </div>

        {/* Directory picker */}
        <div
          className="rounded-2xl p-5 space-y-4 mb-4"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--card-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={13} className="text-[var(--text-muted)]" />
            <span className="text-xs font-semibold text-[var(--text)]">Project Directory</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="~/dev/my-project"
              className="flex-1 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent-blue)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--input-border)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canStart) handleStart() }}
            />
            <button
              onClick={handleBrowse}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.07))',
                border: '1px solid rgba(59,130,246,0.22)',
                color: 'var(--accent-blue)',
              }}
            >
              <FolderInput size={13} />
              Browse
            </button>
          </div>

          {/* Git status indicator */}
          {dir.trim() && (
            <div className="flex items-start gap-2.5">
              {gitStatus === 'checking' && (
                <Loader2 size={13} className="text-[var(--text-subtle)] animate-spin mt-0.5 flex-shrink-0" />
              )}
              {gitStatus === 'repo' && (
                <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
              )}
              {gitStatus === 'inited' && (
                <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
              )}
              {(gitStatus === 'not-repo' || gitStatus === 'initing') && (
                <GitBranch size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
              )}
              {gitStatus === 'error' && (
                <AlertCircle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
              )}

              <div className="flex-1">
                {gitStatus === 'checking' && (
                  <p className="text-[11px] text-[var(--text-subtle)]">Checking git status…</p>
                )}
                {gitStatus === 'repo' && (
                  <p className="text-[11px] text-green-500">Git repository detected</p>
                )}
                {gitStatus === 'inited' && (
                  <p className="text-[11px] text-green-500">Git repository initialised successfully</p>
                )}
                {gitStatus === 'not-repo' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-amber-400">
                      Not a git repository — change tracking will be unavailable.
                    </p>
                    <button
                      onClick={handleInitRepo}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: 'rgba(245,158,11,0.1)',
                        border: '1px solid rgba(245,158,11,0.25)',
                        color: '#f59e0b',
                      }}
                    >
                      <GitBranch size={11} />
                      Initialize git repository
                    </button>
                  </div>
                )}
                {gitStatus === 'initing' && (
                  <p className="text-[11px] text-[var(--text-subtle)]">Running git init…</p>
                )}
                {gitStatus === 'error' && (
                  <p className="text-[11px] text-red-400">{gitError ?? 'Unknown error'}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Start error */}
        {startError && (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 text-xs"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
            <span className="text-red-400">{startError}</span>
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={!canStart}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: canStart
              ? 'linear-gradient(135deg, #3B82F6, #8B5CF6)'
              : 'var(--bg-secondary)',
            color: canStart ? '#fff' : 'var(--text-subtle)',
            border: canStart ? 'none' : '1px solid var(--card-border)',
          }}
        >
          {isStarting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Starting session…
            </>
          ) : (
            <>
              <Terminal size={14} />
              Start Code Session
            </>
          )}
        </button>

        <p className="text-center text-[10px] text-[var(--text-subtle)] mt-3">
          The agent will have full read/write access to this directory.
        </p>
      </motion.div>
    </div>
  )
}
