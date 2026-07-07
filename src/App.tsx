import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X, Menu as MenuIcon, ChevronRight, CheckCircle2 } from 'lucide-react'
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

// `jivam --install` opens Safari with ?installGuide=safari-dock so the page
// itself can show the Add to Dock walkthrough — see AddToDockGuide below.
// Suppress the generic InstallModal in that case; it would be redundant.
function hasInstallGuideParam(): boolean {
  return new URLSearchParams(window.location.search).get('installGuide') === 'safari-dock'
}

function InstallModal() {
  const [dismissed, setDismissed] = useState(() =>
    !!localStorage.getItem('jivam-install-modal-dismissed')
  )

  // Only show in a regular browser tab — not when already running as installed app
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  if (dismissed || isStandalone || hasInstallGuideParam()) return null

  const handleDismiss = () => {
    localStorage.setItem('jivam-install-modal-dismissed', '1')
    setDismissed(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={handleDismiss}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="relative max-w-md w-full rounded-2xl p-8 text-center shadow-2xl"
        style={{
          background: 'var(--bg-card, #1a1a2e)',
          border: '1px solid rgba(139,92,246,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
        >
          <X size={16} />
        </button>

        {/* Icon */}
        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
          <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
        </div>

        <h2 className="text-xl font-semibold gradient-text mb-2">Install Jivam as an App</h2>
        <p className="text-sm text-[var(--text-muted)] mb-6 leading-relaxed">
          Get a clean, distraction-free window with a Dock icon — no browser chrome, no address bar.
        </p>

        {/* Steps */}
        <div className="text-left space-y-3 mb-7">
          <div className="flex gap-3 items-start">
            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-xs flex items-center justify-center font-semibold">1</span>
            <p className="text-sm text-[var(--text-muted)]">
              Run <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent)' }}>jivam --install</code> in your terminal to create the app and add it to your Dock automatically.
            </p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-xs flex items-center justify-center font-semibold">2</span>
            <p className="text-sm text-[var(--text-muted)]">
              Click the <strong className="text-[var(--text)]">Jivam</strong> icon in your Dock — it starts the server and opens automatically.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDismiss}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--text-muted)' }}
          >
            Later
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all text-white"
            style={{ background: 'var(--accent)' }}
          >
            Got it
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Shown when `jivam --install` opens Safari to a plain browser tab (no
 * Accessibility permission needed, unlike scripting the File menu click
 * ourselves) — walks the user through the one manual step Safari requires:
 * clicking File > Add to Dock… themselves. `jivam --install` polls in the
 * background for the resulting app bundle to appear.
 */
// Mirrors Safari's actual File menu layout (macOS Sonoma+) so the user can
// spot "Add to Dock…" in the real menu at a glance, with the same items
// above and below it for context.
const SAFARI_FILE_MENU_ABOVE = [
  'New Window', 'New Private Window', 'New Tab', 'New Empty Tab Group',
  'New Tab Group with 2 Tabs', 'Open File…', 'Open Location…',
]
const SAFARI_FILE_MENU_BETWEEN = [
  'Close Window', 'Close All Windows', 'Close Tab', 'Delete Tab Group',
  'Save As…',
]
const SAFARI_FILE_MENU_BELOW = ['Share…', 'Export as PDF…']

function SafariFileMenuMockup() {
  return (
    <div
      className="rounded-lg overflow-hidden text-[13px] mx-auto"
      style={{ background: '#2b2b2e', border: '1px solid rgba(255,255,255,0.08)', maxWidth: 280 }}
    >
      {SAFARI_FILE_MENU_ABOVE.map(item => (
        <div key={item} className="px-3 py-[3px] text-white/70">{item}</div>
      ))}
      <div className="my-1 border-t border-white/10" />
      {SAFARI_FILE_MENU_BETWEEN.map(item => (
        <div key={item} className={`px-3 py-[3px] ${item === 'Delete Tab Group' ? 'text-white/30' : 'text-white/70'}`}>{item}</div>
      ))}
      <div className="my-1 border-t border-white/10" />
      {SAFARI_FILE_MENU_BELOW.map(item => (
        <div key={item} className="px-3 py-[3px] text-white/70">{item}</div>
      ))}

      {/* Add to Dock… — the row we're guiding the user to click */}
      <div className="relative px-1 py-1">
        <motion.div
          animate={{ boxShadow: ['0 0 0 2px rgba(139,92,246,0.4)', '0 0 0 2px rgba(139,92,246,0.9)', '0 0 0 2px rgba(139,92,246,0.4)'] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="rounded-md px-2 py-[3px] text-white font-medium"
        >
          Add to Dock…
        </motion.div>
      </div>

      <div className="my-1 border-t border-white/10" />
      <div className="px-3 py-[3px] text-white/70 flex items-center justify-between">
        <span>Import From</span>
        <ChevronRight size={12} className="text-white/40" />
      </div>
      <div className="px-3 py-[3px] text-white/70 flex items-center justify-between">
        <span>Export</span>
        <ChevronRight size={12} className="text-white/40" />
      </div>
      <div className="my-1 border-t border-white/10" />
      <div className="px-3 py-[3px] text-white/70">Print…</div>
    </div>
  )
}

function AddToDockGuide() {
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(false)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    window.electron?.onPwaInstalled?.(() => setInstalled(true))
  }, [])

  if (dismissed || isStandalone || !hasInstallGuideParam()) return null

  const handleDismiss = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('installGuide')
    window.history.replaceState({}, '', url.toString())
    setDismissed(true)
  }

  return (
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
        className="relative max-w-xl w-full rounded-2xl p-9 text-center shadow-2xl"
        style={{
          background: 'var(--bg-card, #1a1a2e)',
          border: '1px solid rgba(139,92,246,0.25)',
        }}
      >
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
        >
          <X size={18} />
        </button>

        {installed ? (
          <>
            <div className="mx-auto mb-5 w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(59,130,246,0.15))' }}>
              <CheckCircle2 size={40} style={{ color: '#22c55e' }} />
            </div>
            <h2 className="text-2xl font-semibold gradient-text mb-2">Added to your Dock!</h2>
            <p className="text-sm text-[var(--text-muted)] mb-7 leading-relaxed">
              Jivam is now a real app on your Mac. You can close this tab and launch it from the Dock from now on.
            </p>
            <button
              onClick={handleDismiss}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: 'var(--accent)' }}
            >
              Got it
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
              <img src={logoUrl} alt="Jivam" className="w-12 h-12 object-contain" />
            </div>

            <h2 className="text-2xl font-semibold gradient-text mb-2">One click to finish</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6 leading-relaxed max-w-md mx-auto">
              Add Jivam to your Dock as a real app — its own window and icon, no browser chrome.
            </p>

            <div
              className="rounded-xl p-5 mb-5 text-left"
              style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <div className="flex items-center gap-2 text-xs text-[var(--text-subtle)] mb-4 justify-center">
                <MenuIcon size={13} />
                <span>In the Safari menu bar at the top of your screen, click <strong className="text-[var(--text)]">File</strong>, then:</span>
              </div>
              <SafariFileMenuMockup />
            </div>

            <p className="text-xs text-[var(--text-subtle)] leading-relaxed">
              Safari will ask you to confirm — click <strong className="text-[var(--text)]">Add</strong> and
              this page will update automatically once Jivam appears in your Dock.
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const isMac = window.electron?.platform === 'darwin'

  useEffect(() => {
    if (!window.electron?.updater) return
    window.electron.updater.onAvailable((info) => setUpdateInfo(info))
    window.electron.updater.onProgress((pct) => setProgress(pct))
    window.electron.updater.onReady(() => {
      setProgress(null)
      setUpdateReady(true)
    })
  }, [])

  if (dismissed || (!updateInfo && !updateReady)) return null

  const isDownloading = progress !== null && !updateReady

  return (
    <motion.div
      initial={{ y: -48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -48, opacity: 0 }}
      className="fixed top-0 left-0 right-0 z-50 text-sm"
      style={{
        background: 'linear-gradient(90deg, rgba(139,92,246,0.18), rgba(59,130,246,0.14))',
        borderBottom: '1px solid rgba(139,92,246,0.25)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        className="flex items-center justify-between gap-3 py-2.5 pr-4"
        style={{ paddingLeft: isMac ? '80px' : '16px' }}
      >
        <div className="flex items-center gap-2 text-[var(--text-muted)] min-w-0">
          <Download size={13} className="text-[var(--accent)] shrink-0" />
          {updateReady ? (
            isMac
              ? <span>v{updateInfo?.version} ready — click to install</span>
              : <span>v{updateInfo?.version} ready — restart to install</span>
          ) : isDownloading ? (
            <span>Downloading v{updateInfo?.version}… {progress}%</span>
          ) : (
            <span>v{updateInfo?.version} available — downloading…</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {updateReady && (
            <button
              onClick={() => window.electron.updater.quitAndInstall()}
              className="text-xs font-medium px-3 py-1 rounded-md bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              {isMac ? 'Open in Finder' : 'Restart & Install'}
            </button>
          )}
          {!updateReady && isDownloading && (
            <div className="w-20 h-1 rounded-full overflow-hidden bg-[var(--accent)]/20">
              <motion.div
                className="h-full rounded-full bg-[var(--accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ ease: 'linear', duration: 0.3 }}
              />
            </div>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
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
  const { startServer, serverStatus, setServerStatus, setConnectionStatus, initPhaseListener, initJivaLogListener } = useJivaStore()
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
        if (isCloudMode) {
          // Cloud mode has no local server — mark as connected so the chat view renders
          setConnectionStatus('connected')
        } else {
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
        <InstallModal key="install-modal" />
        <AddToDockGuide key="add-to-dock-guide" />
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
