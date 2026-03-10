import { Code2 } from 'lucide-react'

export function CodePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'rgba(59, 130, 246, 0.1)' }}
      >
        <Code2 size={36} className="text-[var(--accent-blue)]" />
      </div>
      <h2 className="text-2xl font-semibold gradient-text mb-3">Code Mode</h2>
      <p className="text-[var(--text-muted)] max-w-sm leading-relaxed">
        An integrated coding environment powered by Jiva is coming soon. Write, review,
        and debug code with AI assistance.
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
