import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, StopCircle, MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot, SlidersHorizontal, Zap, type LucideIcon } from 'lucide-react'

const PERSONA_ICONS: Record<string, LucideIcon> = {
  MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot,
}
import { useChatStore } from '../../store/chat.store'
import { useJivaStore } from '../../store/jiva.store'
import { usePersonaStore } from '../../store/persona.store'
import { useConversationStore } from '../../store/conversation.store'

export function ChatInput() {
  const [value, setValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    addUserMessage,
    setThinking,
    addAgentResponse,
    addErrorMessage,
    isThinking,
  } = useChatStore()
  const { sendMessage, connectionStatus, deepRun, setDeepRun, maxIterations, setMaxIterations } = useJivaStore()
  const { activePersonaName, personas } = usePersonaStore()

  const isConnected = connectionStatus === 'connected'

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  // Close settings popover on outside click
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

  const handleStop = useCallback(() => {
    window.electron.jiva.stopMessage()
  }, [])

  const handleSend = useCallback(async () => {
    const text = value.trim()
    if (!text || !isConnected || isThinking) return

    const sendTime = Date.now()
    setValue('')
    addUserMessage(text)
    setThinking(true)

    try {
      const response = await sendMessage(text, activePersonaName ?? undefined)
      const durationMs = Date.now() - sendTime
      addAgentResponse(
        response.content,
        {
          plan: response.plan ?? null,
          toolsUsed: response.toolsUsed ?? [],
          iterations: response.iterations ?? 1,
          durationMs,
        },
        durationMs
      )
      // Always refresh the sidebar so new conversations appear immediately
      useConversationStore.getState().loadConversationList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get response from Jivam'
      addErrorMessage(msg)
    }
  }, [value, isConnected, isThinking, activePersonaName, addUserMessage, setThinking, sendMessage, addAgentResponse, addErrorMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const activePersona = personas.find((p) => p.name === activePersonaName)

  return (
    <div
      className="px-4 py-4 border-t"
      style={{
        borderColor: 'var(--topbar-border)',
        background: 'var(--topbar-bg)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Persona chip */}
      {activePersona && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-subtle)]">Using</span>
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(139,92,246,0.1)',
              color: 'var(--accent)',
              border: '1px solid rgba(139,92,246,0.2)',
            }}
          >
            {(() => {
              const IconComp = PERSONA_ICONS[activePersona.icon] ?? Bot
              return <IconComp size={12} className="flex-shrink-0" />
            })()}
            <span>{activePersona.displayName}</span>
          </span>
        </div>
      )}

      {/* Input row */}
      <div
        className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all"
        style={{
          background: 'var(--input-bg)',
          border: '1.5px solid var(--input-border)',
          boxShadow: '0 2px 12px rgba(139,92,246,0.08)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isConnected
              ? 'Message Jivam... (Shift+Enter for new line)'
              : 'Waiting for Jivam to initialize...'
          }
          disabled={!isConnected || isThinking}
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
              background: settingsOpen ? 'rgba(139,92,246,0.15)' : 'transparent',
              color: settingsOpen ? 'var(--accent)' : 'var(--text-subtle)',
            }}
            title="Run settings"
          >
            <SlidersHorizontal size={14} />
          </button>

          {settingsOpen && (
            <div
              className="absolute bottom-10 right-0 z-50 rounded-xl p-3 w-[220px]"
              style={{
                background: 'var(--topbar-bg)',
                border: '1px solid var(--topbar-border)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* Max Iterations */}
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
                        background: selected ? 'rgba(139,92,246,0.2)' : 'var(--bg-secondary)',
                        color: selected ? 'var(--accent)' : 'var(--text-subtle)',
                        border: selected ? '1px solid rgba(139,92,246,0.4)' : '1px solid transparent',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Deep Run */}
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
                Jivam evaluates results and re-runs if needed
              </p>
            </div>
          )}
        </div>

        <button
          onClick={isThinking ? handleStop : handleSend}
          disabled={isThinking ? false : (!value.trim() || !isConnected)}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isThinking
              ? 'var(--bg-secondary)'
              : value.trim() && isConnected
                ? 'linear-gradient(135deg, #8B5CF6, #3B82F6)'
                : 'var(--bg-secondary)',
          }}
        >
          {isThinking ? (
            <StopCircle size={15} className="text-[var(--accent)]" />
          ) : (
            <Send
              size={14}
              className={value.trim() && isConnected ? 'text-white' : 'text-[var(--text-subtle)]'}
            />
          )}
        </button>
      </div>

      <p className="text-center text-[10px] text-[var(--text-subtle)] mt-2">
        Jivam can make mistakes. Verify important information.
      </p>
    </div>
  )
}
