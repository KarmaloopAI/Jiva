import { Settings, AlertTriangle, XCircle } from 'lucide-react'
import type { CodeEvent } from '../../store/code.store'

interface CodeEventCardProps {
  event: CodeEvent
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
}

export function CodeEventCard({ event }: CodeEventCardProps) {
  const cfg = CONFIG[event.type]
  const Icon = cfg.icon

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: cfg.color,
      }}
    >
      <Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
      <span className="truncate">{event.detail}</span>
    </div>
  )
}
