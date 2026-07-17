import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { useUpdaterStore } from '../store/updater.store'
import { logoUrl } from '../lib/logo'

function PhaseIcon({ phase }: { phase: string }) {
  if (phase === 'reload-ready') {
    return (
      <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.1))' }}>
        <CheckCircle2 size={28} className="text-green-500" />
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))' }}>
        <AlertTriangle size={28} className="text-red-500" />
      </div>
    )
  }
  return (
    <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
      <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain opacity-80" />
    </div>
  )
}

export function UpdateModal() {
  const { modalOpen, phase, latestVersion, currentVersion, errorMessage, reloadCountdown, closeModal, cancelReload, applyUpdate } = useUpdaterStore()

  if (!modalOpen) return null

  const canDismiss = phase === 'error' || phase === 'available'

  const handleBackdropClick = () => {
    if (canDismiss) closeModal()
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="relative max-w-md w-full rounded-2xl p-8 text-center shadow-2xl"
          style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid rgba(139,92,246,0.25)' }}
          onClick={e => e.stopPropagation()}
        >
          {canDismiss && (
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
            >
              <X size={16} />
            </button>
          )}

          <PhaseIcon phase={phase} />

          {phase === 'available' && (
            <>
              <h2 className="text-xl font-semibold gradient-text mb-2">Update available</h2>
              <p className="text-sm text-[var(--text-muted)] mb-7 leading-relaxed">
                Jivam v{latestVersion} is ready to install{currentVersion ? ` (you're on v${currentVersion})` : ''}.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--text-muted)' }}
                >
                  Later
                </button>
                <button
                  onClick={() => applyUpdate()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Update now
                </button>
              </div>
            </>
          )}

          {phase === 'installing' && (
            <>
              <h2 className="text-xl font-semibold gradient-text mb-2">Installing update</h2>
              <p className="text-sm text-[var(--text-muted)] mb-2 leading-relaxed">
                Downloading Jivam v{latestVersion}…
              </p>
              <div className="flex items-center justify-center gap-2 text-[var(--text-subtle)] text-xs mt-4">
                <Loader2 size={14} className="animate-spin" />
                This can take a minute
              </div>
            </>
          )}

          {phase === 'reconnecting' && (
            <>
              <h2 className="text-xl font-semibold gradient-text mb-2">Restarting Jivam</h2>
              <p className="text-sm text-[var(--text-muted)] mb-2 leading-relaxed">
                The update is installed — waiting for Jivam to come back online.
              </p>
              <div className="flex items-center justify-center gap-2 text-[var(--text-subtle)] text-xs mt-4">
                <Loader2 size={14} className="animate-spin" />
                Just a moment…
              </div>
            </>
          )}

          {phase === 'reload-ready' && (
            <>
              <h2 className="text-xl font-semibold gradient-text mb-2">Update installed</h2>
              <p className="text-sm text-[var(--text-muted)] mb-7 leading-relaxed">
                Jivam {currentVersion ? `v${currentVersion} ` : ''}is back online. Reloading in {reloadCountdown}s…
              </p>
              <div className="flex gap-3">
                <button
                  onClick={cancelReload}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Reload now
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <h2 className="text-xl font-semibold mb-2 text-[var(--text)]">Update failed</h2>
              <p className="text-sm text-[var(--text-muted)] mb-7 leading-relaxed">
                {errorMessage ?? 'Something went wrong applying the update.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--text-muted)' }}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => applyUpdate()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Try again
                </button>
              </div>
            </>
          )}

          {(phase === 'idle' || phase === 'checking') && (
            <div className="flex items-center justify-center gap-2 text-[var(--text-muted)] text-sm py-4">
              <Loader2 size={16} className="animate-spin" />
              Preparing update…
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
