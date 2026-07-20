import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Send, StopCircle, Terminal, FolderCode, Bug, Wrench, RotateCcw, SlidersHorizontal, Zap, Monitor, ChevronDown, ChevronUp, Brain, FileText, Image, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCodeStore } from '../../store/code.store'
import { useGitStore } from '../../store/git.store'
import { useAuthStore } from '../../store/auth.store'
import type { ProcessedAttachment } from '../../store/jiva.store'
import { CodeActivityIndicator } from './CodeActivityIndicator'
import { CodeEventCard } from './CodeEventCard'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { AgentStatusRow } from '../ui/AgentStatusRow'
import { extractImageFromClipboard } from '../../lib/paste-image'
import { handleSmartKeydown } from '../../lib/smart-textarea'
import { FileMentionPopover } from './FileMentionPopover'
import { logoUrl } from '../../lib/logo'
import type { CodeMessage } from '../../store/code.store'
import type { AttachedFile } from '../../types/chat'

const EXAMPLE_PROMPTS = [
  { Icon: Bug, text: 'Find and fix the bug causing tests to fail' },
  { Icon: FolderCode, text: 'Refactor this module for better readability' },
  { Icon: Wrench, text: 'Add error handling to the API endpoints' },
  { Icon: Terminal, text: 'Write a script to automate this task' },
]

const CodeUserMessage = memo(function CodeUserMessage({ message }: { message: CodeMessage }) {
  return (
    <div className="flex items-end justify-end gap-2">
      <div
        className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed"
        style={{
          background: 'var(--user-bubble-bg)',
          color: 'var(--user-bubble-text)',
        }}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
})

const CodeAgentMessage = memo(function CodeAgentMessage({ message }: { message: CodeMessage }) {
  const { toggleWorkPanel, toggleEventExpanded } = useCodeStore()
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const hasBrain = (message.brainCommentary?.length ?? 0) > 0
  const hasTools = (message.events?.length ?? 0) > 0
  const hasWork = hasBrain || hasTools

  return (
    <div className="flex items-start gap-3">
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center flex-none"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
          border: '1px solid rgba(59,130,246,0.2)',
        }}
      >
        <img src={logoUrl} alt="Jivam" className="w-5 h-5 object-contain" />
      </div>

      <div className="flex-1 min-w-0">
        {message.thinking && (
          <div className="mb-1.5 ml-1">
            <button
              onClick={() => setThinkingExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors"
            >
              <Brain size={12} />
              {thinkingExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {thinkingExpanded ? 'Hide thinking' : 'Show thinking'}
            </button>
            {thinkingExpanded && (
              <div
                className="mt-1.5 rounded-lg px-3 py-2 text-xs italic leading-relaxed text-[var(--text-subtle)] whitespace-pre-wrap"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--card-border)' }}
              >
                {message.thinking}
              </div>
            )}
          </div>
        )}
        <div className="py-1">
          <MarkdownRenderer content={message.content} />
        </div>

        {hasWork && (
          <div className="mt-1.5 ml-1">
            <button
              onClick={() => toggleWorkPanel(message.id)}
              className="flex items-center gap-1 text-xs text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors"
            >
              {message.workExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {message.workExpanded ? 'Hide' : 'Show'} Jivam's work
            </button>

            <AnimatePresence>
              {message.workExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div
                    className="mt-3 rounded-xl p-4 space-y-4 text-sm"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--card-border)',
                    }}
                  >
                    <span className="font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide">
                      Jivam's Work
                    </span>

                    {/* Brain commentary */}
                    {hasBrain && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                          <Brain size={13} />
                          <span>Deep Run process</span>
                        </div>
                        <ol className="space-y-1">
                          {message.brainCommentary!.map((thought, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span
                                className="flex-shrink-0 w-1 h-1 rounded-full mt-1.5"
                                style={{ background: 'var(--accent)', opacity: 0.5 }}
                              />
                              <span className="text-[var(--text-subtle)] italic leading-relaxed">{thought}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Tool events */}
                    {hasTools && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[var(--text-muted)]">
                          <Terminal size={13} />
                          <span>Actions taken</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {message.events!.map((evt) => (
                            <CodeEventCard
                              key={evt.id}
                              event={evt}
                              onToggle={() => toggleEventExpanded(message.id, evt.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
})

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div
        className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.08))',
          border: '1px solid rgba(59,130,246,0.2)',
        }}
      >
        <Terminal size={28} className="text-[var(--accent-blue)]" />
      </div>
      <h2 className="text-xl font-semibold gradient-text mb-2">Code Agent</h2>
      <p className="text-[var(--text-muted)] text-sm max-w-sm leading-relaxed">
        Describe what you'd like to build or fix. The agent can read, write, and edit files directly in your workspace.
      </p>

      <div className="grid grid-cols-2 gap-3 mt-8 max-w-md w-full">
        {EXAMPLE_PROMPTS.map(({ Icon, text }) => (
          <div
            key={text}
            className="glass-card rounded-xl p-3 text-left"
          >
            <Icon size={18} className="text-[var(--accent-blue)] mb-1.5" />
            <span className="text-xs text-[var(--text-muted)]">{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageArea() {
  const { messages, isThinking, thinkingStartTime: _t } = useCodeStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const autoScroll = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const items = isThinking
    ? ([...messages, 'thinking'] as const)
    : (messages as readonly (CodeMessage | 'thinking')[])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 4,
  })

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight })
    autoScroll.current = true
    setShowScrollBtn(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    autoScroll.current = nearBottom
    setShowScrollBtn(!nearBottom && items.length > 0)
  }, [items.length])

  useEffect(() => {
    if (autoScroll.current) scrollToBottom()
  }, [items.length, scrollToBottom])

  if (messages.length === 0 && !isThinking) return <EmptyState />

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto px-4"
        onScroll={handleScroll}
      >
        <div style={{ height: 24 }} />
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const item = items[vItem.index]
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: vItem.start,
                  left: 0,
                  width: '100%',
                  paddingBottom: 24,
                }}
              >
                {item === 'thinking' ? (
                  <CodeActivityIndicator />
                ) : item.role === 'user' ? (
                  <CodeUserMessage message={item} />
                ) : (
                  <CodeAgentMessage message={item} />
                )}
              </div>
            )
          })}
        </div>
        <div style={{ height: 24 }} />
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg"
          style={{ background: 'var(--accent)', color: '#fff', opacity: 0.92 }}
        >
          <ChevronDown size={13} />
          Latest
        </button>
      )}
    </div>
  )
}

export function CodeChatView() {
  const [value, setValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [processedAttachments, setProcessedAttachments] = useState<ProcessedAttachment[]>([])
  const [isMultimodalEnabled, setIsMultimodalEnabled] = useState(false)
  const [mentionFiles, setMentionFiles] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionAnchor, setMentionAnchor] = useState(-1)
  const settingsRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    isThinking, sendMessage, clearSession, codeWorkspaceDir, deepRun, setDeepRun, maxIterations, setMaxIterations,
    currentModel, switchModel, switchingModel,
  } = useCodeStore()
  const { refresh: refreshGit } = useGitStore()
  const { isCloudMode } = useAuthStore()

  if (isCloudMode) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-5 text-center px-8">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.08))',
            border: '1px solid rgba(59,130,246,0.2)',
          }}
        >
          <Monitor size={28} className="text-[var(--accent-blue)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)] mb-2">
            Code Agent requires a local install
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-xs leading-relaxed">
            The Code Agent runs directly on your machine and is not available in Cloud mode.
          </p>
        </div>
        <a
          href="https://github.com/KarmaloopAI/Jivam#installation"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--accent)] hover:underline"
        >
          Install Jivam locally →
        </a>
      </div>
    )
  }

  // Auto-resize textarea
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  // Cache the repo's file list for @-mention — fetched once per workspace,
  // not re-fetched per keystroke.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!codeWorkspaceDir) { setMentionFiles([]); return }
    window.electron.git.listFiles(codeWorkspaceDir).then(setMentionFiles).catch(() => setMentionFiles([]))
  }, [codeWorkspaceDir])

  // Close settings popover on outside click
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  // Seed the current model + multimodal capability from config on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    window.electron.config.read().then((config) => {
      const cfg = config as { models?: { multimodal?: unknown; reasoning?: { defaultModel?: string; model?: string } } } | null
      const current = cfg?.models?.reasoning?.defaultModel ?? cfg?.models?.reasoning?.model
      if (current) useCodeStore.setState({ currentModel: current })
      setIsMultimodalEnabled(!!cfg?.models?.multimodal)
    }).catch(() => {})
  }, [])

  // Fetch available models the first time the popover is opened
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!settingsOpen || modelOptions.length > 0 || loadingModels) return
    setLoadingModels(true)
    window.electron.config.listModels().then((result) => {
      setModelOptions(result.success ? result.models : [])
    }).catch(() => setModelOptions([])).finally(() => setLoadingModels(false))
  }, [settingsOpen, modelOptions.length, loadingModels])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleModelChange = useCallback(async (model: string) => {
    if (!model || model === currentModel) return
    await switchModel(model)
  }, [currentModel, switchModel])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleStop = useCallback(() => {
    window.electron.code.stopMessage()
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleNewSession = useCallback(async () => {
    await clearSession()
    useGitStore.getState().setWorkspaceDir('')
  }, [clearSession])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const result = await extractImageFromClipboard(e.clipboardData, isMultimodalEnabled)
    if (!result) return // no image in the clipboard — let default text paste proceed
    e.preventDefault()
    setAttachedFiles(prev => [...prev, result.file])
    setProcessedAttachments(prev => [...prev, result.processed])
  }, [isMultimodalEnabled])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const removeAttachment = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
    setProcessedAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleSend = useCallback(async () => {
    const text = value.trim()
    if ((!text && processedAttachments.length === 0) || isThinking) return

    let prompt = text
    if (processedAttachments.length > 0) {
      const fileBlocks = processedAttachments
        .map(a => `### ${a.name}\n${a.markdown}`)
        .join('\n\n')
      prompt = `<attached-files>\n${fileBlocks}\n</attached-files>\n\n${text}`
    }

    setValue('')
    setAttachedFiles([])
    setProcessedAttachments([])
    await sendMessage(prompt)
    refreshGit()
  }, [value, processedAttachments, isThinking, sendMessage, refreshGit])

  const filteredMentionFiles = mentionOpen
    ? mentionFiles.filter(f => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 50)
    : []

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setValue(newValue)
    const cursor = e.target.selectionStart
    const match = /@(\S*)$/.exec(newValue.slice(0, cursor))
    if (match) {
      setMentionAnchor(cursor - match[0].length)
      setMentionQuery(match[1])
      setMentionIndex(0)
      setMentionOpen(true)
    } else {
      setMentionOpen(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const selectMention = useCallback((file: string) => {
    const before = value.slice(0, mentionAnchor)
    const after = value.slice(mentionAnchor + 1 + mentionQuery.length)
    const newValue = `${before}@${file} ${after}`
    const newPos = mentionAnchor + 1 + file.length + 1

    const el = textareaRef.current
    if (el) {
      el.value = newValue
      el.focus()
      el.setSelectionRange(newPos, newPos)
    }
    setValue(newValue)
    setMentionOpen(false)
  }, [value, mentionAnchor, mentionQuery])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filteredMentionFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % filteredMentionFiles.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + filteredMentionFiles.length) % filteredMentionFiles.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredMentionFiles[mentionIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return }
    }

    if (e.key === 'Enter' && e.shiftKey) return // default newline insertion

    const el = e.currentTarget
    const smart = handleSmartKeydown(e.key, value, el.selectionStart, el.selectionEnd)
    if (smart) {
      e.preventDefault()
      // Set the DOM value + cursor synchronously first — React re-rendering
      // with an already-matching value won't reset the cursor, whereas
      // waiting for the render (even via requestAnimationFrame) races it
      // and loses the cursor position to the end of the text.
      el.value = smart.value
      el.setSelectionRange(smart.cursorPos, smart.cursorPos)
      setValue(smart.value)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const workspaceName = codeWorkspaceDir
    ? codeWorkspaceDir.split(/[\\/]/).filter(Boolean).pop() ?? codeWorkspaceDir
    : ''

  return (
    <div className="flex flex-col h-full">
      {/* Workspace header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'var(--topbar-border)', background: 'var(--topbar-bg)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderCode size={13} className="text-[var(--text-muted)] flex-shrink-0" />
          <span
            className="text-xs text-[var(--text-muted)] truncate"
            title={codeWorkspaceDir ?? ''}
          >
            {workspaceName}
          </span>
        </div>
        <button
          onClick={handleNewSession}
          disabled={isThinking}
          className="flex items-center gap-1 text-xs text-[var(--text-subtle)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 ml-2"
          title="Start a new code session in a different workspace"
        >
          <RotateCcw size={12} />
          <span>New Session</span>
        </button>
      </div>

      {/* Virtual message area */}
      <MessageArea />

      {/* Input */}
      <div
        className="px-4 py-4 border-t"
        style={{
          borderColor: 'var(--topbar-border)',
          background: 'var(--topbar-bg)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                style={{
                  background: 'rgba(59,130,246,0.08)',
                  color: 'var(--text-subtle)',
                  border: '1px solid rgba(59,130,246,0.2)',
                }}
              >
                {file.category === 'image'
                  ? <Image size={11} className="flex-shrink-0" style={{ color: 'var(--accent-blue)' }} />
                  : <FileText size={11} className="flex-shrink-0" style={{ color: 'var(--accent-blue)' }} />
                }
                <span className="max-w-[140px] truncate">{file.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-0.5 rounded-full flex-shrink-0 hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-subtle)' }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          className="relative flex items-end gap-3 rounded-2xl px-4 py-3"
          style={{
            background: 'var(--input-bg)',
            border: '1.5px solid var(--input-border)',
            boxShadow: '0 2px 12px rgba(59,130,246,0.06)',
          }}
        >
          <FileMentionPopover
            files={filteredMentionFiles}
            selectedIndex={mentionIndex}
            onSelect={selectMention}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isThinking ? 'Agent is working...' : 'Describe what to build or fix... (Shift+Enter for new line)'}
            disabled={isThinking}
            rows={1}
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] leading-relaxed disabled:opacity-50"
            style={{ maxHeight: '200px' }}
          />

          {/* Settings */}
          <div ref={settingsRef} className="relative flex-shrink-0 self-end mb-0.5">
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
              style={{
                background: settingsOpen ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: settingsOpen ? '#3B82F6' : 'var(--text-subtle)',
              }}
              title="Run settings"
            >
              <SlidersHorizontal size={14} />
            </button>

            {settingsOpen && (
              <div
                className="absolute bottom-10 right-0 z-50 rounded-xl p-3 w-[260px]"
                style={{
                  background: 'var(--topbar-bg)',
                  border: '1px solid var(--topbar-border)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium text-[var(--text-subtle)] uppercase tracking-wide">Model</p>
                  {switchingModel && <span className="text-[10px] text-[var(--accent-blue)]">Switching…</span>}
                </div>
                <select
                  value={currentModel ?? ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={switchingModel}
                  className="w-full mb-3 rounded-lg text-xs"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--text)',
                    padding: '6px 8px',
                  }}
                >
                  {currentModel && !modelOptions.includes(currentModel) && (
                    <option value={currentModel}>{currentModel}</option>
                  )}
                  {modelOptions.length === 0 && (
                    <option value="" disabled>{loadingModels ? 'Loading models…' : 'No models found'}</option>
                  )}
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>

                <p className="text-[10px] font-medium text-[var(--text-subtle)] mb-1.5 uppercase tracking-wide">Max Iterations</p>
                <div className="flex gap-1.5 mb-3">
                  {([10, 50, 100] as const).map((val) => {
                    const label = val === 10 ? 'Quick' : val === 50 ? 'Medium' : 'Long'
                    const selected = maxIterations === val
                    return (
                      <button
                        key={val}
                        onClick={() => setMaxIterations(val)}
                        className="flex-1 py-1 rounded-lg text-[11px] font-medium transition-all"
                        style={{
                          background: selected ? 'rgba(59,130,246,0.2)' : 'var(--bg-secondary)',
                          color: selected ? '#3B82F6' : 'var(--text-subtle)',
                          border: selected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap size={12} className="text-[var(--accent)]" />
                    <span className="text-xs font-medium text-[var(--text)]">Deep Run</span>
                  </div>
                  <button
                    onClick={() => setDeepRun(!deepRun)}
                    className="relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
                    style={{ background: deepRun ? 'var(--accent)' : 'var(--bg-secondary)' }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                      style={{ left: deepRun ? '18px' : '2px' }}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-subtle)] mt-1.5 leading-relaxed">
                  Evaluates results and re-runs if needed
                </p>
              </div>
            )}
          </div>

          <button
            onClick={isThinking ? handleStop : handleSend}
            disabled={isThinking ? false : !value.trim() && processedAttachments.length === 0}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: isThinking
                ? 'var(--bg-secondary)'
                : (value.trim() || processedAttachments.length > 0)
                  ? 'linear-gradient(135deg, #3B82F6, #8B5CF6)'
                  : 'var(--bg-secondary)',
            }}
          >
            {isThinking ? (
              <StopCircle size={15} className="text-[var(--accent)]" />
            ) : (
              <Send
                size={14}
                className={(value.trim() || processedAttachments.length > 0) ? 'text-white' : 'text-[var(--text-subtle)]'}
              />
            )}
          </button>
        </div>

        <AgentStatusRow
          disclaimer="Code Agent operates directly in your workspace. Review changes before committing."
          deepRun={deepRun}
          model={currentModel}
          maxIterations={maxIterations}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
    </div>
  )
}
