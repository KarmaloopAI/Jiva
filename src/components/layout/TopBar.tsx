import { Settings, Sun, Moon, Users, RefreshCw, PanelLeft } from 'lucide-react'
import { NavTab } from './NavTab'
import { Button } from '../ui/Button'
import { useSettingsStore } from '../../store/settings.store'
import { useJivaStore } from '../../store/jiva.store'
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
  const { connectionStatus, serverStatus } = useJivaStore()

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
      />
      <span className="hidden sm:inline">
        {isConnected ? 'Connected' : isStarting ? 'Starting...' : isError ? 'Error' : 'Offline'}
      </span>
    </div>
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
        <StatusDot />

        <Button variant="icon" size="sm" title="Restart Jiva" onClick={() => restartServer()}>
          <RefreshCw size={15} />
        </Button>

        <Button variant="icon" size="sm" title="Personas" onClick={onPersonasToggle}>
          <Users size={16} />
        </Button>

        <Button variant="icon" size="sm" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </Button>

        <Button variant="icon" size="sm" title="Settings" onClick={onSettingsToggle}>
          <Settings size={16} />
        </Button>
      </div>
    </header>
  )
}
