import { memo } from 'react'
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { AgentWorkPanel } from './AgentWorkPanel'
import { useChatStore } from '../../store/chat.store'
import type { ChatMessage } from '../../types/chat'
import { logoUrl } from '../../lib/logo'

interface AgentMessageProps {
  message: ChatMessage
}

export const AgentMessage = memo(function AgentMessage({ message }: AgentMessageProps) {
  const { toggleWorkPanel } = useChatStore()
  const hasWork = (message.agentWork && (
    (message.agentWork.plan?.subtasks?.length ?? 0) > 0 ||
    (message.agentWork.toolsUsed?.length ?? 0) > 0
  )) || (message.brainCommentary && message.brainCommentary.length > 0)

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      {/* Avatar — soft transparent bg so the logo is visible on both light & dark */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center flex-none"
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
          border: '1px solid rgba(139,92,246,0.2)',
        }}
      >
        <img src={logoUrl} alt="Jivam" className="w-5 h-5 object-contain" />
      </div>

      {/* Content — full width, no constraining bubble (tables and wide content can expand freely) */}
      <div className="flex-1 min-w-0 w-full">
        <div className="py-1">
          {message.status === 'error' ? (
            <div
              className="flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-500" />
              <p className="text-sm text-red-500 dark:text-red-400">{message.content}</p>
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </div>

        {/* Work panel toggle */}
        {hasWork && (
          <div className="mt-1.5 ml-1">
            <button
              onClick={() => toggleWorkPanel(message.id)}
              className="flex items-center gap-1 text-xs text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors"
            >
              {message.workExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {message.workExpanded ? 'Hide' : 'Show'} Jivam's work
            </button>

            {message.agentWork && (
              <AgentWorkPanel
                work={message.agentWork}
                isExpanded={message.workExpanded ?? false}
                brainCommentary={message.brainCommentary}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
})
