import { useState, useEffect, useCallback } from 'react'
import { FolderInput, GitBranch, Terminal, Loader2, AlertCircle, CheckCircle2, FolderOpen, Server, ChevronDown, ChevronRight, Info, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCodeStore } from '../../store/code.store'
import { useGitStore } from '../../store/git.store'

type GitStatus = 'checking' | 'repo' | 'not-repo' | 'initing' | 'inited' | 'error'

interface McpServer {
  name: string
  enabled: boolean
  codeMode: boolean
  command: string
  url?: string
}

export function WorkspacePickerView() {
  const [dir, setDir] = useState<string>('')
  const [gitStatus, setGitStatus] = useState<GitStatus>('checking')
  const [gitError, setGitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const [availableMcp, setAvailableMcp] = useState<McpServer[]>([])
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set())
  const [mcpExpanded, setMcpExpanded] = useState(false)

  const [maxIterations, setMaxIterations] = useState<10 | 50 | 100>(50)
  const [deepRun, setDeepRun] = useState(true)
  const [runConfigExpanded, setRunConfigExpanded] = useState(true)

  const { startSession, initLogListener } = useCodeStore()
  const { setWorkspaceDir, initRepo } = useGitStore()

  // Pre-populate workspace dir and load available MCP servers
  useEffect(() => {
    initLogListener()
    window.electron.workspace.getDir().then((d) => {
      if (d) setDir(d)
    })
    window.electron.code.listMcpForCode().then((servers) => {
      const enabled = servers.filter((s) => s.enabled)
      setAvailableMcp(enabled)
      // Pre-select servers marked codeMode: true
      setSelectedMcp(new Set(enabled.filter((s) => s.codeMode).map((s) => s.name)))
      // Auto-expand if any servers are available
      if (enabled.length > 0) setMcpExpanded(true)
    }).catch(() => {})
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

    const result = await startSession(trimmedDir, Array.from(selectedMcp), { deepRun, maxIterations })
    if (!result.success) {
      setIsStarting(false)
      setStartError(result.error ?? 'Failed to start session')
    }
    // On success, CodePage re-renders with isSessionStarted=true automatically
  }

  function toggleMcp(name: string) {
    setSelectedMcp((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
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

        {/* MCP Server picker */}
        {availableMcp.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--card-border)',
            }}
          >
            {/* Header — always visible, click to expand */}
            <button
              type="button"
              onClick={() => setMcpExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-black/5"
            >
              <div className="flex items-center gap-2">
                <Server size={13} className="text-[var(--accent-blue)] flex-shrink-0" />
                <span className="text-xs font-semibold text-[var(--text)]">MCP Servers</span>
                {selectedMcp.size > 0 && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
                  >
                    {selectedMcp.size} active
                  </span>
                )}
              </div>
              {mcpExpanded
                ? <ChevronDown size={13} className="text-[var(--text-muted)]" />
                : <ChevronRight size={13} className="text-[var(--text-muted)]" />
              }
            </button>

            <AnimatePresence initial={false}>
              {mcpExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3">
                    {/* Warning */}
                    <div
                      className="flex items-start gap-2 rounded-lg px-3 py-2"
                      style={{
                        background: 'rgba(245,158,11,0.08)',
                        border: '1px solid rgba(245,158,11,0.2)',
                      }}
                    >
                      <Info size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-amber-400 leading-relaxed">
                        Keep active servers to a minimum. Each one adds tools to the model's context window, which can degrade performance on long sessions.
                      </p>
                    </div>

                    {/* Server list */}
                    <div className="space-y-1.5">
                      {availableMcp.map((server) => {
                        const isOn = selectedMcp.has(server.name)
                        return (
                          <button
                            key={server.name}
                            type="button"
                            onClick={() => toggleMcp(server.name)}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left"
                            style={{
                              background: isOn
                                ? 'rgba(59,130,246,0.08)'
                                : 'rgba(0,0,0,0.03)',
                              border: isOn
                                ? '1px solid rgba(59,130,246,0.25)'
                                : '1px solid transparent',
                            }}
                          >
                            {/* Toggle pill */}
                            <div
                              className="flex-shrink-0 w-7 h-4 rounded-full transition-colors relative"
                              style={{
                                background: isOn
                                  ? 'var(--accent-blue)'
                                  : 'var(--card-border)',
                              }}
                            >
                              <span
                                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                                style={{ left: isOn ? '14px' : '2px' }}
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-[var(--text)] truncate">
                                  {server.name}
                                </span>
                                {server.codeMode && (
                                  <span
                                    className="text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide flex-shrink-0"
                                    style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--accent)' }}
                                  >
                                    default
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-[var(--text-subtle)] truncate">
                                {server.url ?? server.command}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Run Configuration */}
        <div
          className="rounded-2xl overflow-hidden mb-4"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--card-border)',
          }}
        >
          <button
            type="button"
            onClick={() => setRunConfigExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-black/5"
          >
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-[var(--accent-blue)] flex-shrink-0" />
              <span className="text-xs font-semibold text-[var(--text)]">Run Configuration</span>
            </div>
            {runConfigExpanded
              ? <ChevronDown size={13} className="text-[var(--text-muted)]" />
              : <ChevronRight size={13} className="text-[var(--text-muted)]" />
            }
          </button>

          <AnimatePresence initial={false}>
            {runConfigExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-4">
                  {/* Max Iterations */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-[var(--text)]">Max Iterations</p>
                    <p className="text-[10px] text-[var(--text-subtle)] leading-relaxed">
                      How many tool steps the agent can take per task.
                    </p>
                    <div className="flex gap-2">
                      {([10, 50, 100] as const).map((val) => {
                        const label = val === 10 ? 'Quick' : val === 50 ? 'Medium' : 'Long'
                        const isSelected = maxIterations === val
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setMaxIterations(val)}
                            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                            style={{
                              background: isSelected
                                ? 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(139,92,246,0.12))'
                                : 'rgba(0,0,0,0.03)',
                              border: isSelected
                                ? '1px solid rgba(59,130,246,0.4)'
                                : '1px solid var(--card-border)',
                              color: isSelected ? 'var(--accent-blue)' : 'var(--text-muted)',
                            }}
                          >
                            {label}
                            <span className="block text-[9px] opacity-60 mt-0.5">{val} steps</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Deep Run toggle */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold text-[var(--text)]">Deep Run</p>
                      <p className="text-[10px] text-[var(--text-subtle)] leading-relaxed">
                        Jivam evaluates results and re-runs if needed.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeepRun((v) => !v)}
                      className="flex-shrink-0 w-9 h-5 rounded-full transition-colors relative"
                      style={{ background: deepRun ? 'var(--accent-blue)' : 'var(--card-border)' }}
                      aria-label="Toggle Deep Run"
                    >
                      <span
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                        style={{ left: deepRun ? '18px' : '2px' }}
                      />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
