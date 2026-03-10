import { Users } from 'lucide-react'

export function CoworkPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'rgba(139, 92, 246, 0.1)' }}
      >
        <Users size={36} className="text-[var(--accent)]" />
      </div>
      <h2 className="text-2xl font-semibold gradient-text mb-3">Cowork Mode</h2>
      <p className="text-[var(--text-muted)] max-w-sm leading-relaxed">
        Multi-agent collaboration workspace is coming soon. Coordinate multiple AI agents
        on complex projects together.
      </p>
      <div
        className="mt-6 px-4 py-2 rounded-full text-sm border border-dashed"
        style={{
          borderColor: 'var(--card-border)',
          color: 'var(--text-subtle)',
        }}
      >
        Coming Soon
      </div>
    </div>
  )
}
