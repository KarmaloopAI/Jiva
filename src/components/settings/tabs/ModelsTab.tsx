import { useState, useEffect, useCallback } from 'react'
import { Cpu, Key, Globe, Save, ChevronDown, ChevronUp, Zap, RefreshCw } from 'lucide-react'
import { Button } from '../../ui/Button'
import { ModelSetupStep } from '../../setup/ModelSetupStep'
import { toChatCompletionsUrl } from '../../../lib/endpoint-utils'

interface ModelConfig {
  provider?: string
  apiKey?: string
  endpoint?: string
  defaultModel?: string
  model?: string           // legacy alias — prefer defaultModel
  useHarmonyFormat?: boolean
  defaultMaxTokens?: number
  maxRequestsPerMinute?: number
  hasVision?: boolean
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
  const [showProviderPicker, setShowProviderPicker] = useState(false)

  // Reasoning model fields
  const [rEndpoint, setREndpoint] = useState('')
  const [rApiKey, setRApiKey] = useState('')
  const [rModel, setRModel] = useState('')
  const [rProvider, setRProvider] = useState('')
  const [rHarmony, setRHarmony] = useState(false)
  const [rMaxTokens, setRMaxTokens] = useState('')
  const [rRateLimit, setRRateLimit] = useState('')
  const [rHasVision, setRHasVision] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  // Multimodal model fields
  const [mEnabled, setMEnabled] = useState(false)
  const [mEndpoint, setMEndpoint] = useState('')
  const [mApiKey, setMApiKey] = useState('')
  const [mModel, setMModel] = useState('')

  const loadConfig = useCallback(() => {
    window.electron.config.read().then((cfg) => {
      const c = cfg as JivaConfig | null
      setConfig(c)
      if (c?.models?.reasoning) {
        setREndpoint(c.models.reasoning.endpoint ?? '')
        setRApiKey(c.models.reasoning.apiKey ?? '')
        // prefer defaultModel; fall back to legacy model field for older configs
        setRModel(c.models.reasoning.defaultModel ?? c.models.reasoning.model ?? '')
        setRProvider(c.models.reasoning.provider ?? '')
        setRHarmony(c.models.reasoning.useHarmonyFormat ?? false)
        setRMaxTokens(c.models.reasoning.defaultMaxTokens != null ? String(c.models.reasoning.defaultMaxTokens) : '')
        setRRateLimit(c.models.reasoning.maxRequestsPerMinute != null ? String(c.models.reasoning.maxRequestsPerMinute) : '')
        setRHasVision(c.models.reasoning.hasVision ?? false)
      }
      if (c?.models?.multimodal) {
        setMEnabled(true)
        setMEndpoint((c.models.multimodal as ModelConfig).endpoint ?? '')
        setMApiKey((c.models.multimodal as ModelConfig).apiKey ?? '')
        setMModel((c.models.multimodal as ModelConfig).defaultModel ?? (c.models.multimodal as ModelConfig).model ?? '')
      }
    })
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  const fetchModels = useCallback(async () => {
    if (!rEndpoint.trim() || !rApiKey.trim()) return
    setLoadingModels(true)
    try {
      const result = await window.electron.config.listModels({ endpoint: rEndpoint, apiKey: rApiKey })
      setModelOptions(result.success ? result.models : [])
    } catch {
      setModelOptions([])
    } finally {
      setLoadingModels(false)
    }
  }, [rEndpoint, rApiKey])

  // Refetch whenever the endpoint/key change — including after switching
  // providers via the picker above, which previously left the old
  // provider's model list showing because this effect only ran once
  // (guarded by `modelOptions.length === 0`, which was already non-empty).
  useEffect(() => {
    setModelOptions([])
    if (rEndpoint.trim() && rApiKey.trim()) {
      fetchModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rEndpoint, rApiKey])

  const handleSave = async () => {
    const base = config ?? { models: { reasoning: null } }
    setSaving(true)
    const updated: JivaConfig = {
      ...base,
      models: {
        reasoning: {
          ...base.models?.reasoning,
          provider: rProvider,
          endpoint: rEndpoint.trim() ? toChatCompletionsUrl(rEndpoint) : rEndpoint,
          apiKey: rApiKey,
          defaultModel: rModel,
          useHarmonyFormat: rHarmony,
          defaultMaxTokens: rMaxTokens.trim() ? Number(rMaxTokens) : undefined,
          maxRequestsPerMinute: rRateLimit.trim() ? Number(rRateLimit) : undefined,
          hasVision: rHasVision,
        },
        multimodal: mEnabled
          ? { endpoint: mEndpoint.trim() ? toChatCompletionsUrl(mEndpoint) : mEndpoint, apiKey: mApiKey, defaultModel: mModel }
          : undefined,
      },
    }
    await window.electron.config.write(updated)
    setConfig(updated)
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
      {/* Quick Provider Setup */}
      <section>
        <button
          onClick={() => setShowProviderPicker((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border transition-all duration-150 text-left hover:border-[rgba(139,92,246,0.4)] hover:bg-[rgba(139,92,246,0.03)]"
          style={{ borderColor: 'var(--card-border)', background: 'var(--bg-secondary)' }}
        >
          <Zap size={14} className="text-[var(--accent)] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-[var(--text)]">Change Provider</span>
            {rProvider && !showProviderPicker && (
              <span
                className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full inline-block"
                style={{
                  background: 'rgba(139,92,246,0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(139,92,246,0.2)',
                  verticalAlign: 'middle',
                }}
              >
                {rProvider}
              </span>
            )}
          </div>
          {showProviderPicker ? (
            <ChevronUp size={14} className="text-[var(--text-subtle)] flex-shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-[var(--text-subtle)] flex-shrink-0" />
          )}
        </button>

        {showProviderPicker && (
          <div
            className="mt-2 p-4 rounded-xl border"
            style={{ borderColor: 'var(--card-border)', background: 'var(--bg-secondary)' }}
          >
            <ModelSetupStep
              onConfigured={() => {
                setShowProviderPicker(false)
                loadConfig()
              }}
              onSkip={() => setShowProviderPicker(false)}
            />
          </div>
        )}
      </section>

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
            <label style={labelStyle}>
              <span className="flex items-center justify-between">
                <span>Model Name</span>
                <button
                  type="button"
                  onClick={fetchModels}
                  disabled={loadingModels || !rEndpoint.trim() || !rApiKey.trim()}
                  className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  <RefreshCw size={9} className={loadingModels ? 'animate-spin' : ''} />
                  {modelOptions.length > 0 ? 'Refresh models' : 'Fetch models'}
                </button>
              </span>
            </label>
            <input
              style={inputStyle}
              list="reasoning-model-options"
              value={rModel}
              onChange={(e) => setRModel(e.target.value)}
              placeholder="Meta-Llama-3.1-405B-Instruct"
            />
            <datalist id="reasoning-model-options">
              {modelOptions.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Max output tokens (optional)</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={rMaxTokens}
                onChange={(e) => setRMaxTokens(e.target.value)}
                placeholder="e.g. 4096 for Sarvam"
              />
            </div>
            <div>
              <label style={labelStyle}>Rate limit — requests/min (optional)</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={rRateLimit}
                onChange={(e) => setRRateLimit(e.target.value)}
                placeholder="e.g. 40 for Sarvam"
              />
            </div>
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
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasVision"
              checked={rHasVision}
              onChange={(e) => setRHasVision(e.target.checked)}
              className="accent-purple-500"
            />
            <label htmlFor="hasVision" className="text-xs text-[var(--text-muted)] cursor-pointer">
              This model supports vision (image input) natively
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
