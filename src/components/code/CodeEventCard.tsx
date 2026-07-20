import { Settings, AlertTriangle, XCircle, Brain, ChevronDown, ChevronUp } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CodeEvent } from '../../store/code.store'

interface CodeEventCardProps {
  event: CodeEvent
  onToggle?: () => void
}

const CONFIG: Record<CodeEvent['type'], {
  icon: typeof Settings
  color: string
  bg: string
  border: string
}> = {
  tool: {
    icon: Settings,
    color: 'var(--accent-blue)',
    bg: 'rgba(59,130,246,0.06)',
    border: 'rgba(59,130,246,0.18)',
  },
  warn: {
    icon: AlertTriangle,
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.07)',
    border: 'rgba(245,158,11,0.2)',
  },
  error: {
    icon: XCircle,
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.07)',
    border: 'rgba(239,68,68,0.2)',
  },
  brain: {
    icon: Brain,
    color: 'var(--accent)',
    bg: 'rgba(139,92,246,0.06)',
    border: 'rgba(139,92,246,0.18)',
  },
}

export function CodeEventCard({ event, onToggle }: CodeEventCardProps) {
  const cfg = CONFIG[event.type]
  const Icon = cfg.icon
  const paramEntries = event.params ? Object.entries(event.params) : []
  const canExpand = paramEntries.length > 0

  return (
    <div
      className="rounded-lg text-xs overflow-hidden"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <button
        onClick={canExpand ? onToggle : undefined}
        disabled={!canExpand}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        style={{ color: cfg.color, cursor: canExpand ? 'pointer' : 'default' }}
      >
        <Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
        <span className="truncate flex-1">{event.detail}</span>
        {canExpand && (
          event.expanded
            ? <ChevronUp size={11} className="flex-shrink-0" style={{ color: cfg.color }} />
            : <ChevronDown size={11} className="flex-shrink-0" style={{ color: cfg.color }} />
        )}
      </button>

      <AnimatePresence>
        {canExpand && event.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-2 pt-0.5 space-y-0.5"
              style={{ borderTop: `1px solid ${cfg.border}` }}
            >
              {paramEntries.map(([key, value]) => (
                <div key={key} className="flex gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex-shrink-0" style={{ color: cfg.color }}>{key}:</span>
                  <span className="break-all">{JSON.stringify(value)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
