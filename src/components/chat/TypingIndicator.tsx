import { useEffect, useState } from 'react'
import { THINKING_PHASES } from '../../lib/constants'
import { useJivaStore } from '../../store/jiva.store'
import { logoUrl } from '../../lib/logo'

interface TypingIndicatorProps {
  startTime: number | null
}

export function TypingIndicator({ startTime }: TypingIndicatorProps) {
    const [elapsed, setElapsed] = useState(0)

    const lastPlan = useJivaStore(state => state.lastPlan)

    useEffect(() => {
      if (!startTime) return

      const interval = setInterval(() => {
        setElapsed(Date.now() - startTime)
      }, 1000)

      return () => clearInterval(interval)
    }, [startTime])

    const phase = THINKING_PHASES.find((p) => elapsed < p.maxMs) ?? THINKING_PHASES[THINKING_PHASES.length - 1]
    const seconds = Math.floor(elapsed / 1000)

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
          className="glass-card rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3"
          style={{ minWidth: '160px' }}
        >
          {/* Dots */}
          <div className="flex items-center gap-1">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>

          {/* Phase message */}
          <span className="text-sm text-[var(--text-muted)]">
            {phase.message}
            {seconds > 15 && (
              <span className="ml-1 text-xs text-[var(--text-subtle)]">({seconds}s)</span>
            )}
          </span>
          {/* Show plan details if available */}
          {lastPlan && (
            <div className="ml-2 text-xs text-[var(--text-subtle)]">
              <div className="font-medium">Plan:</div>
              {lastPlan.reasoning && <div className="italic mb-1">{lastPlan.reasoning}</div>}
              <ul className="list-disc list-inside">
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
  

