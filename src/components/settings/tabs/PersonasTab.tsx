import { useEffect, useState } from 'react'
import { Users, Sparkles, MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot, type LucideIcon } from 'lucide-react'
import type { PersonaInfo } from '../../../types/persona'

const PERSONA_ICONS: Record<string, LucideIcon> = {
  MessageSquare,
  Search,
  Code2,
  Layers,
  FlaskConical,
  BarChart3,
  Bot,
}

export function PersonasTab() {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])

  useEffect(() => {
    window.electron.personas.list().then((p) => setPersonas(p as PersonaInfo[]))
  }, [])

  return (
    <div className="max-w-xl mx-auto">
      {/* Coming Soon banner */}
      <div
        className="rounded-2xl p-6 mb-8 text-center"
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.06))',
          border: '1px solid rgba(139,92,246,0.2)',
        }}
      >
        <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))',
        }}>
          <Sparkles size={24} className="text-[var(--accent)]" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text)] mb-1">Personas & Plugins</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Full persona and plugin management is coming soon.
        </p>
        <p className="text-xs text-[var(--text-subtle)] mt-2">
          For now, create persona folders manually in{' '}
          <code className="text-[var(--accent)] bg-black/10 px-1 py-0.5 rounded">~/.jiva/personas/</code>
        </p>
      </div>

      {/* Read-only list of current personas */}
      {personas.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text)]">Available Personas</h2>
          </div>
          <div className="space-y-2">
            {personas.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--card-border)',
                }}
              >
                {(() => {
                  const IconComp = PERSONA_ICONS[p.icon] ?? Bot
                  return (
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
                        border: '1px solid rgba(139,92,246,0.2)',
                      }}
                    >
                      <IconComp size={15} className="text-[var(--accent)]" />
                    </div>
                  )
                })()}
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text)]">{p.displayName ?? p.name}</p>
                  {p.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{p.description}</p>
                  )}
                </div>
                <span className="text-[10px] text-[var(--text-subtle)] font-mono">{p.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
