import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, StopCircle, Terminal, FolderCode, Bug, Wrench, RotateCcw } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCodeStore } from '../../store/code.store'
import { useGitStore } from '../../store/git.store'
import { CodeActivityIndicator } from './CodeActivityIndicator'
import { CodeEventCard } from './CodeEventCard'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { logoUrl } from '../../lib/logo'
import type { CodeMessage } from '../../store/code.store'

const EXAMPLE_PROMPTS = [
  { Icon: Bug, text: 'Find and fix the bug causing tests to fail' },
  { Icon: FolderCode, text: 'Refactor this module for better readability' },
  { Icon: Wrench, text: 'Add error handling to the API endpoints' },
  { Icon: Terminal, text: 'Write a script to automate this task' },
]

function CodeUserMessage({ message }: { message: CodeMessage }) {
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
}

function CodeAgentMessage({ message }: { message: CodeMessage }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center flex-none"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
          border: '1px solid rgba(59,130,246,0.2)',
        }}
      >
        <img src={logoUrl} alt="Jiva" className="w-5 h-5 object-contain" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Event cards above the response */}
        {message.events && message.events.length > 0 && (
          <div className="flex flex-col gap-1 mb-2">
            {message.events.map((evt) => (
              <CodeEventCard key={evt.id} event={evt} />
            ))}
          </div>
        )}

        <div className="py-1">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    </div>
  )
}

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

export function CodeChatView() {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { messages, isThinking, sendMessage, clearSession, codeWorkspaceDir } = useCodeStore()
  const { refresh: refreshGit } = useGitStore()

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  const handleStop = useCallback(() => {
    window.electron.code.stopMessage()
  }, [])

  const handleNewSession = useCallback(async () => {
    await clearSession()
    useGitStore.getState().setWorkspaceDir('')
  }, [clearSession])

  const handleSend = useCallback(async () => {
    const text = value.trim()
    if (!text || isThinking) return
    setValue('')
    await sendMessage(text)
    // Refresh git panel after agent completes
    refreshGit()
  }, [value, isThinking, sendMessage, refreshGit])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

      {/* Message area */}
      {messages.length === 0 && !isThinking ? (
        <EmptyState />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {msg.role === 'user' ? (
                  <CodeUserMessage message={msg} />
                ) : (
                  <CodeAgentMessage message={msg} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isThinking && <CodeActivityIndicator />}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div
        className="px-4 py-4 border-t"
        style={{
          borderColor: 'var(--topbar-border)',
          background: 'var(--topbar-bg)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="flex items-end gap-3 rounded-2xl px-4 py-3"
          style={{
            background: 'var(--input-bg)',
            border: '1.5px solid var(--input-border)',
            boxShadow: '0 2px 12px rgba(59,130,246,0.06)',
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isThinking ? 'Agent is working...' : 'Describe what to build or fix... (Shift+Enter for new line)'}
            disabled={isThinking}
            rows={1}
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] leading-relaxed disabled:opacity-50"
            style={{ maxHeight: '200px' }}
          />

          <button
            onClick={isThinking ? handleStop : handleSend}
            disabled={isThinking ? false : !value.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: isThinking
                ? 'var(--bg-secondary)'
                : value.trim()
                  ? 'linear-gradient(135deg, #3B82F6, #8B5CF6)'
                  : 'var(--bg-secondary)',
            }}
          >
            {isThinking ? (
              <StopCircle size={15} className="text-[var(--accent)]" />
            ) : (
              <Send
                size={14}
                className={value.trim() ? 'text-white' : 'text-[var(--text-subtle)]'}
              />
            )}
          </button>
        </div>

        <p className="text-center text-[10px] text-[var(--text-subtle)] mt-2">
          Code Agent operates directly in your workspace. Review changes before committing.
        </p>
      </div>
    </div>
  )
}
