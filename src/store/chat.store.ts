import { create } from 'zustand'
import type { ChatMessage, AttachedFile } from '../types/chat'
import type { AgentWork } from '../types/jiva'

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

interface ChatStore {
  messages: ChatMessage[]
  isThinking: boolean
  thinkingStartTime: number | null
  activePersonaName: string | null
  conversationId: string | null

  addUserMessage: (content: string, attachments?: AttachedFile[]) => string
  setThinking: (thinking: boolean) => void
  addAgentResponse: (content: string, agentWork: AgentWork, durationMs?: number, brainCommentary?: string[]) => void
  addErrorMessage: (errorMsg: string) => void
  toggleWorkPanel: (messageId: string) => void
  clearConversation: () => void
  setActivePersona: (name: string | null) => void
  loadMessages: (messages: ChatMessage[]) => void
  setConversationId: (id: string | null) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isThinking: false,
  thinkingStartTime: null,
  activePersonaName: 'chat',
  conversationId: null,

  addUserMessage: (content, attachments) => {
    const id = generateId()
    const msg: ChatMessage = {
      id,
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'complete',
      attachments: attachments?.length ? attachments : undefined,
    }
    set((s) => ({ messages: [...s.messages, msg] }))
    return id
  },

  setThinking: (thinking) => {
    set({
      isThinking: thinking,
      thinkingStartTime: thinking ? Date.now() : null,
    })
  },

  addAgentResponse: (content, agentWork, durationMs, brainCommentary) => {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'agent',
      content,
      timestamp: new Date(),
      status: 'complete',
      agentWork: { ...agentWork, durationMs },
      workExpanded: false,
      brainCommentary: brainCommentary && brainCommentary.length > 0 ? brainCommentary : undefined,
    }
    set((s) => ({
      messages: [...s.messages, msg],
      isThinking: false,
      thinkingStartTime: null,
    }))
  },

  addErrorMessage: (errorMsg) => {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'agent',
      content: `I encountered an error: ${errorMsg}`,
      timestamp: new Date(),
      status: 'error',
      errorMessage: errorMsg,
    }
    set((s) => ({
      messages: [...s.messages, msg],
      isThinking: false,
      thinkingStartTime: null,
    }))
  },

  toggleWorkPanel: (messageId) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, workExpanded: !m.workExpanded } : m
      ),
    }))
  },

  clearConversation: () => {
    set({ messages: [], isThinking: false, thinkingStartTime: null, conversationId: null })
  },

  setActivePersona: (name) => {
    set({ activePersonaName: name })
  },

  loadMessages: (messages) => {
    set({ messages })
  },

  setConversationId: (id) => {
    set({ conversationId: id })
  },
}))
