import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useJivaStore } from '../../store/jiva.store'
import { logoUrl } from '../../lib/logo'
import { CodeEventCard } from '../code/CodeEventCard'
import type { CodeEvent } from '../../store/code.store'

const PHASE_LABELS: Record<string, string> = {
  planning:     'Planning your request...',
  executing:    'Working on it...',
  synthesizing: 'Putting it all together...',
}

interface TypingIndicatorProps {
  startTime: number | null
}

export function TypingIndicator({ startTime }: TypingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0)
  const { currentPhase, currentAction, liveEvents } = useJivaStore()
  const toolLogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!startTime) return
    const interval = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(interval)
  }, [startTime])

  // Auto-scroll tool log to bottom on new events
  useEffect(() => {
    if (toolLogRef.current) {
      toolLogRef.current.scrollTop = toolLogRef.current.scrollHeight
    }
  }, [liveEvents.length])

  const seconds = Math.floor(elapsed / 1000)

  // Split brain thoughts from tool/warn/error events
  const brainEvents: CodeEvent[] = liveEvents.filter((e: CodeEvent) => e.type === 'brain')
  const toolEvents: CodeEvent[]  = liveEvents.filter((e: CodeEvent) => e.type !== 'brain')

  // Phase fallback when no live action text is available
  const phaseLabel = currentPhase
    ? (PHASE_LABELS[currentPhase] ?? 'Working on it...')
    : elapsed < 3000 ? 'Starting up...'
    : elapsed < 15000 ? 'Planning your request...'
    : 'Working on it...'

  // Primary status line: use tool activity; hide if brain commentary is showing
  const primaryLabel = currentAction && !currentAction.match(/^(Thinking|All done|Here'?s|My plan|Working on step|Still at it)/)
    ? currentAction
    : brainEvents.length === 0 ? phaseLabel : null

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm"
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
          border: '1px solid rgba(139,92,246,0.2)',
        }}
      >
        <img src={logoUrl} alt="Jivam" className="w-5 h-5 object-contain" />
      </div>

      {/* Bubble */}
      <div
        className="glass-card rounded-2xl rounded-tl-sm px-4 py-3"
        style={{ minWidth: '200px', maxWidth: '480px' }}
      >
        {/* Brain commentary — warm conversational text stream */}
        {brainEvents.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {brainEvents.slice(-4).map((event: CodeEvent, i: number) => (
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

        {/* Dots + tool activity label (when brain isn't dominant) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
          <div className="flex-1 overflow-hidden min-w-0">
            <AnimatePresence mode="wait">
              {primaryLabel && (
                <motion.span
                  key={primaryLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="text-sm text-[var(--text-subtle)] block truncate"
                >
                  {primaryLabel}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {seconds > 15 && (
            <span className="text-xs text-[var(--text-subtle)] flex-shrink-0">
              {seconds}s
            </span>
          )}
        </div>

        {/* Tool event log — only non-brain events */}
        {toolEvents.length > 0 && (
          <div
            ref={toolLogRef}
            className="mt-2 pt-2 space-y-1 overflow-y-auto"
            style={{
              maxHeight: '112px',
              borderTop: '1px solid rgba(139,92,246,0.10)',
            }}
          >
            {toolEvents.map((event: CodeEvent) => (
              <CodeEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
