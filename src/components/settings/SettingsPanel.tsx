import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sun, Moon, Server, Key, Cpu } from 'lucide-react'
import { useSettingsStore } from '../../store/settings.store'
import { Button } from '../ui/Button'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

interface JivaConfig {
  models: {
    reasoning: {
      provider?: string
      apiKey?: string
      endpoint?: string
      model?: string
    } | null
    multimodal?: unknown
  }
  mcpServers?: Record<string, {
    command: string
    args?: string[]
    env?: Record<string, string>
    enabled: boolean
  }>
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { theme, toggleTheme } = useSettingsStore()
  const [config, setConfig] = useState<JivaConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isOpen && window.electron) {
      window.electron.config.read().then((cfg) => {
        const c = cfg as JivaConfig | null
        setConfig(c)
        if (c?.models?.reasoning) {
          setApiKey(c.models.reasoning.apiKey ?? '')
          setEndpoint(c.models.reasoning.endpoint ?? '')
          setModel(c.models.reasoning.model ?? '')
        }
      })
    }
  }, [isOpen])

  const handleSave = async () => {
    if (!config || !window.electron) return
    const updated = {
      ...config,
      models: {
        ...config.models,
        reasoning: {
          ...config.models?.reasoning,
          apiKey,
          endpoint,
          model,
        },
      },
    }
    await window.electron.config.write(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const mcpEntries = Object.entries(config?.mcpServers ?? {})

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-black/20 dark:bg-black/40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: 340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute right-0 top-0 bottom-0 z-30 w-80 flex flex-col shadow-2xl"
            style={{
              background: 'var(--sidebar-bg)',
              borderLeft: '1px solid var(--card-border)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-4 border-b"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <h2 className="font-semibold text-[var(--text)] text-sm">Settings</h2>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
              {/* Theme */}
              <section>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
                  Appearance
                </h3>
                <div
                  className="flex items-center justify-between rounded-xl p-3 glass-card"
                >
                  <div className="flex items-center gap-2">
                    {theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
                    <span className="text-sm text-[var(--text)]">
                      {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
                    </span>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className="relative w-10 h-5.5 rounded-full transition-colors"
                    style={{
                      background: theme === 'dark' ? 'var(--accent)' : 'var(--bg-secondary)',
                      border: '1px solid var(--card-border)',
                      height: '22px',
                      width: '40px',
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow-sm transition-all"
                      style={{
                        width: '18px',
                        height: '18px',
                        left: theme === 'dark' ? '18px' : '2px',
                      }}
                    />
                  </button>
                </div>
              </section>

              {/* Model Config */}
              <section>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Cpu size={12} />
                  Model Configuration
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--text-muted)] mb-1 block">API Endpoint</label>
                    <input
                      type="text"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://cloud.olakrutrim.com/v1"
                      className="w-full text-sm rounded-lg px-3 py-2 outline-none transition-all"
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-muted)] mb-1 block flex items-center gap-1">
                      <Key size={11} /> API Key
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Your API key"
                      className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-muted)] mb-1 block">Model</label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Meta-Llama-3.1-405B-Instruct"
                      className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <Button variant="primary" size="sm" onClick={handleSave} className="w-full justify-center">
                    {saved ? '✓ Saved' : 'Save Changes'}
                  </Button>
                </div>
              </section>

              {/* MCP Servers */}
              {mcpEntries.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Server size={12} />
                    MCP Servers
                  </h3>
                  <div className="space-y-2">
                    {mcpEntries.map(([name, server]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded-lg px-3 py-2 glass-card"
                      >
                        <div>
                          <span className="text-sm text-[var(--text)] capitalize">{name}</span>
                          <p className="text-xs text-[var(--text-subtle)]">{server.command}</p>
                        </div>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            server.enabled ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
