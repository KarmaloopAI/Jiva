import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useJivaStore } from '../../store/jiva.store'
import { logoUrl } from '../../lib/logo'
import { CodeEventCard } from '../code/CodeEventCard'

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
  const { currentPhase, currentAction, liveEvents, lastPlan } = useJivaStore()
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!startTime) return
    const interval = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(interval)
  }, [startTime])

  // Auto-scroll event log to bottom on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [liveEvents.length])

  const seconds = Math.floor(elapsed / 1000)

  // Phase fallback when no live action text is available
  const phaseLabel = currentPhase
    ? (PHASE_LABELS[currentPhase] ?? 'Working on it...')
    : elapsed < 3000 ? 'Starting up...'
    : elapsed < 15000 ? 'Planning your request...'
    : 'Working on it...'

  // Primary status: live tool activity trumps the generic phase text
  const primaryLabel = currentAction ?? phaseLabel

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
        style={{ minWidth: '180px', maxWidth: '420px' }}
      >
        {/* Primary row: dots + live label */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
          <div className="flex-1 overflow-hidden min-w-0">
            <AnimatePresence mode="wait">
              <motion.span
                key={primaryLabel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="text-sm text-[var(--text-muted)] block truncate"
              >
                {primaryLabel}
              </motion.span>
            </AnimatePresence>
          </div>
          {seconds > 15 && (
            <span className="text-xs text-[var(--text-subtle)] flex-shrink-0">
              {seconds}s
            </span>
          )}
        </div>

        {/* Live event log — scrollable, max ~4 cards */}
        {liveEvents.length > 0 && (
          <div
            ref={logRef}
            className="mt-2 pt-2 space-y-1 overflow-y-auto"
            style={{
              maxHeight: '112px',
              borderTop: '1px solid rgba(139,92,246,0.12)',
            }}
          >
            {liveEvents.map((event) => (
              <CodeEventCard key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* Plan details if available */}
        {lastPlan && (
          <div className="mt-2 pl-7 text-xs text-[var(--text-subtle)]">
            {lastPlan.reasoning && (
              <p className="italic mb-1">{lastPlan.reasoning}</p>
            )}
            <ul className="list-disc list-inside space-y-0.5">
              {lastPlan.subtasks.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
