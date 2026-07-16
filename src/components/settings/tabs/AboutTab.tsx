import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { logoUrl } from '../../../lib/logo'
import { useUpdaterStore } from '../../../store/updater.store'

export function AboutTab() {
  const [version, setVersion] = useState<string>('…')
  const { phase, latestVersion, checkForUpdate, openModal } = useUpdaterStore()
  const [justChecked, setJustChecked] = useState(false)
  const wasCheckingRef = useRef(false)

  useEffect(() => {
    window.electron?.app?.getVersion().then(setVersion).catch(() => {})
  }, [])

  // "Up to date" flashes briefly right after a check that found nothing —
  // detected by watching for a checking → idle transition, since 'idle' is
  // also the resting state the rest of the time.
  useEffect(() => {
    if (phase === 'checking') {
      wasCheckingRef.current = true
    } else if (phase === 'idle' && wasCheckingRef.current) {
      wasCheckingRef.current = false
      setJustChecked(true)
      setTimeout(() => setJustChecked(false), 4000)
    }
  }, [phase])

  const handleCheckUpdates = useCallback(() => {
    checkForUpdate()
  }, [checkForUpdate])

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
        {phase === 'available' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={openModal}
            className="flex items-center gap-2 min-w-[160px] justify-center"
            style={{ borderColor: 'var(--accent)' }}
          >
            <RefreshCw size={13} className="text-[var(--accent)]" /> Update to v{latestVersion}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCheckUpdates}
            disabled={phase === 'checking'}
            className="flex items-center gap-2 min-w-[160px] justify-center"
          >
            {phase === 'checking' ? (
              <><Loader2 size={13} className="animate-spin" /> Checking…</>
            ) : justChecked ? (
              <><CheckCircle2 size={13} className="text-green-500" /> Up to date</>
            ) : (
              <><RefreshCw size={13} /> Check for Updates</>
            )}
          </Button>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-[var(--text-subtle)] mt-auto">
        © 2025 Karmaloop AI
      </p>
    </div>
  )
}
