import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, ArrowLeft, ArrowRight, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '../ui/Button'

type ProviderKey = 'sarvam' | 'krutrim' | 'groq' | 'together' | 'openai-compatible'

interface ProviderInfo {
  key: ProviderKey
  name: string
  tagline: string
  badges: string[]
  apiKeyUrl: string
  hasVision: boolean
}

const PROVIDERS: ProviderInfo[] = [
  {
    key: 'sarvam',
    name: 'Sarvam',
    tagline: 'Frontier AI, made in India',
    badges: ['Indian provider', 'Reasoning model'],
    apiKeyUrl: 'https://dashboard.sarvam.ai/',
    hasVision: false,
  },
  {
    key: 'krutrim',
    name: 'Krutrim',
    tagline: 'Powerful reasoning + vision',
    badges: ['Indian provider', 'Reasoning + Vision'],
    apiKeyUrl: 'https://cloud.olakrutrim.com/',
    hasVision: true,
  },
  {
    key: 'groq',
    name: 'Groq',
    tagline: 'Ultra-fast inference',
    badges: ['Reasoning + Vision'],
    apiKeyUrl: 'https://console.groq.com/keys',
    hasVision: true,
  },
  {
    key: 'together',
    name: 'Together AI',
    tagline: 'Open models, including reasoning/thinking models',
    badges: ['Reasoning model'],
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    hasVision: false,
  },
]

interface Props {
  onConfigured: () => void
  onSkip: () => void
}

export function ModelSetupStep({ onConfigured, onSkip }: Props) {
  const [step, setStep] = useState<'pick' | 'key'>('pick')
  const [selected, setSelected] = useState<ProviderInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleProviderSelect = (p: ProviderInfo) => {
    setSelected(p)
    setApiKey('')
    setError(null)
    setStep('key')
  }

  const handleBack = () => {
    setStep('pick')
    setError(null)
  }

  const handleSave = async () => {
    if (!selected || !apiKey.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.electron.config.setupProvider({
        provider: selected.key,
        apiKey: apiKey.trim(),
      })
      if (result.success) {
        onConfigured()
      } else {
        setError(result.error ?? 'Failed to save configuration')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence mode="wait">
      {step === 'pick' ? (
        <motion.div
          key="pick"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Choose your AI provider to get started:
          </p>

          <div className="flex flex-col gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                onClick={() => handleProviderSelect(p)}
                className="group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 hover:border-[rgba(139,92,246,0.4)] hover:bg-[rgba(139,92,246,0.05)]"
                style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
              >
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold"
                  style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--accent)' }}
                >
                  {p.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{p.name}</span>
                    {p.badges.map((b) => (
                      <span
                        key={b}
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          background: 'rgba(139,92,246,0.1)',
                          color: 'var(--accent)',
                          border: '1px solid rgba(139,92,246,0.2)',
                        }}
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{p.tagline}</p>
                </div>
                <ArrowRight
                  size={14}
                  className="flex-shrink-0 text-[var(--text-subtle)] group-hover:text-[var(--accent)] transition-colors"
                />
              </button>
            ))}
          </div>

          <button
            onClick={onSkip}
            className="mt-3 w-full text-xs text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors py-1"
          >
            Advanced setup (custom endpoint)
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="key"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {/* Provider name + model badge */}
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--accent)' }}
            >
              {selected!.name[0]}
            </div>
            <span className="text-sm font-semibold text-[var(--text)]">{selected!.name}</span>
            {selected!.hasVision && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'rgba(139,92,246,0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(139,92,246,0.2)',
                }}
              >
                Reasoning + Vision will be configured
              </span>
            )}
          </div>

          {/* API key input */}
          <div className="mb-3">
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Paste your {selected!.name} API key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apiKey.trim() && handleSave()}
                placeholder="sk-..."
                autoFocus
                className="w-full rounded-lg pr-9 text-sm"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--text)',
                  padding: '8px 12px',
                  outline: 'none',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <a
              href={selected!.apiKeyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              Get {selected!.name} API key
              <ExternalLink size={10} />
            </a>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 mb-3">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBack} disabled={saving}>
              <ArrowLeft size={13} />
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
            >
              {saving ? (
                <><Loader2 size={13} className="animate-spin" /> Saving...</>
              ) : (
                <><CheckCircle2 size={13} /> Save &amp; Continue</>
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
