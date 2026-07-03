import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Cpu, Server, Users, Sun, Moon, FolderOpen, HardDrive, FileText, Info } from 'lucide-react'
import { ModelsTab } from './tabs/ModelsTab'
import { MCPTab } from './tabs/MCPTab'
import { PersonasTab } from './tabs/PersonasTab'
import { WorkspaceTab } from './tabs/WorkspaceTab'
import { DirectiveTab } from './tabs/DirectiveTab'
import { AboutTab } from './tabs/AboutTab'
import { useSettingsStore } from '../../store/settings.store'

type SettingsTab = 'models' | 'mcp' | 'personas' | 'workspace' | 'directive' | 'about'

interface SettingsPageProps {
  onClose: () => void
}

const TABS: Array<{
  id: SettingsTab
  label: string
  icon: React.ReactNode
  comingSoon?: boolean
}> = [
  { id: 'models', label: 'Models', icon: <Cpu size={14} /> },
  { id: 'mcp', label: 'MCPs', icon: <Server size={14} /> },
  { id: 'workspace', label: 'Workspace', icon: <HardDrive size={14} /> },
  { id: 'directive', label: 'Directive', icon: <FileText size={14} /> },
  { id: 'personas', label: 'Personas / Plugins', icon: <Users size={14} />, comingSoon: true },
  { id: 'about', label: 'About', icon: <Info size={14} /> },
]

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('models')
  const { theme, toggleTheme } = useSettingsStore()
  const [configPath, setConfigPath] = useState('~/.jivam/config.json')

  useEffect(() => {
    window.electron?.config?.getPath?.().then(p => {
      if (p) {
        // Show ~ for home directory to keep it readable
        const home = window.navigator.platform.toLowerCase().includes('win') ? '' : '~'
        const display = p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
        setConfigPath(display)
      }
    }).catch(() => {})
  }, [])

  return (
    <motion.div
      key="settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: 'spring', damping: 30, stiffness: 350 }}
      className="absolute inset-0 z-40 flex flex-col"
      style={{
        background: 'var(--bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--topbar-border)', background: 'var(--topbar-bg)' }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors no-drag"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>

        <h1 className="text-sm font-semibold text-[var(--text)]">Settings</h1>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors no-drag"
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
        </button>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-6 pt-4 pb-0 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--card-border)' }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all relative"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-1px',
                background: 'transparent',
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.comingSoon && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: 'rgba(139,92,246,0.12)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(139,92,246,0.2)',
                  }}
                >
                  Soon
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {activeTab === 'models' && <ModelsTab />}
        {activeTab === 'mcp' && <MCPTab />}
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'directive' && <DirectiveTab />}
        {activeTab === 'personas' && <PersonasTab />}
        {activeTab === 'about' && <AboutTab />}
      </div>

      {/* Config path footer */}
      <div
        className="flex items-center gap-1.5 px-6 py-2.5 flex-shrink-0 border-t text-xs"
        style={{ borderColor: 'var(--card-border)', color: 'var(--text-subtle)' }}
      >
        <FolderOpen size={11} />
        <span>Config: {configPath}</span>
      </div>
    </motion.div>
  )
}
