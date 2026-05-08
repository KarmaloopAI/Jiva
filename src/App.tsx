import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X } from 'lucide-react'
import { AppShell } from './components/layout/AppShell'
import { SetupScreen } from './components/setup/SetupScreen'
import { CloudSignIn } from './components/setup/CloudSignIn'
import { useJivaStore } from './store/jiva.store'
import { usePersonaStore } from './store/persona.store'
import { useSettingsStore } from './store/settings.store'
import { useAuthStore } from './store/auth.store'
import { logoUrl } from './lib/logo'

type SetupChecks = {
  nodejs:   { ok: boolean; version?: string }
  jivaCore: { ok: boolean; version?: string }
  config:   { ok: boolean; path: string }
  platform: string
  jivaVersionMismatch?: boolean
  requiredJivaVersion?: string
}

export type ActiveTab = 'chat' | 'cowork' | 'code' | 'files'

function SplashScreen({ status }: { status: string }) {
  const { lastError } = useJivaStore()
  const messages: Record<string, string> = {
    stopped: 'Initializing Jivam...',
    starting: 'Starting Jivam...',
    initializing: 'Loading models and tools...',
    error: 'Failed to start — check settings',
    running: 'Ready!',
  }
  const message = messages[status] ?? 'Loading...'

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="aurora-bg" />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))' }}
        >
          <img src={logoUrl} alt="Jivam" className="w-12 h-12 object-contain" />
        </motion.div>

        <div className="text-center">
          <h1 className="text-2xl font-semibold gradient-text mb-2">Jivam</h1>
          <p className="text-sm text-[var(--text-muted)]">{message}</p>
          {status === 'error' && lastError && (
            <p className="text-xs text-red-400 mt-2 max-w-xs">{lastError}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </motion.div>
  )
}

function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.electron?.updater) return
    window.electron.updater.onAvailable((info) => setUpdateInfo(info))
    window.electron.updater.onReady(() => setUpdateReady(true))
  }, [])

  if (dismissed || (!updateInfo && !updateReady)) return null

  return (
    <motion.div
      initial={{ y: -48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -48, opacity: 0 }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
      style={{
        background: 'linear-gradient(90deg, rgba(139,92,246,0.18), rgba(59,130,246,0.14))',
        borderBottom: '1px solid rgba(139,92,246,0.25)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        <Download size={13} className="text-[var(--accent)]" />
        {updateReady
          ? <span>Update downloaded — restart to install v{updateInfo?.version ?? ''}</span>
          : <span>Jivam v{updateInfo?.version} is available</span>
        }
      </div>
      <div className="flex items-center gap-2">
        {updateReady ? (
          <button
            onClick={async () => {
              setInstalling(true)
              await window.electron.updater.install()
            }}
            disabled={installing}
            className="text-xs font-medium px-3 py-1 rounded-md bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {installing ? 'Installing…' : 'Restart & Install'}
          </button>
        ) : (
          <button
            onClick={async () => {
              await window.electron.updater.install()
            }}
            className="text-xs font-medium px-3 py-1 rounded-md bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 transition-colors"
          >
            Download
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
        >
          <X size={13} />
        </button>
      </div>
    </motion.div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat')
  const [showSplash, setShowSplash] = useState(true)
  // null = pre-flight check in progress, false = setup needed, true = ready to start
  const [setupDone, setSetupDone] = useState<boolean | null>(window.electron ? null : true)
  const [setupChecks, setSetupChecks] = useState<SetupChecks | null>(null)
  const { startServer, serverStatus, setServerStatus, initPhaseListener, initJivaLogListener } = useJivaStore()
  const { loadPersonas } = usePersonaStore()
  const { theme, setTheme } = useSettingsStore()
  const { isCloudMode, cloudUser, restoreSession } = useAuthStore()

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for native theme changes from Electron
  useEffect(() => {
    if (window.electron?.onNativeThemeChanged) {
      window.electron.onNativeThemeChanged((isDark) => {
        const stored = localStorage.getItem('jivam-theme')
        if (!stored) setTheme(isDark ? 'dark' : 'light')
      })
    }

    // Listen for runner status changes from main process
    if (window.electron?.jiva?.onStatusChange) {
      window.electron.jiva.onStatusChange((status, data) => {
        if (status === 'running') setServerStatus('running')
        else if (status === 'stopped') setServerStatus('stopped')
        else if (status === 'error') {
          setServerStatus('error')
          const errorData = data as { error?: string } | undefined
          if (errorData?.error) {
            useJivaStore.getState().setLastError(errorData.error)
          }
        }
      })
    }

    // Register phase update listener (once)
    initPhaseListener()
    initJivaLogListener()
  }, [setTheme, setServerStatus, initPhaseListener, initJivaLogListener])

  // Restore cloud session from localStorage (before preflight)
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  // Pre-flight check — runs once on mount (Electron only), skipped in cloud mode
  useEffect(() => {
    if (!window.electron) return
    if (isCloudMode) {
      // Cloud mode: skip local checks, go straight to app
      setSetupDone(true)
      return
    }
    window.electron.setup.check().then((checks) => {
      setSetupChecks(checks)
      if (checks.nodejs.ok && checks.jivaCore.ok && checks.config.ok) {
        setSetupDone(true)
      } else {
        setSetupDone(false)
      }
    })
  }, [isCloudMode])

  // Initialize Jiva SDK — only after pre-flight passes (skipped in cloud mode)
  useEffect(() => {
    if (!setupDone) return

    const init = async () => {
      try {
        if (!isCloudMode) {
          await startServer()
        }
      } catch (err) {
        console.error('[App] Failed to initialize Jiva:', err)
      } finally {
        setShowSplash(false)
      }
    }

    if (window.electron) {
      init()
    } else {
      setShowSplash(false)
    }
  }, [setupDone, startServer, isCloudMode])

  // Load personas once app is ready
  useEffect(() => {
    if (!showSplash && window.electron) {
      loadPersonas()
    }
  }, [showSplash, loadPersonas])

  // Pre-flight still running — show blank background to avoid flash
  if (setupDone === null) {
    return <div className="fixed inset-0" style={{ background: 'var(--bg)' }}><div className="aurora-bg" /></div>
  }

  // Pre-flight failed — show setup screen
  if (!setupDone) {
    return <SetupScreen checks={setupChecks} onContinue={() => setSetupDone(true)} />
  }

  // Cloud window with no authenticated user → show full-window sign-in
  // Note: keep this guard even during loading (CloudSignIn handles its own spinner)
  if (isCloudMode && !cloudUser) {
    return (
      <>
        <div className="aurora-bg" />
        <CloudSignIn onSuccess={() => {}} onBack={() => { window.close() }} />
      </>
    )
  }

  return (
    <>
      <div className="aurora-bg" />

      <AnimatePresence>
        <UpdateBanner key="update-banner" />
      </AnimatePresence>

      <AnimatePresence>
        {showSplash && <SplashScreen status={serverStatus} />}
      </AnimatePresence>

      {!showSplash && (
        <AppShell activeTab={activeTab} onTabChange={setActiveTab} />
      )}
    </>
  )
}

export default App
