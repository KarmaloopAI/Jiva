import { useState } from 'react'
import { Settings, Sun, Moon, Users, RefreshCw, PanelLeft, Cloud, LogOut } from 'lucide-react'
import { NavTab } from './NavTab'
import { Button } from '../ui/Button'
import { useSettingsStore } from '../../store/settings.store'
import { useJivaStore } from '../../store/jiva.store'
import { useAuthStore } from '../../store/auth.store'
import { logoUrl } from '../../lib/logo'
import type { ActiveTab } from '../../App'

interface TopBarProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  onPersonasToggle: () => void
  onSettingsToggle: () => void
  onSidebarToggle: () => void
  sidebarCollapsed: boolean
}

function StatusDot() {
  const { connectionStatus, serverStatus, lastError } = useJivaStore()

  const isConnected = connectionStatus === 'connected'
  const isStarting = serverStatus === 'starting' || connectionStatus === 'connecting'
  const isError = serverStatus === 'error' || connectionStatus === 'error'

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full glass-card text-xs text-[var(--text-muted)]">
      <span
        className={`w-2 h-2 rounded-full ${
          isConnected
            ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
            : isStarting
            ? 'bg-amber-400 animate-pulse'
            : isError
            ? 'bg-red-500'
            : 'bg-gray-400'
        }`}
        title={lastError ?? undefined}
      />
      <span className="hidden sm:inline">
        {isConnected ? 'Connected' : isStarting ? 'Starting...' : isError ? (lastError ?? 'Error') : 'Offline'}
      </span>
    </div>
  )
}

function CloudPopover() {
  const { isCloudMode, cloudUser, signOut } = useAuthStore()
  const [open, setOpen] = useState(false)

  if (isCloudMode) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
          style={{
            background: open ? 'rgba(139,92,246,0.18)' : 'rgba(139,92,246,0.1)',
            border: '1px solid rgba(139,92,246,0.3)',
            color: 'var(--accent)',
          }}
          title={cloudUser?.email}
        >
          <Cloud size={11} />
          Cloud
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="absolute right-0 top-full mt-2 z-50 rounded-xl border py-1.5 shadow-xl min-w-[180px]"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              {cloudUser?.email && (
                <div className="px-3 py-1.5 text-xs text-[var(--text-subtle)] border-b border-[var(--border)] mb-1">
                  {cloudUser.email}
                </div>
              )}
              <button
                onClick={() => { signOut(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
              >
                <LogOut size={12} />
                Switch to local
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Local mode — clicking the cloud button directly opens the cloud window
  return (
    <Button
      variant="icon"
      size="sm"
      title="Open Jiva Cloud"
      onClick={() => window.electron?.cloud?.openWindow()}
    >
      <Cloud size={15} />
    </Button>
  )
}

export function TopBar({
  activeTab,
  onTabChange,
  onPersonasToggle,
  onSettingsToggle,
  onSidebarToggle,
  sidebarCollapsed,
}: TopBarProps) {
  const { theme, toggleTheme } = useSettingsStore()
  const { restartServer } = useJivaStore()
  const { isCloudMode } = useAuthStore()

  return (
    <header
      className="drag-region flex items-center h-14 px-4 border-b"
      style={{
        background: 'var(--topbar-bg)',
        borderColor: 'var(--topbar-border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* macOS traffic lights space */}
      <div className="w-16 flex-shrink-0" />

      {/* Sidebar toggle */}
      <Button
        variant="icon"
        size="sm"
        title={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
        onClick={onSidebarToggle}
        className="no-drag mr-2"
        style={{
          color: sidebarCollapsed ? 'var(--text-muted)' : 'var(--accent)',
        }}
      >
        <PanelLeft size={16} />
      </Button>

      {/* Logo */}
      <div className="flex items-center gap-2 mr-6 no-drag">
        <img src={logoUrl} alt="Jivam" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-[var(--text)] text-sm gradient-text">Jivam</span>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1 no-drag">
        <NavTab id="chat" label="Chat" isActive={activeTab === 'chat'} onClick={onTabChange} />
        <NavTab id="files" label="Files" isActive={activeTab === 'files'} onClick={onTabChange} />
        <NavTab id="cowork" label="Cowork" isActive={activeTab === 'cowork'} comingSoon onClick={onTabChange} />
        <NavTab id="code" label="Code" isActive={activeTab === 'code'} onClick={onTabChange} />
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right Controls */}
      <div className="flex items-center gap-2 no-drag">
        {!isCloudMode && <StatusDot />}
        {!isCloudMode && (
          <Button variant="icon" size="sm" title="Restart Jivam" onClick={() => restartServer()}>
            <RefreshCw size={15} />
          </Button>
        )}
        {!isCloudMode && (
          <Button variant="icon" size="sm" title="Personas" onClick={onPersonasToggle}>
            <Users size={16} />
          </Button>
        )}

        <Button variant="icon" size="sm" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </Button>

        {!isCloudMode && (
          <Button variant="icon" size="sm" title="Settings" onClick={onSettingsToggle}>
            <Settings size={16} />
          </Button>
        )}

        <CloudPopover />
      </div>
    </header>
  )
}
