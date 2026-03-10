import { clsx } from 'clsx'
import { MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot, type LucideIcon } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { PersonaInfo } from '../../types/persona'

const PERSONA_ICONS: Record<string, LucideIcon> = {
  MessageSquare,
  Search,
  Code2,
  Layers,
  FlaskConical,
  BarChart3,
  Bot,
}

interface PersonaCardProps {
  persona: PersonaInfo
  isActive: boolean
  onSelect: (name: string) => void
}

export function PersonaCard({ persona, isActive, onSelect }: PersonaCardProps) {
  return (
    <button
      onClick={() => onSelect(persona.name)}
      className={clsx(
        'w-full text-left p-3 rounded-xl transition-all border',
        isActive
          ? 'border-purple-400/50 dark:border-purple-500/50'
          : 'border-transparent hover:border-purple-200 dark:hover:border-purple-700/40'
      )}
      style={{
        background: isActive
          ? 'rgba(139, 92, 246, 0.1)'
          : 'transparent',
      }}
    >
      <div className="flex items-start gap-3">
        {(() => {
          const IconComp = PERSONA_ICONS[persona.icon] ?? Bot
          return (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
                border: '1px solid rgba(139,92,246,0.2)',
              }}
            >
              <IconComp size={17} className="text-[var(--accent)]" />
            </div>
          )
        })()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'text-sm font-medium',
                isActive ? 'text-[var(--accent)]' : 'text-[var(--text)]'
              )}
            >
              {persona.displayName}
            </span>
            {persona.isBuiltIn && (
              <Badge variant="default" className="text-[10px] py-0 px-1.5">
                Built-in
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2 leading-relaxed">
            {persona.description}
          </p>
          {persona.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {persona.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-subtle)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
