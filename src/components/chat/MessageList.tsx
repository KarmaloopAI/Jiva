import { useEffect, useRef } from 'react'
import { Search, Code2, FileText, BarChart3 } from 'lucide-react'
import { UserMessage } from './UserMessage'
import { AgentMessage } from './AgentMessage'
import { TypingIndicator } from './TypingIndicator'
import { useChatStore } from '../../store/chat.store'
import { useJivaStore } from '../../store/jiva.store'
import { logoUrl } from '../../lib/logo'

export function MessageList() {
  const { messages, isThinking, thinkingStartTime } = useChatStore()
  const { connectionStatus, serverStatus } = useJivaStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  const isConnected = connectionStatus === 'connected'
  const isStarting = serverStatus === 'starting' || connectionStatus === 'connecting'

  if (messages.length === 0 && !isThinking) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        {!isConnected && !isStarting && (
          <div className="mb-8">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
                border: '1px solid rgba(139,92,246,0.2)',
              }}>
              <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
            </div>
            <h2 className="text-xl font-semibold gradient-text mb-2">Jivam</h2>
            <p className="text-[var(--text-muted)] text-sm max-w-xs">
              {isStarting ? 'Starting Jiva agent...' : 'Connecting to Jiva...'}
            </p>
          </div>
        )}

        {isConnected && (
          <>
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))' }}>
              <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
            </div>
            <h2 className="text-xl font-semibold gradient-text mb-2">How can Jiva help you?</h2>
            <p className="text-[var(--text-muted)] text-sm max-w-sm">
              Ask me anything — I can search the web, analyze information, write code, and much more.
            </p>

            <div className="grid grid-cols-2 gap-3 mt-8 max-w-md w-full">
              {[
                { Icon: Search, text: 'Research a topic in depth' },
                { Icon: Code2, text: 'Help with code or debugging' },
                { Icon: FileText, text: 'Draft a document or email' },
                { Icon: BarChart3, text: 'Analyze data or trends' },
              ].map(({ Icon, text }) => (
                <div
                  key={text}
                  className="glass-card rounded-xl p-3 text-left cursor-pointer hover:border-purple-300 dark:hover:border-purple-600 transition-colors"
                >
                  <Icon size={18} className="text-[var(--accent)] mb-1.5" />
                  <span className="text-xs text-[var(--text-muted)]">{text}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      {messages.map((msg) =>
        msg.role === 'user' ? (
          <UserMessage key={msg.id} message={msg} />
        ) : (
          <AgentMessage key={msg.id} message={msg} />
        )
      )}

      {isThinking && <TypingIndicator startTime={thinkingStartTime} />}

      <div ref={bottomRef} />
    </div>
  )
}
