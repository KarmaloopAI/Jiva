import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X, Menu as MenuIcon, ChevronRight, CheckCircle2, Lock, Star, MoreHorizontal } from 'lucide-react'
import { AppShell } from './components/layout/AppShell'
import { SetupScreen } from './components/setup/SetupScreen'
import { CloudSignIn } from './components/setup/CloudSignIn'
import { useJivaStore } from './store/jiva.store'
import { usePersonaStore } from './store/persona.store'
import { useSettingsStore } from './store/settings.store'
import { useAuthStore } from './store/auth.store'
import { useUpdaterStore } from './store/updater.store'
import { UpdateModal } from './components/UpdateModal'
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

// `jivam --install` opens Safari (?installGuide=safari-dock) or Edge
// (?installGuide=edge-app) so the page itself can show the install
// walkthrough — see AddToDockGuide below. Suppress the generic InstallModal
// whenever either is present; it would be redundant.
type InstallGuideKind = 'safari-dock' | 'edge-app'

function getInstallGuideParam(): InstallGuideKind | null {
  const v = new URLSearchParams(window.location.search).get('installGuide')
  return v === 'safari-dock' || v === 'edge-app' ? v : null
}

function hasInstallGuideParam(): boolean {
  return getInstallGuideParam() !== null
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
        className="relative max-w-md w-full max-h-[90vh] overflow-y-auto rounded-2xl p-8 text-center shadow-2xl"
        style={{
          background: 'var(--bg-card, #1a1a2e)',
          border: '1px solid rgba(139,92,246,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-white/40 hover:text-white/70 transition-colors"
        >
          <X size={16} />
        </button>

        {/* Icon */}
        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
          <img src={logoUrl} alt="Jivam" className="w-10 h-10 object-contain" />
        </div>

        <h2 className="text-xl font-semibold gradient-text mb-2">Install Jivam as an App</h2>
        <p className="text-sm text-white/60 mb-6 leading-relaxed">
          Get a clean, distraction-free window with a Dock icon — no browser chrome, no address bar.
        </p>

        {/* Steps */}
        <div className="text-left space-y-3 mb-7">
          <div className="flex gap-3 items-start">
            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-xs flex items-center justify-center font-semibold">1</span>
            <p className="text-sm text-white/60">
              Run <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent)' }}>jivam --install</code> in your terminal to create the app and add it to your Dock automatically.
            </p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-xs flex items-center justify-center font-semibold">2</span>
            <p className="text-sm text-white/60">
              Click the <strong className="text-white">Jivam</strong> icon in your Dock — it starts the server and opens automatically.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDismiss}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(139,92,246,0.12)', color: 'rgba(255,255,255,0.7)' }}
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

// Mirrors Edge's address bar with its "install this site as an app" icon —
// the fastest route — plus the ⋯ menu > Apps route as a fallback for
// versions/layouts where the address-bar icon doesn't show.
function EdgeInstallMockup() {
  return (
    <div
      className="rounded-lg overflow-hidden text-[13px] mx-auto"
      style={{ background: '#2b2b2e', border: '1px solid rgba(255,255,255,0.08)', maxWidth: 320 }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md px-2.5 py-1.5"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <Lock size={11} className="text-white/40 shrink-0" />
          <span className="text-white/60 truncate text-[12px]">localhost:7842</span>
        </div>
        <motion.div
          animate={{ boxShadow: ['0 0 0 2px rgba(139,92,246,0.4)', '0 0 0 2px rgba(139,92,246,0.9)', '0 0 0 2px rgba(139,92,246,0.4)'] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: 'rgba(139,92,246,0.25)' }}
        >
          <Download size={14} className="text-white" />
        </motion.div>
        <Star size={13} className="text-white/40 shrink-0" />
        <MoreHorizontal size={14} className="text-white/40 shrink-0" />
      </div>
      <div className="my-1 border-t border-white/10" />
      <div className="px-3 py-2 text-white/50 text-[11px] leading-relaxed">
        Don't see it? Click <strong className="text-white/70">⋯</strong> (top right) →{' '}
        <strong className="text-white/70">Apps</strong> →{' '}
        <strong className="text-white/70">Install this site as an app</strong>
      </div>
    </div>
  )
}

const INSTALL_GUIDE_COPY: Record<InstallGuideKind, {
  destination: string
  successBody: string
  menuIntro: React.ReactNode
  confirmBody: React.ReactNode
}> = {
  'safari-dock': {
    destination: 'Dock',
    successBody: "Jivam is now a real app on your Mac. You can close this tab and launch it from the Dock from now on.",
    menuIntro: (
      <>In the Safari menu bar at the top of your screen, click <strong className="text-white">File</strong>, then:</>
    ),
    confirmBody: (
      <>Safari will ask you to confirm — click <strong className="text-white">Add</strong> and
        this page will update automatically once Jivam appears in your Dock.</>
    ),
  },
  'edge-app': {
    destination: 'Start Menu',
    successBody: "Jivam is now a real app on your PC. You can close this tab and launch it from the Start Menu or Desktop from now on.",
    menuIntro: (
      <>In Edge's address bar, click the install icon:</>
    ),
    confirmBody: (
      <>Edge will ask you to confirm — click <strong className="text-white">Install</strong> and
        this page will update automatically once Jivam is installed.</>
    ),
  },
}

function AddToDockGuide() {
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [platform, setPlatform] = useState<string | null>(null)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  const urlGuideKind = getInstallGuideParam()

  useEffect(() => {
    window.electron?.onPwaInstalled?.(() => setInstalled(true))
  }, [])

  // The URL param (set server-side by `jivam --install`/openAppWindow, both
  // of which branch on process.platform) should already be correct, but
  // cross-check against the platform the server itself reports once that
  // resolves — so a stale/incorrect param can never show Safari's File-menu
  // walkthrough on Windows, or Edge's install-icon walkthrough on macOS.
  useEffect(() => {
    fetch('/api/platform').then(r => r.json()).then(setPlatform).catch(() => {})
  }, [])

  const guideKind: InstallGuideKind | null =
    platform === 'win32' ? 'edge-app' :
    platform === 'darwin' ? 'safari-dock' :
    urlGuideKind

  if (dismissed || isStandalone || !guideKind) return null
  const copy = INSTALL_GUIDE_COPY[guideKind]

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
        className="relative max-w-xl w-full max-h-[90vh] overflow-y-auto rounded-2xl p-9 text-center shadow-2xl"
        style={{
          background: 'var(--bg-card, #1a1a2e)',
          border: '1px solid rgba(139,92,246,0.25)',
        }}
      >
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-white/40 hover:text-white/70 transition-colors"
        >
          <X size={18} />
        </button>

        {installed ? (
          <>
            <div className="mx-auto mb-5 w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(59,130,246,0.15))' }}>
              <CheckCircle2 size={40} style={{ color: '#22c55e' }} />
            </div>
            <h2 className="text-2xl font-semibold gradient-text mb-2">Added to your {copy.destination}!</h2>
            <p className="text-sm text-white/60 mb-7 leading-relaxed">
              {copy.successBody}
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
            <p className="text-sm text-white/60 mb-6 leading-relaxed max-w-md mx-auto">
              Install Jivam as a real app — its own window and icon, no browser chrome.
            </p>

            <div
              className="rounded-xl p-5 mb-5 text-left"
              style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <div className="flex items-center gap-2 text-xs text-white/50 mb-4 justify-center">
                <MenuIcon size={13} />
                <span>{copy.menuIntro}</span>
              </div>
              {guideKind === 'safari-dock' ? <SafariFileMenuMockup /> : <EdgeInstallMockup />}
            </div>

            <p className="text-xs text-white/50 leading-relaxed">
              {copy.confirmBody}
            </p>
          </>
        )}
      </motion.div>
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
    useUpdaterStore.getState().init()
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

  // AddToDockGuide is driven by a URL param set by `jivam --install` and has
  // nothing to do with setup/splash/cloud-signin state — it needs to render
  // no matter which of those screens is up, otherwise a first-run user stuck
  // on setup would never see it (see the branches below).
  let body: React.ReactNode

  if (setupDone === null) {
    // Pre-flight still running — show blank background to avoid flash
    body = <div className="fixed inset-0" style={{ background: 'var(--bg)' }}><div className="aurora-bg" /></div>
  } else if (!setupDone) {
    // Pre-flight failed — show setup screen
    body = <SetupScreen checks={setupChecks} onContinue={() => setSetupDone(true)} />
  } else if (isCloudMode && !cloudUser) {
    // Cloud window with no authenticated user → show full-window sign-in
    // Note: keep this guard even during loading (CloudSignIn handles its own spinner)
    body = (
      <>
        <div className="aurora-bg" />
        <CloudSignIn onSuccess={() => {}} onBack={() => { window.close() }} />
      </>
    )
  } else {
    body = (
      <>
        <div className="aurora-bg" />

        <AnimatePresence>
          <InstallModal key="install-modal" />
        </AnimatePresence>
        <UpdateModal />

        <AnimatePresence>
          {showSplash && <SplashScreen status={serverStatus} />}
        </AnimatePresence>

        {!showSplash && (
          <AppShell activeTab={activeTab} onTabChange={setActiveTab} />
        )}
      </>
    )
  }

  return (
    <>
      {body}
      <AnimatePresence>
        <AddToDockGuide key="add-to-dock-guide" />
      </AnimatePresence>
    </>
  )
}

export default App
