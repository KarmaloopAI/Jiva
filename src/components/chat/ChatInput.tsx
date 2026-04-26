import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, StopCircle, MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot, type LucideIcon } from 'lucide-react'

const PERSONA_ICONS: Record<string, LucideIcon> = {
  MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot,
}
import { useChatStore } from '../../store/chat.store'
import { useJivaStore } from '../../store/jiva.store'
import { usePersonaStore } from '../../store/persona.store'
import { useConversationStore } from '../../store/conversation.store'

export function ChatInput() {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    addUserMessage,
    setThinking,
    addAgentResponse,
    addErrorMessage,
    isThinking,
  } = useChatStore()
  const { sendMessage, connectionStatus } = useJivaStore()
  const { activePersonaName, personas } = usePersonaStore()

  const isConnected = connectionStatus === 'connected'

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

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
      const msg = err instanceof Error ? err.message : 'Failed to get response from Jiva'
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
              ? 'Message Jiva... (Shift+Enter for new line)'
              : 'Waiting for Jiva to initialize...'
          }
          disabled={!isConnected || isThinking}
          rows={1}
          className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] leading-relaxed disabled:opacity-50"
          style={{ maxHeight: '200px' }}
        />

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
        Jiva can make mistakes. Verify important information.
      </p>
    </div>
  )
}
