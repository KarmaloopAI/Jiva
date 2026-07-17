import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, FileCode2, Globe, ExternalLink, Check, Loader2 } from 'lucide-react'
import { useChatStore } from '../../store/chat.store'
import { logoUrl } from '../../lib/logo'
import type { MCPServerConfig } from '../../types/electron'

const SEEN_KEY = 'jivam-mcp-onboarding-seen'

type ServerKey = 'tavily' | 'htmlToMarkdown' | 'playwright'

const SERVER_CONFIGS: Record<ServerKey, { name: string; config: (apiKey?: string) => MCPServerConfig }> = {
  tavily: {
    name: 'tavily',
    config: (apiKey) => ({
      type: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp'],
      env: { TAVILY_API_KEY: apiKey ?? '' }, enabled: true,
    }),
  },
  htmlToMarkdown: {
    name: 'html-to-markdown',
    config: () => ({ type: 'stdio', command: 'npx', args: ['-y', 'html-to-markdown-mcp'], enabled: true }),
  },
  playwright: {
    name: 'playwright',
    config: () => ({ type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome'], enabled: true }),
  },
}

export function McpOnboardingModal() {
  const messages = useChatStore((s) => s.messages)
  const [open, setOpen] = useState(false)
  const [tavilyEnabled, setTavilyEnabled] = useState(true)
  const [htmlEnabled, setHtmlEnabled] = useState(true)
  const [playwrightEnabled, setPlaywrightEnabled] = useState(false)
  const [tavilyKey, setTavilyKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Fires once, the first time a new user's first prompt gets a completed
  // response — after they've actually seen Jivam work, not before.
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) return
    const hasCompletedAgentReply = messages.some((m) => m.role === 'agent' && m.status === 'complete')
    if (hasCompletedAgentReply) {
      localStorage.setItem(SEEN_KEY, '1')
      setOpen(true)
    }
  }, [messages])

  const dismiss = () => setOpen(false)

  const handleAdd = async () => {
    if (tavilyEnabled && !tavilyKey.trim()) {
      setError('Add your Tavily API key, or turn off Tavily Web Search.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const jobs: Array<{ key: ServerKey; apiKey?: string }> = []
      if (tavilyEnabled) jobs.push({ key: 'tavily', apiKey: tavilyKey.trim() })
      if (htmlEnabled) jobs.push({ key: 'htmlToMarkdown' })
      if (playwrightEnabled) jobs.push({ key: 'playwright' })

      for (const job of jobs) {
        const { name, config } = SERVER_CONFIGS[job.key]
        await window.electron.mcp.addServer(name, config(job.apiKey))
      }
      setDone(true)
      setTimeout(() => setOpen(false), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong adding these servers.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const anySelected = tavilyEnabled || htmlEnabled || playwrightEnabled

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="relative max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-2xl p-8 shadow-2xl"
          style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid rgba(139,92,246,0.25)' }}
        >
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 text-white/40 hover:text-white/70 transition-colors"
          >
            <X size={18} />
          </button>

          {done ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.1))' }}>
                <Check size={28} className="text-green-500" />
              </div>
              <h2 className="text-xl font-semibold gradient-text mb-2">You're all set</h2>
              <p className="text-sm text-white/60">Jivam is connecting to your new tools now.</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="mx-auto mb-4 w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
                  <img src={logoUrl} alt="Jivam" className="w-9 h-9 object-contain" />
                </div>
                <h2 className="text-xl font-semibold gradient-text mb-2">Unlock Jivam's full power</h2>
                <p className="text-sm text-white/60 leading-relaxed max-w-sm mx-auto">
                  A few MCP tools let Jivam search the web and read pages directly, instead of relying only on what it already knows.
                </p>
              </div>

              <div className="space-y-3">
                {/* Tavily */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tavilyEnabled}
                      onChange={(e) => { setTavilyEnabled(e.target.checked); setError(null) }}
                      className="mt-1 accent-purple-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Search size={13} className="text-[var(--accent)]" />
                        <span className="text-sm font-medium text-white">Tavily Web Search</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent)' }}>Recommended</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">Lets Jivam run real-time web searches to answer questions with current information.</p>
                    </div>
                  </label>
                  {tavilyEnabled && (
                    <div className="mt-3 pl-6">
                      <input
                        type="password"
                        value={tavilyKey}
                        onChange={(e) => { setTavilyKey(e.target.value); setError(null) }}
                        placeholder="Tavily API key"
                        className="w-full rounded-lg text-xs px-3 py-2 outline-none"
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                      />
                      <a
                        href="https://app.tavily.com/home"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline mt-1.5"
                      >
                        Get a free API key <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>

                {/* HTML to Markdown */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={htmlEnabled}
                      onChange={(e) => setHtmlEnabled(e.target.checked)}
                      className="mt-1 accent-purple-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <FileCode2 size={13} className="text-[var(--accent)]" />
                        <span className="text-sm font-medium text-white">HTML to Markdown</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent)' }}>Recommended</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">Turns the pages Jivam finds into clean text it can actually read and cite.</p>
                    </div>
                  </label>
                </div>

                {/* Playwright */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={playwrightEnabled}
                      onChange={(e) => setPlaywrightEnabled(e.target.checked)}
                      className="mt-1 accent-purple-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Globe size={13} className="text-white/60" />
                        <span className="text-sm font-medium text-white">Playwright + Chrome browser</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>Optional</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">Lets Jivam browse the web directly in a real Chrome window — click, scroll, fill forms.</p>
                    </div>
                  </label>
                </div>
              </div>

              {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={dismiss}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: 'rgba(139,92,246,0.12)', color: 'rgba(255,255,255,0.7)' }}
                >
                  Maybe later
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!anySelected || saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--accent)' }}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                  {saving ? 'Adding…' : 'Add selected'}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
