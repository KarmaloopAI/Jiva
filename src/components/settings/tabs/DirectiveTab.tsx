import { useState, useEffect } from 'react'
import { CheckCircle2, FileText, Info } from 'lucide-react'
import { Button } from '../../ui/Button'

const PLACEHOLDER = `You are Jiva, a capable and thoughtful AI assistant.

Guidelines:
- Be concise and precise in responses
- When writing code, prefer readability and maintainability
- Always explain your reasoning when making important decisions`

const DYNAMIC_PREVIEW = `---

# Jiva Operating Context

## Current Date & Time
- Date: Saturday, March 14, 2026
- Time: 14:30 IST
- ISO: 2026-03-14T09:00:00.000Z

## Important
- Always use the date above when referencing "today", "current year", or "recent" events
- Do NOT rely on training data for the current date — use only what is stated above
- When performing web searches, always use the year 2026 for current events

## Recent Session Activity
| Date | Title | Messages |
|------|-------|----------|
| 2026-03-14 14:20 | "Help me refactor the auth module" | 12 |`

export function DirectiveTab() {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    window.electron.directive.get().then((val) => {
      setContent(val ?? '')
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await window.electron.directive.set(content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text)] mb-1">Agent Directive</h2>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Write custom instructions that shape how Jiva behaves in every session. Date, time, and
          recent conversation history are appended automatically — you don't need to include them.
        </p>
      </div>

      {/* Info box */}
      <div
        className="rounded-xl px-4 py-3 flex items-start gap-3"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(139,92,246,0.04))',
          border: '1px solid rgba(59,130,246,0.15)',
        }}
      >
        <Info size={13} className="text-[var(--accent-blue)] mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-[var(--text)] mb-1">How it works</p>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Your directive is prepended to the agent's system context. Jivam then appends the
            current date, timezone, and your recent sessions automatically. The combined content
            is saved to{' '}
            <code className="text-[var(--accent)] bg-black/10 px-1 py-0.5 rounded text-[10px]">
              ~/.jiva/jiva-directive.md
            </code>{' '}
            each time an agent session starts.
          </p>
        </div>
      </div>

      {/* Textarea */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--card-border)' }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b"
          style={{
            borderColor: 'var(--card-border)',
            background: 'var(--bg-secondary)',
          }}
        >
          <FileText size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-muted)]">Custom Instructions</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={12}
          className="w-full px-4 py-3 text-sm resize-none outline-none leading-relaxed"
          style={{
            background: 'var(--input-bg)',
            color: 'var(--text)',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '12px',
            lineHeight: '1.6',
          }}
        />
      </div>

      {/* Dynamic context preview toggle */}
      <div>
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] text-[var(--accent)] hover:underline transition-colors"
        >
          {showPreview ? 'Hide' : 'Preview'} auto-appended context →
        </button>

        {showPreview && (
          <div
            className="mt-3 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--card-border)' }}
          >
            <div
              className="px-4 py-2 border-b"
              style={{ borderColor: 'var(--card-border)', background: 'var(--bg-secondary)' }}
            >
              <span className="text-[11px] text-[var(--text-subtle)]">
                Appended automatically (example with today's date)
              </span>
            </div>
            <pre
              className="px-4 py-3 text-[11px] overflow-x-auto leading-relaxed"
              style={{
                background: 'var(--input-bg)',
                color: 'var(--text-muted)',
                fontFamily: 'ui-monospace, monospace',
                whiteSpace: 'pre-wrap',
              }}
            >
              {DYNAMIC_PREVIEW}
            </pre>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5"
        >
          {saved ? (
            <>
              <CheckCircle2 size={14} />
              Saved
            </>
          ) : saving ? (
            'Saving…'
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </div>
  )
}
