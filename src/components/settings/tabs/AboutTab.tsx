import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { logoUrl } from '../../../lib/logo'

type UpdateCheckState = 'idle' | 'checking' | 'up-to-date' | 'unavailable'

export function AboutTab() {
  const [version, setVersion] = useState<string>('…')
  const [checkState, setCheckState] = useState<UpdateCheckState>('idle')

  useEffect(() => {
    window.electron?.app?.getVersion().then(setVersion).catch(() => {})
  }, [])

  // Listen for updater events so the button reflects result even if triggered elsewhere
  useEffect(() => {
    if (!window.electron?.updater) return
    window.electron.updater.onAvailable(() => setCheckState('idle')) // banner takes over
    window.electron.updater.onNotAvailable(() => {
      setCheckState('up-to-date')
      setTimeout(() => setCheckState('idle'), 4000)
    })
  }, [])

  const handleCheckUpdates = useCallback(async () => {
    setCheckState('checking')
    try {
      await window.electron.updater.check()
      // result comes via onAvailable / onNotAvailable listeners
    } catch {
      setCheckState('unavailable')
      setTimeout(() => setCheckState('idle'), 4000)
    }
  }, [])

  return (
    <div className="max-w-md mx-auto flex flex-col items-center text-center pt-8 pb-4 gap-6">
      {/* Logo + name */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))',
            border: '1px solid rgba(139,92,246,0.2)',
          }}
        >
          <img src={logoUrl} alt="Jivam" className="w-12 h-12 object-contain" />
        </div>
        <div>
          <h2 className="text-xl font-bold gradient-text">Jivam</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Desktop UI for Jiva autonomous AI</p>
        </div>
      </div>

      {/* Version */}
      <div
        className="px-4 py-2 rounded-xl text-sm"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--card-border)',
          color: 'var(--text-muted)',
        }}
      >
        Version <span className="font-mono font-semibold text-[var(--text)]">v{version}</span>
      </div>

      {/* Website */}
      <a
        href="https://jivamai.com"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline"
      >
        jivamai.com
        <ExternalLink size={13} />
      </a>

      {/* Check for updates */}
      <div className="flex flex-col items-center gap-2 w-full">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCheckUpdates}
          disabled={checkState === 'checking'}
          className="flex items-center gap-2 min-w-[160px] justify-center"
        >
          {checkState === 'checking' ? (
            <><Loader2 size={13} className="animate-spin" /> Checking…</>
          ) : checkState === 'up-to-date' ? (
            <><CheckCircle2 size={13} className="text-green-500" /> Up to date</>
          ) : (
            <><RefreshCw size={13} /> Check for Updates</>
          )}
        </Button>
        {checkState === 'unavailable' && (
          <p className="text-xs text-[var(--text-subtle)]">Not available in development mode</p>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-[var(--text-subtle)] mt-auto">
        © 2025 Karmaloop AI
      </p>
    </div>
  )
}
