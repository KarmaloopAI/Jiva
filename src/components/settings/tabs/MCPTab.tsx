import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Server, Wifi, WifiOff, Wrench, X, RefreshCw, RotateCcw } from 'lucide-react'
import type { MCPServerStatus, MCPServerConfig } from '../../../types/electron'
import { Button } from '../../ui/Button'

interface EnvRow {
  key: string
  value: string
}

interface ServerFormState {
  name: string
  type: 'stdio' | 'http'
  command: string
  args: string
  url: string
  envRows: EnvRow[]
  enabled: boolean
}

const emptyForm = (): ServerFormState => ({
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  envRows: [],
  enabled: true,
})

function EnvEditor({
  rows,
  onChange,
}: {
  rows: EnvRow[]
  onChange: (rows: EnvRow[]) => void
}) {
  const update = (idx: number, field: 'key' | 'value', val: string) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r))
    onChange(next)
  }
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx))
  const add = () => onChange([...rows, { key: '', value: '' }])

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <input
            placeholder="KEY"
            value={row.key}
            onChange={(e) => update(idx, 'key', e.target.value)}
            className="flex-1 text-xs rounded-lg px-2 py-1.5 outline-none font-mono"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
          />
          <input
            placeholder="value"
            value={row.value}
            onChange={(e) => update(idx, 'value', e.target.value)}
            className="flex-1 text-xs rounded-lg px-2 py-1.5 outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
          />
          <button onClick={() => remove(idx)} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-xs text-[var(--accent)] hover:opacity-80 transition-opacity"
      >
        <Plus size={12} /> Add env variable
      </button>
    </div>
  )
}

function ServerForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: ServerFormState
  isNew: boolean
  onSave: (form: ServerFormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<ServerFormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputStyle = {
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    color: 'var(--text)',
    borderRadius: '8px',
    padding: '7px 10px',
    fontSize: '12px',
    outline: 'none',
    width: '100%',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (form.type === 'stdio' && !form.command.trim()) { setError('Command is required'); return }
    if (form.type === 'http' && !form.url.trim()) { setError('URL is required'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 p-4 rounded-xl mt-2" style={{
      background: 'rgba(139,92,246,0.05)',
      border: '1px solid rgba(139,92,246,0.15)',
    }}>
      {/* Name */}
      <div>
        <label style={labelStyle}>Server Name</label>
        <input
          style={inputStyle}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="my-server"
          disabled={!isNew}
        />
      </div>

      {/* Type */}
      <div>
        <label style={labelStyle}>Type</label>
        <div className="flex gap-2">
          {(['stdio', 'http'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setForm({ ...form, type: t })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: form.type === t ? 'var(--accent)' : 'var(--bg-secondary)',
                color: form.type === t ? 'white' : 'var(--text-muted)',
                border: '1px solid var(--card-border)',
              }}
            >
              {t === 'stdio' ? 'stdio (local)' : 'http (remote)'}
            </button>
          ))}
        </div>
      </div>

      {form.type === 'stdio' ? (
        <>
          <div>
            <label style={labelStyle}>Command</label>
            <input style={inputStyle} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx" />
          </div>
          <div>
            <label style={labelStyle}>Arguments (comma-separated)</label>
            <input style={inputStyle} value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="-y, @modelcontextprotocol/server-brave-search" />
          </div>
        </>
      ) : (
        <div>
          <label style={labelStyle}>URL</label>
          <input style={inputStyle} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
        </div>
      )}

      {/* Env vars */}
      <div>
        <label style={labelStyle}>Environment Variables</label>
        <EnvEditor rows={form.envRows} onChange={(envRows) => setForm({ ...form, envRows })} />
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="srv-enabled"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="accent-purple-500"
        />
        <label htmlFor="srv-enabled" className="text-xs text-[var(--text-muted)] cursor-pointer">
          Enabled
        </label>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : isNew ? 'Add Server' : 'Save Changes'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function MCPTab() {
  const [servers, setServers] = useState<MCPServerStatus[]>([])
  const [tools, setTools] = useState<Record<string, Array<{ name: string; description: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [togglingServer, setTogglingServer] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [statusList, toolsMap] = await Promise.all([
      window.electron.mcp.listStatus(),
      window.electron.mcp.getTools(),
    ])
    setServers(statusList)
    setTools(toolsMap)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleReconnect = async (name: string) => {
    setReconnecting(name)
    await window.electron.mcp.reconnectServer(name)
    setReconnecting(null)
    await reload()
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    setTogglingServer(name)
    await window.electron.mcp.toggleServer(name, enabled)
    setTogglingServer(null)
    await reload()
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove MCP server "${name}"? This will also remove it from config.`)) return
    setDeleting(name)
    await window.electron.mcp.removeServer(name)
    setDeleting(null)
    await reload()
  }

  const formToConfig = (form: ServerFormState): MCPServerConfig => {
    const env: Record<string, string> = {}
    for (const { key, value } of form.envRows) {
      if (key.trim()) env[key.trim()] = value
    }
    if (form.type === 'stdio') {
      return {
        type: 'stdio',
        command: form.command.trim(),
        args: form.args.split(',').map((a) => a.trim()).filter(Boolean),
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled: form.enabled,
      }
    } else {
      return {
        type: 'http',
        url: form.url.trim(),
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled: form.enabled,
      }
    }
  }

  const serverToForm = (s: MCPServerStatus): ServerFormState => ({
    name: s.name,
    type: s.type,
    command: s.command,
    args: (s.args ?? []).join(', '),
    url: s.url ?? '',
    envRows: Object.entries(s.env ?? {}).map(([key, value]) => ({ key, value })),
    enabled: s.enabled,
  })

  const handleAddServer = async (form: ServerFormState) => {
    const config = formToConfig(form)
    const result = await window.electron.mcp.addServer(form.name.trim(), config)
    if (!result.success) throw new Error(result.error ?? 'Failed to add server')
    setShowAddForm(false)
    await reload()
  }

  const handleEditServer = async (form: ServerFormState) => {
    // Remove and re-add to update
    await window.electron.mcp.removeServer(form.name)
    const config = formToConfig(form)
    const result = await window.electron.mcp.addServer(form.name, config)
    if (!result.success) throw new Error(result.error ?? 'Failed to update server')
    setEditingServer(null)
    await reload()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-[var(--text-muted)]">Loading MCP servers...</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">MCP Servers</h2>
          <p className="text-xs text-[var(--text-subtle)] mt-0.5">
            {servers.filter(s => s.connected).length}/{servers.length} connected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            title="Refresh status"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            style={{ border: '1px solid var(--card-border)', background: 'var(--bg-secondary)' }}
          >
            <RefreshCw size={13} />
          </button>
          <Button variant="primary" size="sm" onClick={() => { setShowAddForm(true); setEditingServer(null) }} className="flex items-center gap-1.5">
            <Plus size={13} />
            Add Server
          </Button>
        </div>
      </div>

      {/* Add new server form */}
      {showAddForm && (
        <ServerForm
          initial={emptyForm()}
          isNew
          onSave={handleAddServer}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Server list */}
      <div className="space-y-3">
        {servers.length === 0 && !showAddForm && (
          <div className="text-center py-12">
            <Server size={28} className="mx-auto mb-2 text-[var(--text-subtle)] opacity-30" />
            <p className="text-sm text-[var(--text-subtle)]">No MCP servers configured</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Click "Add Server" to get started</p>
          </div>
        )}

        {servers.map((server) => {
          const serverTools = tools[server.name] ?? []
          const isExpanded = expandedServer === server.name
          const isEditing = editingServer === server.name

          return (
            <div
              key={server.name}
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${server.connected ? 'rgba(34,197,94,0.2)' : 'var(--card-border)'}`,
              }}
            >
              {/* Server row */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    server.connected
                      ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                      : server.enabled
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-gray-500'
                  }`}
                />

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[var(--text)] capitalize">{server.name}</span>
                  <span className="ml-2 text-xs text-[var(--text-subtle)]">
                    {server.type === 'stdio' ? server.command : server.url}
                  </span>
                </div>

                {/* Tool count */}
                {serverTools.length > 0 && (
                  <button
                    onClick={() => setExpandedServer(isExpanded ? null : server.name)}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors"
                    style={{
                      background: 'rgba(139,92,246,0.1)',
                      color: 'var(--accent)',
                      border: '1px solid rgba(139,92,246,0.15)',
                    }}
                  >
                    <Wrench size={10} />
                    {serverTools.length}
                    {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                )}

                {/* Reconnect button — visible when enabled but not connected */}
                {server.enabled && !server.connected && (
                  <button
                    onClick={() => handleReconnect(server.name)}
                    disabled={reconnecting === server.name}
                    title="Reconnect"
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg transition-colors"
                    style={{
                      color: 'var(--warning, #f59e0b)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      background: 'rgba(245,158,11,0.08)',
                      opacity: reconnecting === server.name ? 0.5 : 1,
                    }}
                  >
                    <RotateCcw size={10} />
                    {reconnecting === server.name ? '...' : 'Reconnect'}
                  </button>
                )}

                {/* Status icons */}
                <span title={server.connected ? 'Connected' : server.enabled ? 'Not connected' : 'Disabled'}>
                  {server.connected
                    ? <Wifi size={13} className="text-green-500" />
                    : <WifiOff size={13} className="text-[var(--text-muted)]" />
                  }
                </span>

                {/* Enable toggle */}
                <button
                  onClick={() => handleToggle(server.name, !server.enabled)}
                  disabled={togglingServer === server.name}
                  className="relative rounded-full transition-colors flex-shrink-0"
                  style={{
                    background: server.enabled ? 'var(--accent)' : 'var(--bg-secondary)',
                    border: '1px solid var(--card-border)',
                    height: '18px',
                    width: '32px',
                    opacity: togglingServer === server.name ? 0.5 : 1,
                  }}
                >
                  <span
                    className="absolute bg-white rounded-full shadow-sm transition-all"
                    style={{
                      width: '14px',
                      height: '14px',
                      top: '2px',
                      left: server.enabled ? '16px' : '2px',
                    }}
                  />
                </button>

                {/* Edit */}
                <button
                  onClick={() => {
                    setEditingServer(isEditing ? null : server.name)
                    setShowAddForm(false)
                  }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                >
                  {isEditing ? 'Cancel' : 'Edit'}
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(server.name)}
                  disabled={deleting === server.name}
                  className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Error message for disconnected servers */}
              {!server.connected && server.error && (
                <p
                  className="px-4 pb-2.5 text-xs font-mono leading-relaxed"
                  style={{ color: 'var(--error, #ef4444)', borderTop: '1px solid rgba(239,68,68,0.1)', paddingTop: '6px' }}
                >
                  {server.error}
                </p>
              )}

              {/* Edit form */}
              {isEditing && (
                <div className="px-4 pb-4">
                  <ServerForm
                    initial={serverToForm(server)}
                    isNew={false}
                    onSave={handleEditServer}
                    onCancel={() => setEditingServer(null)}
                  />
                </div>
              )}

              {/* Tools list */}
              {isExpanded && serverTools.length > 0 && (
                <div
                  className="px-4 pb-4 space-y-1.5 border-t"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] pt-3 mb-2">
                    Available Tools
                  </p>
                  {serverTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg px-3 py-2"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                    >
                      <p className="text-xs font-mono font-medium text-[var(--accent)]">{tool.name}</p>
                      {tool.description && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{tool.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
