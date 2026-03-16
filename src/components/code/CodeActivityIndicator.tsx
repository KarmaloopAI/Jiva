import { AnimatePresence, motion } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Terminal } from 'lucide-react'
import { useCodeStore } from '../../store/code.store'
import { logoUrl } from '../../lib/logo'

export function CodeActivityIndicator() {
  const { isThinking, currentAction, thinkingStartTime } = useCodeStore()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!thinkingStartTime) { setElapsed(0); return }
    const interval = setInterval(() => setElapsed(Date.now() - thinkingStartTime), 1000)
    return () => clearInterval(interval)
  }, [thinkingStartTime])

  if (!isThinking) return null

  const seconds = Math.floor(elapsed / 1000)

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
        <img src={logoUrl} alt="Jiva" className="w-5 h-5 object-contain" />
      </div>

      {/* Bubble */}
      <div
        className="glass-card rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-2.5"
        style={{ minWidth: '200px', maxWidth: '380px' }}
      >
        {/* Code icon pulse */}
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Terminal size={13} className="text-[var(--accent-blue)] flex-shrink-0" />
        </motion.div>

        {/* Rotating action text */}
        <div className="flex-1 overflow-hidden min-w-0">
          <AnimatePresence mode="wait">
            <motion.span
              key={currentAction ?? 'thinking'}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.18 }}
              className="text-sm text-[var(--text-muted)] block truncate"
            >
              {currentAction ?? 'Thinking...'}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Elapsed time after 10s */}
        {seconds >= 10 && (
          <span className="text-xs text-[var(--text-subtle)] flex-shrink-0">
            {seconds}s
          </span>
        )}
      </div>
    </div>
  )
}
