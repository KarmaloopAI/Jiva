import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { XCircle, Copy, Check, RefreshCw, Zap, AlertTriangle } from 'lucide-react'
import { logoUrl } from '../../lib/logo'
import { SettingsPage } from '../settings/SettingsPage'
import { ModelSetupStep } from './ModelSetupStep'

interface SetupChecks {
  nodejs:   { ok: boolean; version?: string }
  jivaCore: { ok: boolean; version?: string }
  config:   { ok: boolean; path: string }
  platform: string
  jivaVersionMismatch?: boolean
  requiredJivaVersion?: string
}

interface Props {
  checks: SetupChecks | null
  onContinue: () => void
}

// ─── CopyCommand ──────────────────────────────────────────────────────────────

function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [command])

  return (
    <div className="mt-2">
      {label && (
        <p className="text-xs text-[var(--text-subtle)] mb-1">{label}</p>
      )}
      <div className="flex items-center gap-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
        <code className="flex-1 text-xs font-mono text-[var(--text-muted)] select-all break-all">{command}</code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 flex items-center gap-1 text-xs text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors"
        >
          {copied
            ? <Check size={13} className="text-emerald-500" />
            : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  )
}

// ─── NodeInstallInstructions ──────────────────────────────────────────────────

function NodeInstallInstructions({ platform }: { platform: string }) {
  if (platform === 'win32') {
    return (
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-1">
          Open <strong>PowerShell</strong> and run:
        </p>
        <CopyCommand command="irm https://jivamai.com/install.ps1 | iex" />
      </div>
    )
  }
  if (platform === 'darwin') {
    return (
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-1">
          Open <strong>Terminal</strong> and run:
        </p>
        <CopyCommand command="curl -fsSL https://jivamai.com/install.sh | bash" />
      </div>
    )
  }
  // Linux / unknown
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)] mb-1">
        Open <strong>Terminal</strong> and run:
      </p>
      <CopyCommand command="curl -fsSL https://jivamai.com/install.sh | bash" />
    </div>
  )
}

// ─── SetupScreen ──────────────────────────────────────────────────────────────
//
// This used to be a 3-step checklist (Node.js → jiva-core → Configuration)
// that had to pass in order before you could do anything. In practice, by
// the time this screen can even load, jivam and jiva-core are already
// installed and running — that's how the user got here (see
// scripts/install.sh / install.ps1). The only thing a fresh install
// genuinely needs from the user is an API key. So Node.js/jiva-core aren't
// shown as steps to click through — they're a quiet safety net that only
// surfaces if something's actually broken (a manual/dev setup gone wrong),
// and the API key form is the main event, not buried inside a checklist row.

export function SetupScreen({ checks, onContinue }: Props) {
  const [localChecks, setLocalChecks] = useState<SetupChecks | null>(checks)
  const [checking, setChecking]       = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const platform = localChecks?.platform ?? ''
  const terminalName = platform === 'win32' ? 'PowerShell' : 'Terminal'

  const runCheck = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.electron.setup.check()
      setLocalChecks(result)
    } finally {
      setChecking(false)
    }
  }, [])

  // Sync initial prop
  useEffect(() => {
    if (checks && !localChecks) setLocalChecks(checks)
  }, [checks, localChecks])

  const nodeMissing = !!localChecks && !localChecks.nodejs.ok
  const jivaCoreMissing = !!localChecks && localChecks.nodejs.ok && !localChecks.jivaCore.ok
  const environmentBroken = nodeMissing || jivaCoreMissing

  // Auto-poll only while something's actually broken — no point polling
  // while the user is just filling in an API key.
  useEffect(() => {
    if (!environmentBroken) return
    const id = setInterval(() => { runCheck() }, 3000)
    return () => clearInterval(id)
  }, [environmentBroken, runCheck])

  return (
    <>
      <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="aurora-bg" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 w-full max-w-lg px-4"
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(59,130,246,0.12))' }}
            >
              <img src={logoUrl} alt="Jivam" className="w-12 h-12 object-contain" />
            </motion.div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold gradient-text">Welcome to Jivam</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1.5 max-w-sm mx-auto leading-relaxed">
                One quick step — connect an AI provider and you're ready to go.
              </p>
            </div>
          </div>

          {environmentBroken ? (
            <div className="rounded-2xl border border-red-400/25 bg-red-400/5 p-5 mb-6">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-red-300">
                <XCircle size={16} />
                {nodeMissing ? 'Node.js not found' : 'jiva-core not found'}
              </div>
              {nodeMissing ? (
                <NodeInstallInstructions platform={platform} />
              ) : (
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-1">
                    Open <strong>{terminalName}</strong> and run:
                  </p>
                  <CopyCommand command="npm install -g jiva-core" />
                </div>
              )}
              <button
                onClick={runCheck}
                disabled={checking}
                className="mt-4 flex items-center gap-1.5 text-xs text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
              >
                <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
                Check again
              </button>
              <p className="text-xs text-[var(--text-subtle)] mt-2">
                Checking automatically every few seconds&hellip;
              </p>
            </div>
          ) : (
            <div
              className="rounded-2xl p-6 mb-6"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 32px rgba(139,92,246,0.06)',
              }}
            >
              <ModelSetupStep
                onConfigured={onContinue}
                onSkip={() => setShowSettings(true)}
              />
            </div>
          )}

          {/* jiva-core version mismatch advisory */}
          {!environmentBroken && localChecks?.jivaVersionMismatch && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/8 px-4 py-3 mb-4 text-xs"
            >
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-amber-300/90">
                <span className="font-medium">jiva-core update recommended — </span>
                this version of Jivam was built for jiva-core v{localChecks.requiredJivaVersion}.
                You have v{localChecks.jivaCore.version}. Run{' '}
                <code className="font-mono text-amber-200">npm install -g jiva-core</code> to update.
              </div>
            </motion.div>
          )}

          {/* Cloud quick-start divider + button */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-xs text-[var(--text-subtle)]">or</span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>

          <button
            onClick={() => window.electron?.cloud?.openWindow()}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/50 px-4 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[rgba(139,92,246,0.4)] hover:bg-[rgba(139,92,246,0.06)] transition-all duration-200"
          >
            <Zap size={14} className="text-[var(--accent)]" />
            <span>
              <span className="font-medium text-[var(--text)]">Start with Cloud</span>
              <span className="ml-1.5">— no installation required</span>
            </span>
          </button>
        </motion.div>
      </div>

      {/* Settings overlay — rendered over the setup screen */}
      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
    </>
  )
}
