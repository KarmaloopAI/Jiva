import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, Code2, FileText, BarChart3, ChevronDown } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { UserMessage } from './UserMessage'
import { AgentMessage } from './AgentMessage'
import { TypingIndicator } from './TypingIndicator'
import { useChatStore } from '../../store/chat.store'
import { useJivaStore } from '../../store/jiva.store'
import { logoUrl } from '../../lib/logo'

export function MessageList() {
  const { messages, isThinking, thinkingStartTime } = useChatStore()
  const { connectionStatus, serverStatus } = useJivaStore()
  const parentRef = useRef<HTMLDivElement>(null)

  // Whether the user is scrolled near the bottom (auto-scroll enabled)
  const autoScroll = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // Combine messages + optional "thinking" sentinel into one flat list
  const items = isThinking
    ? ([...messages, 'thinking'] as const)
    : (messages as readonly (typeof messages[number] | 'thinking')[])

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

  // Auto-scroll when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (autoScroll.current) {
      scrollToBottom()
    }
  }, [items.length, scrollToBottom])

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
              {isStarting ? 'Starting Jivam...' : 'Connecting to Jivam...'}
            </p>
          </div>
        )}

        {isConnected && (
          <>
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))' }}>
              <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
            </div>
            <h2 className="text-xl font-semibold gradient-text mb-2">How can Jivam help you?</h2>
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

  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto px-4"
        onScroll={handleScroll}
      >
        {/* Spacer at top */}
        <div style={{ height: 24 }} />

        {/* Virtual scroll content */}
        <div style={{ height: totalSize, position: 'relative' }}>
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
                  <TypingIndicator startTime={thinkingStartTime} />
                ) : item.role === 'user' ? (
                  <UserMessage key={item.id} message={item} />
                ) : (
                  <AgentMessage key={item.id} message={item} />
                )}
              </div>
            )
          })}
        </div>

        {/* Spacer at bottom */}
        <div style={{ height: 24 }} />
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg transition-all"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            opacity: 0.92,
          }}
        >
          <ChevronDown size={13} />
          Latest
        </button>
      )}
    </div>
  )
}
