import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, XCircle, Clock, Copy, Check,
  RefreshCw, ArrowRight, Loader2, Settings, Zap, AlertTriangle,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { logoUrl } from '../../lib/logo'
import { SettingsPage } from '../settings/SettingsPage'

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

type RowStatus = 'loading' | 'ok' | 'fail' | 'waiting'

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
          Open <strong>PowerShell as Administrator</strong> and run these two commands:
        </p>
        <CopyCommand
          label="Step 1 — Install Chocolatey package manager"
          command='powershell -c "irm https://community.chocolatey.org/install.ps1|iex"'
        />
        <CopyCommand
          label="Step 2 — Install Node.js"
          command='choco install nodejs --version="24.14.0"'
        />
      </div>
    )
  }
  if (platform === 'darwin') {
    return (
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-1">
          Open <strong>Terminal</strong> and run these two commands:
        </p>
        <CopyCommand
          label="Step 1 — Install Homebrew package manager"
          command='curl -o- https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash'
        />
        <CopyCommand
          label="Step 2 — Install Node.js"
          command="brew install node@24"
        />
      </div>
    )
  }
  // Linux / unknown
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)] mb-1">
        Open <strong>Terminal</strong> and run:
      </p>
      <CopyCommand
        label="Install n + Node.js 24"
        command="curl -fsSL https://raw.githubusercontent.com/mklement0/n-install/stable/bin/n-install | bash -s 24"
      />
    </div>
  )
}

// ─── CheckRow ─────────────────────────────────────────────────────────────────

function CheckRow({
  index,
  label,
  status,
  badge,
  instruction,
}: {
  index: number
  label: string
  status: RowStatus
  badge?: string
  instruction?: React.ReactNode
}) {
  const icon = {
    loading: <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />,
    ok:      <CheckCircle2 size={18} className="text-emerald-500" />,
    fail:    <XCircle size={18} className="text-red-400" />,
    waiting: <Clock size={18} className="text-[var(--text-subtle)]" />,
  }[status]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`rounded-xl border transition-colors duration-200 overflow-hidden ${
        status === 'ok'
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : status === 'fail'
          ? 'border-red-400/20 bg-red-400/5'
          : 'border-[var(--border)] bg-[var(--card)]/50'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-shrink-0">{icon}</span>
        <span
          className={`flex-1 text-sm font-medium ${
            status === 'waiting' ? 'text-[var(--text-subtle)]' : 'text-[var(--text)]'
          }`}
        >
          {label}
        </span>
        {badge && (
          <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--card)] border border-[var(--border)] rounded px-2 py-0.5">
            {badge}
          </span>
        )}
        {status === 'waiting' && (
          <span className="text-xs text-[var(--text-subtle)]">complete step {index} first</span>
        )}
      </div>

      <AnimatePresence>
        {instruction && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 pb-4"
          >
            {instruction}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── SetupScreen ──────────────────────────────────────────────────────────────

export function SetupScreen({ checks, onContinue }: Props) {
  const [localChecks, setLocalChecks] = useState<SetupChecks | null>(checks)
  const [polling, setPolling]         = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const allOk = !!(
    localChecks?.nodejs.ok &&
    localChecks?.jivaCore.ok &&
    localChecks?.config.ok
  )

  const platform = localChecks?.platform ?? ''

  const runCheck = useCallback(async () => {
    setPolling(true)
    try {
      const result = await window.electron.setup.check()
      setLocalChecks(result)
    } finally {
      setPolling(false)
    }
  }, [])

  // Sync initial prop
  useEffect(() => {
    if (checks && !localChecks) setLocalChecks(checks)
  }, [checks, localChecks])

  // Auto-poll every 3 s while any check is failing
  useEffect(() => {
    if (allOk) return
    const id = setInterval(() => { runCheck() }, 3000)
    return () => clearInterval(id)
  }, [allOk, runCheck])

  // Derive per-step status
  const nodejsStatus: RowStatus = !localChecks ? 'loading'
    : localChecks.nodejs.ok ? 'ok' : 'fail'

  const jivaCoreStatus: RowStatus = !localChecks ? 'loading'
    : !localChecks.nodejs.ok ? 'waiting'
    : localChecks.jivaCore.ok ? 'ok' : 'fail'

  const configStatus: RowStatus = !localChecks ? 'loading'
    : !localChecks.jivaCore.ok ? 'waiting'
    : localChecks.config.ok ? 'ok' : 'fail'

  const terminalName = platform === 'win32' ? 'PowerShell' : 'Terminal'

  return (
    <>
      <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="aurora-bg" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 w-full max-w-md px-4"
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))' }}
            >
              <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
            </motion.div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold gradient-text">Welcome to Jivam</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Let's make sure everything is in place before we start.
              </p>
            </div>
          </div>

          {/* Checklist */}
          <div className="flex flex-col gap-3 mb-6">

            {/* Step 1 — Node.js */}
            <CheckRow
              index={1}
              label="Node.js"
              status={nodejsStatus}
              badge={localChecks?.nodejs.version ? `v${localChecks.nodejs.version}` : undefined}
              instruction={
                nodejsStatus === 'fail'
                  ? <NodeInstallInstructions platform={platform} />
                  : undefined
              }
            />

            {/* Step 2 — jiva-core */}
            <CheckRow
              index={2}
              label="jiva-core"
              status={jivaCoreStatus}
              badge={localChecks?.jivaCore.version ? `v${localChecks.jivaCore.version}` : undefined}
              instruction={
                jivaCoreStatus === 'fail' ? (
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-1">
                      Open <strong>{terminalName}</strong> and run:
                    </p>
                    <CopyCommand command="npm install -g jiva-core" />
                    <p className="text-xs text-[var(--text-subtle)] mt-2">
                      This installs the Jivam AI engine globally. Come back when it's done — the
                      check will update automatically.
                    </p>
                  </div>
                ) : undefined
              }
            />

            {/* Step 3 — Configuration */}
            <CheckRow
              index={3}
              label="Configuration"
              status={configStatus}
              badge={configStatus === 'ok' ? 'configured' : undefined}
              instruction={
                configStatus === 'fail' ? (
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-2">
                      No API credentials found. Configure your AI model to get started:
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowSettings(true)}
                    >
                      <Settings size={13} />
                      Configure Models
                    </Button>
                    <p className="text-xs text-[var(--text-subtle)] mt-2 text-center">
                      After saving, this check will update automatically.
                    </p>
                  </div>
                ) : undefined
              }
            />
          </div>

          {/* jiva-core version mismatch advisory */}
          {allOk && localChecks?.jivaVersionMismatch && (
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

          {/* Auto-check hint */}
          {localChecks && !allOk && (
            <p className="text-xs text-center text-[var(--text-subtle)] mb-4">
              Checking automatically every few seconds&hellip;
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="md"
              className="flex-1"
              onClick={runCheck}
              disabled={polling}
            >
              <RefreshCw size={14} className={polling ? 'animate-spin' : ''} />
              Check Again
            </Button>

            <Button
              variant="primary"
              size="md"
              className="flex-1"
              disabled={!allOk}
              onClick={onContinue}
            >
              Continue
              <ArrowRight size={14} />
            </Button>
          </div>

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
