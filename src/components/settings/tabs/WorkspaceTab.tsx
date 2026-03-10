import { useState, useEffect } from 'react'
import { FolderOpen, FolderInput, CheckCircle2 } from 'lucide-react'
import { Button } from '../../ui/Button'

export function WorkspaceTab() {
  const [workspaceDir, setWorkspaceDir] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electron.workspace.getDir().then((dir) => {
      setWorkspaceDir(dir as string)
    })
  }, [])

  async function handleBrowse() {
    const dir = await window.electron.workspace.pickDir()
    if (dir) setWorkspaceDir(dir as string)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await window.electron.workspace.setDir(workspaceDir)
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
        <h2 className="text-sm font-semibold text-[var(--text)] mb-1">Workspace Directory</h2>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          The workspace is where Jiva writes files it creates (reports, documents, code, etc.).
          This directory will appear in the{' '}
          <strong className="text-[var(--text)]">Files</strong> tab so you can browse and preview
          everything Jiva produces.
        </p>
      </div>

      {/* Directory picker */}
      <div
        className="rounded-2xl p-5 space-y-4"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--card-border)',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <FolderOpen size={14} className="text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text)]">Directory</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={workspaceDir}
            onChange={(e) => setWorkspaceDir(e.target.value)}
            placeholder="~/Documents/jiva-workspace"
            className="flex-1 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              color: 'var(--text)',
              outline: 'none',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '12px',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent)'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--input-border)'
            }}
          />
          <button
            onClick={handleBrowse}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(59,130,246,0.08))',
              border: '1px solid rgba(139,92,246,0.25)',
              color: 'var(--accent)',
            }}
          >
            <FolderInput size={13} />
            Browse
          </button>
        </div>

        <p className="text-[11px] text-[var(--text-subtle)]">
          Default: your home directory (~). Jiva's filesystem MCP will also use this as its root.
        </p>
      </div>

      {/* Directive location info */}
      <div
        className="rounded-xl px-4 py-3 flex items-start gap-3"
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.04))',
          border: '1px solid rgba(139,92,246,0.15)',
        }}
      >
        <FolderOpen size={13} className="text-[var(--accent)] mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-[var(--text)] mb-1">Jiva Directive</p>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            System instructions live at{' '}
            <code className="text-[var(--accent)] bg-black/10 px-1 py-0.5 rounded text-[10px]">
              ~/.jiva/jiva-directive.md
            </code>
            . Edit this file to customise Jiva's default behaviour.
          </p>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || !workspaceDir}
          className="flex items-center gap-1.5"
        >
          {saved ? (
            <>
              <CheckCircle2 size={14} />
              Saved
            </>
          ) : saving ? (
            'Saving...'
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </div>
  )
}
