import { useEffect } from 'react'
import { MessageSquare, Terminal, Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConversationStore } from '../../store/conversation.store'
import { useChatStore } from '../../store/chat.store'
import { useCodeStore } from '../../store/code.store'
import type { ActiveTab } from '../../App'

function formatRelativeDate(ts: number): string {
  const now = Date.now()
  const diffMs = now - ts
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <= 7) return 'This Week'
  if (diffDays <= 30) return 'This Month'
  return 'Older'
}

function formatConversationTime(ts: number, group: string): string {
  const d = new Date(ts)
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (group === 'Today') return timeStr
  if (group === 'Yesterday') return `Yesterday ${timeStr}`
  if (group === 'This Week') return `${d.toLocaleDateString([], { weekday: 'short' })} ${timeStr}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface GroupedConversations {
  label: string
  items: { id: string; title: string; messageCount: number; lastModified: number; type: 'chat' | 'code' }[]
}

function groupByDate(
  convs: { id: string; title: string; messageCount: number; lastModified: number; type: 'chat' | 'code' }[]
): GroupedConversations[] {
  const order = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older']
  const map: Record<string, GroupedConversations['items']> = {}

  for (const conv of convs) {
    const label = formatRelativeDate(conv.lastModified)
    if (!map[label]) map[label] = []
    map[label].push(conv)
  }

  return order.filter((l) => map[l]).map((l) => ({ label: l, items: map[l] }))
}

interface ConversationSidebarProps {
  isCollapsed: boolean
  width: number
  activeTab: ActiveTab
}

export function ConversationSidebar({ isCollapsed, width, activeTab }: ConversationSidebarProps) {
  const { conversations, activeConversationId, isLoading, loadConversationList, startNewConversation, switchToConversation } =
    useConversationStore()
  const { conversationId } = useChatStore()
  const { clearSession: clearCodeSession, loadConversation: loadCodeConversation } = useCodeStore()

  const isCodeMode = activeTab === 'code'

  // Load conversations on mount and whenever active conversation changes (new convs appear)
  useEffect(() => {
    loadConversationList()
  }, [loadConversationList])

  // Refresh list when a new conversation is saved (conversationId changes)
  useEffect(() => {
    if (conversationId) {
      useConversationStore.getState().setActiveConversationId(conversationId)
      loadConversationList()
    }
  }, [conversationId, loadConversationList])

  // Filter by the active mode: code tab shows code conversations, everything else shows chat
  const filtered = conversations.filter((c) =>
    isCodeMode ? c.type === 'code' : c.type !== 'code'
  )
  const groups = groupByDate(filtered)

  return (
    <AnimatePresence initial={false}>
      {!isCollapsed && (
        <motion.aside
          key="sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="flex-shrink-0 h-full flex flex-col overflow-hidden"
          style={{
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--card-border)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {/* New conversation button */}
          <div className="px-3 py-3 flex-shrink-0">
            {isCodeMode ? (
              <button
                onClick={() => clearCodeSession()}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.10))',
                  border: '1px solid rgba(59,130,246,0.25)',
                  color: 'var(--accent-blue)',
                }}
              >
                <Plus size={15} />
                New Code Session
              </button>
            ) : (
              <button
                onClick={startNewConversation}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.10))',
                  border: '1px solid rgba(139,92,246,0.25)',
                  color: 'var(--accent)',
                }}
              >
                <Plus size={15} />
                New Chat
              </button>
            )}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
            {isLoading && conversations.length === 0 && (
              <div className="text-center py-8 text-xs text-[var(--text-subtle)]">Loading...</div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="text-center py-8 px-3">
                {isCodeMode
                  ? <Terminal size={24} className="mx-auto mb-2 text-[var(--text-subtle)] opacity-40" />
                  : <MessageSquare size={24} className="mx-auto mb-2 text-[var(--text-subtle)] opacity-40" />
                }
                <p className="text-xs text-[var(--text-subtle)]">
                  {isCodeMode ? 'No code sessions yet' : 'No conversations yet'}
                </p>
              </div>
            )}

            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-2 mb-1">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((conv) => {
                    const isActive =
                      conv.id === activeConversationId || conv.id === conversationId
                    const isCode = conv.type === 'code'
                    return (
                      <button
                        key={conv.id}
                        onClick={() => isCode ? loadCodeConversation(conv.id) : switchToConversation(conv.id)}
                        className="w-full text-left px-3 py-2 rounded-lg transition-all group"
                        style={{
                          background: isActive
                            ? 'rgba(139,92,246,0.12)'
                            : 'transparent',
                          border: isActive
                            ? '1px solid rgba(139,92,246,0.2)'
                            : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <p
                          className="text-xs font-medium truncate"
                          style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
                        >
                          {conv.title}
                        </p>
                        <p className="text-[10px] text-[var(--text-subtle)] mt-0.5 flex items-center gap-1">
                          <span>{conv.messageCount} msgs</span>
                          <span>·</span>
                          <span>{formatConversationTime(conv.lastModified, group.label)}</span>
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
