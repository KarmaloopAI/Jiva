import { create } from 'zustand'
import type { ChatMessage } from '../types/chat'
import { useChatStore } from './chat.store'

export interface ConversationItem {
  id: string
  title: string
  messageCount: number
  lastModified: number
}

interface ConversationStore {
  conversations: ConversationItem[]
  activeConversationId: string | null
  isLoading: boolean

  /** Load the list of past conversations from ~/.jiva/conversations/ */
  loadConversationList: () => Promise<void>

  /** Start a brand-new conversation — reset agent + clear chat */
  startNewConversation: () => Promise<void>

  /** Switch to a past conversation — load into agent + populate chat */
  switchToConversation: (id: string) => Promise<void>

  /** Called internally when the agent completes a chat to track the active ID */
  setActiveConversationId: (id: string | null) => void
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  isLoading: false,

  loadConversationList: async () => {
    set({ isLoading: true })
    try {
      const raw = await window.electron.conversations.list() as Array<{
        id: string
        summary: string
        messageCount: number
        lastModified: number
      }>
      const conversations: ConversationItem[] = raw.map((c) => ({
        id: c.id,
        title: c.summary || 'Conversation',
        messageCount: c.messageCount,
        lastModified: c.lastModified,
      }))
      set({ conversations, isLoading: false })
    } catch (err) {
      console.error('[ConversationStore] Failed to load conversation list:', err)
      set({ isLoading: false })
    }
  },

  startNewConversation: async () => {
    try {
      // Reset the agent's conversation history
      await window.electron.jiva.resetConversation()
      // Clear the chat UI
      useChatStore.getState().clearConversation()
      set({ activeConversationId: null })
      // Refresh the list after a moment (new conversation file won't exist yet)
    } catch (err) {
      console.error('[ConversationStore] Failed to start new conversation:', err)
    }
  },

  switchToConversation: async (id: string) => {
    const { activeConversationId } = get()
    if (activeConversationId === id) return

    try {
      // 1. Load conversation into the agent (restores history for follow-ups)
      const loadResult = await window.electron.jiva.loadConversation(id)
      if (!loadResult.success) {
        console.error('[ConversationStore] Failed to load conversation into agent:', loadResult.error)
        return
      }

      // 2. Load conversation messages from file to populate the chat UI
      const raw = await window.electron.conversations.load(id) as {
        messages?: Array<{
          role: string
          content: string | Array<{ type: string; text?: string }>
          timestamp?: string
        }>
      } | null

      if (raw?.messages) {
        const chatMessages: ChatMessage[] = raw.messages
          .reduce<ChatMessage[]>((acc, m, idx) => {
            // Normalize content — may be string or array of content parts
            let content = ''
            if (typeof m.content === 'string') {
              content = m.content
            } else if (Array.isArray(m.content)) {
              content = m.content
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('')
            }
            if (!content.trim()) return acc

            const role: 'user' | 'agent' = m.role === 'user' ? 'user' : 'agent'
            const msg: ChatMessage = {
              id: `loaded_${id}_${idx}`,
              role,
              content,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
              status: 'complete',
            }
            acc.push(msg)
            return acc
          }, [])

        useChatStore.getState().loadMessages(chatMessages)
        useChatStore.getState().setConversationId(id)
      }

      set({ activeConversationId: id })
    } catch (err) {
      console.error('[ConversationStore] Failed to switch conversation:', err)
    }
  },

  setActiveConversationId: (id) => {
    set({ activeConversationId: id })
  },
}))
