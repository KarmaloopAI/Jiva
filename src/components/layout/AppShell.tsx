import { useState } from 'react'
import { TopBar } from './TopBar'
import { ConversationSidebar } from './ConversationSidebar'
import { PersonaSidebar } from '../personas/PersonaSidebar'
import { SettingsPage } from '../settings/SettingsPage'
import { ChatPage } from '../../pages/ChatPage'
import { CoworkPage } from '../../pages/CoworkPage'
import { CodePage } from '../../pages/CodePage'
import { FilesPage } from '../../pages/FilesPage'
import { ResizeHandle } from '../ui/ResizeHandle'
import type { ActiveTab } from '../../App'

interface AppShellProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
}

export function AppShell({ activeTab, onTabChange }: AppShellProps) {
  const [personaOpen, setPersonaOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)

  return (
    <div className="flex flex-col h-full relative z-10">
      <TopBar
        activeTab={activeTab}
        onTabChange={onTabChange}
        onPersonasToggle={() => setPersonaOpen((v) => !v)}
        onSettingsToggle={() => setSettingsOpen((v) => !v)}
        onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
        sidebarCollapsed={sidebarCollapsed}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Persistent Conversation Sidebar */}
        <ConversationSidebar isCollapsed={sidebarCollapsed} width={sidebarWidth} />
        {!sidebarCollapsed && (
          <ResizeHandle
            onResize={(delta) =>
              setSidebarWidth((w) => Math.min(400, Math.max(160, w + delta)))
            }
          />
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-hidden relative">
          {/* Persona Sidebar (overlay) */}
          <PersonaSidebar
            isOpen={personaOpen}
            onClose={() => setPersonaOpen(false)}
          />

          {activeTab === 'chat' && <ChatPage />}
          {activeTab === 'cowork' && <CoworkPage />}
          {activeTab === 'code' && <CodePage />}
          {activeTab === 'files' && <FilesPage />}
        </main>

        {/* Settings full-screen overlay */}
        {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
      </div>
    </div>
  )
}
