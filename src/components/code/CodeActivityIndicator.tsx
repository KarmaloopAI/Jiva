import { AnimatePresence, motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'
import { useCodeStore } from '../../store/code.store'
import { logoUrl } from '../../lib/logo'
import { CodeEventCard } from './CodeEventCard'
import type { CodeEvent } from '../../store/code.store'

export function CodeActivityIndicator() {
  const { isThinking, currentAction, thinkingStartTime, liveEvents } = useCodeStore()
  const [elapsed, setElapsed] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!thinkingStartTime) { setElapsed(0); return }
    const interval = setInterval(() => setElapsed(Date.now() - thinkingStartTime), 1000)
    return () => clearInterval(interval)
  }, [thinkingStartTime])

  // Auto-scroll log to bottom when new events arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [liveEvents.length])

  if (!isThinking) return null

  const seconds = Math.floor(elapsed / 1000)

  // Split brain thoughts from tool events
  const brainEvents = liveEvents.filter((e: CodeEvent) => e.type === 'brain')
  const toolEvents  = liveEvents.filter((e: CodeEvent) => e.type !== 'brain')

  // Show tool action label when brain isn't talking
  const showToolLabel = currentAction &&
    !currentAction.match(/^(Thinking|All done|Here'?s|My plan|Working on step|Still at it)/)

  return (
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
          border: '1px solid rgba(59,130,246,0.25)',
        }}
      >
        <img src={logoUrl} alt="Jivam" className="w-5 h-5 object-contain" />
      </div>

      {/* Bubble */}
      <div
        className="glass-card rounded-2xl rounded-tl-sm px-4 py-2.5"
        style={{ minWidth: '200px', maxWidth: '480px' }}
      >
        {/* Brain commentary — warm conversational text */}
        {brainEvents.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {brainEvents.slice(-4).map((event, i) => (
              <motion.p
                key={event.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: i === brainEvents.slice(-4).length - 1 ? 1 : 0.45, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="text-sm leading-snug"
                style={{ color: 'var(--accent)', fontStyle: 'italic' }}
              >
                {event.detail}
              </motion.p>
            ))}
          </div>
        )}

        {/* Top row: terminal icon + action label */}
        <div className="flex items-center gap-2.5">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Terminal size={13} className="text-[var(--accent-blue)] flex-shrink-0" />
          </motion.div>

          <div className="flex-1 overflow-hidden min-w-0">
            <AnimatePresence mode="wait">
              {(showToolLabel || brainEvents.length === 0) && (
                <motion.span
                  key={showToolLabel ? currentAction! : 'thinking'}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.18 }}
                  className="text-sm text-[var(--text-subtle)] block truncate"
                >
                  {showToolLabel ? currentAction : 'Working on it...'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {seconds >= 10 && (
            <span className="text-xs text-[var(--text-subtle)] flex-shrink-0">
              {seconds}s
            </span>
          )}
        </div>

        {/* Tool event log — non-brain events only */}
        {toolEvents.length > 0 && (
          <div
            ref={logRef}
            className="mt-2 pt-2 space-y-1 overflow-y-auto"
            style={{
              maxHeight: '180px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {toolEvents.map((event) => (
              <CodeEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
