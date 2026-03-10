import { useState, useEffect } from 'react'
import { Cpu, Key, Globe, Save } from 'lucide-react'
import { Button } from '../../ui/Button'

interface ModelConfig {
  provider?: string
  apiKey?: string
  endpoint?: string
  model?: string
  useHarmonyFormat?: boolean
}

interface JivaConfig {
  models: {
    reasoning: ModelConfig | null
    multimodal?: ModelConfig | null
  }
  [key: string]: unknown
}

export function ModelsTab() {
  const [config, setConfig] = useState<JivaConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Reasoning model fields
  const [rEndpoint, setREndpoint] = useState('')
  const [rApiKey, setRApiKey] = useState('')
  const [rModel, setRModel] = useState('')
  const [rProvider, setRProvider] = useState('')
  const [rHarmony, setRHarmony] = useState(false)

  // Multimodal model fields
  const [mEnabled, setMEnabled] = useState(false)
  const [mEndpoint, setMEndpoint] = useState('')
  const [mApiKey, setMApiKey] = useState('')
  const [mModel, setMModel] = useState('')

  useEffect(() => {
    window.electron.config.read().then((cfg) => {
      const c = cfg as JivaConfig | null
      setConfig(c)
      if (c?.models?.reasoning) {
        setREndpoint(c.models.reasoning.endpoint ?? '')
        setRApiKey(c.models.reasoning.apiKey ?? '')
        setRModel(c.models.reasoning.model ?? '')
        setRProvider(c.models.reasoning.provider ?? '')
        setRHarmony(c.models.reasoning.useHarmonyFormat ?? false)
      }
      if (c?.models?.multimodal) {
        setMEnabled(true)
        setMEndpoint((c.models.multimodal as ModelConfig).endpoint ?? '')
        setMApiKey((c.models.multimodal as ModelConfig).apiKey ?? '')
        setMModel((c.models.multimodal as ModelConfig).model ?? '')
      }
    })
  }, [])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    const updated: JivaConfig = {
      ...config,
      models: {
        reasoning: {
          ...config.models?.reasoning,
          provider: rProvider,
          endpoint: rEndpoint,
          apiKey: rApiKey,
          model: rModel,
          useHarmonyFormat: rHarmony,
        },
        multimodal: mEnabled
          ? { endpoint: mEndpoint, apiKey: mApiKey, model: mModel }
          : undefined,
      },
    }
    await window.electron.config.write(updated)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const inputStyle = {
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    color: 'var(--text)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: '4px',
  }

  return (
    <div className="max-w-xl mx-auto space-y-8">
      {/* Reasoning Model */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text)]">Reasoning Model</h2>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{
            background: 'rgba(139,92,246,0.1)',
            color: 'var(--accent)',
            border: '1px solid rgba(139,92,246,0.2)',
          }}>Primary</span>
        </div>

        <div className="space-y-3 p-4 rounded-xl" style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--card-border)',
        }}>
          <div>
            <label style={labelStyle}>Provider (optional)</label>
            <input
              style={inputStyle}
              value={rProvider}
              onChange={(e) => setRProvider(e.target.value)}
              placeholder="krutrim"
            />
          </div>
          <div>
            <label style={labelStyle}>
              <span className="flex items-center gap-1"><Globe size={10} /> API Endpoint</span>
            </label>
            <input
              style={inputStyle}
              value={rEndpoint}
              onChange={(e) => setREndpoint(e.target.value)}
              placeholder="https://cloud.olakrutrim.com/v1"
            />
          </div>
          <div>
            <label style={labelStyle}>
              <span className="flex items-center gap-1"><Key size={10} /> API Key</span>
            </label>
            <input
              style={inputStyle}
              type="password"
              value={rApiKey}
              onChange={(e) => setRApiKey(e.target.value)}
              placeholder="Your API key"
            />
          </div>
          <div>
            <label style={labelStyle}>Model Name</label>
            <input
              style={inputStyle}
              value={rModel}
              onChange={(e) => setRModel(e.target.value)}
              placeholder="Meta-Llama-3.1-405B-Instruct"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="harmony"
              checked={rHarmony}
              onChange={(e) => setRHarmony(e.target.checked)}
              className="accent-purple-500"
            />
            <label htmlFor="harmony" className="text-xs text-[var(--text-muted)] cursor-pointer">
              Use Harmony format (Krutrim-specific)
            </label>
          </div>
        </div>
      </section>

      {/* Multimodal Model */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={16} className="text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text)]">Multimodal / Vision Model</h2>
          <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
            <span className="text-xs text-[var(--text-muted)]">Enable</span>
            <button
              onClick={() => setMEnabled((v) => !v)}
              className="relative rounded-full transition-colors"
              style={{
                background: mEnabled ? 'var(--accent)' : 'var(--bg-secondary)',
                border: '1px solid var(--card-border)',
                height: '20px',
                width: '36px',
              }}
            >
              <span
                className="absolute top-0.5 bg-white rounded-full shadow-sm transition-all"
                style={{
                  width: '16px',
                  height: '16px',
                  left: mEnabled ? '16px' : '2px',
                }}
              />
            </button>
          </label>
        </div>

        {mEnabled && (
          <div className="space-y-3 p-4 rounded-xl" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--card-border)',
          }}>
            <div>
              <label style={labelStyle}>
                <span className="flex items-center gap-1"><Globe size={10} /> API Endpoint</span>
              </label>
              <input style={inputStyle} value={mEndpoint} onChange={(e) => setMEndpoint(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label style={labelStyle}>
                <span className="flex items-center gap-1"><Key size={10} /> API Key</span>
              </label>
              <input style={inputStyle} type="password" value={mApiKey} onChange={(e) => setMApiKey(e.target.value)} placeholder="Your API key" />
            </div>
            <div>
              <label style={labelStyle}>Model Name</label>
              <input style={inputStyle} value={mModel} onChange={(e) => setMModel(e.target.value)} placeholder="gpt-4o" />
            </div>
          </div>
        )}
      </section>

      {/* Save */}
      <Button
        variant="primary"
        size="sm"
        onClick={handleSave}
        className="flex items-center gap-2"
        disabled={saving}
      >
        <Save size={14} />
        {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
      </Button>
    </div>
  )
}
