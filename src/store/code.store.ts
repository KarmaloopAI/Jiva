import { create } from 'zustand'
import type { CodeLogEvent } from '../types/electron'

// Map jiva-core log messages to user-friendly rotating action labels
function logToAction(message: string): string | null {
  if (message.startsWith('Tool: read_file'))      return 'Reading files...'
  if (message.startsWith('Tool: write_file'))     return 'Writing file...'
  if (message.startsWith('Tool: edit_file'))      return 'Editing file...'
  if (message.startsWith('Tool: glob'))           return 'Searching files...'
  if (message.startsWith('Tool: grep'))           return 'Searching content...'
  if (message.startsWith('Tool: bash'))           return 'Running command...'
  if (message.startsWith('Tool: spawn_code_agent')) return 'Delegating to sub-agent...'
  if (message.includes('Nearing iteration limit')) return 'Wrapping up...'
  if (message.includes('Final phase'))            return 'Finalizing...'
  if (message.includes('Repaired tool call'))     return 'Retrying...'
  if (message.startsWith('Tool:'))                return `Running ${message.slice(6).trim()}...`
  return null
}

// Determine if a log event should surface as a visible event card
function isImportantEvent(event: CodeLogEvent): boolean {
  if (event.level === 'warn' || event.level === 'error') return true
  if (event.message.startsWith('Tool: edit_file')) return true
  if (event.message.startsWith('Tool: write_file')) return true
  if (event.message.startsWith('Tool: bash')) return true
  return false
}

function eventLabel(event: CodeLogEvent): string {
  const msg = event.message
  if (msg.startsWith('Tool: edit_file'))  return 'Edited file'
  if (msg.startsWith('Tool: write_file')) return 'Created file'
  if (msg.startsWith('Tool: bash'))       return 'Ran command'
  if (msg.includes('Doom loop'))          return `Doom loop: ${msg.split('tool: ')[1] ?? 'tool'}`
  if (msg.includes('Nearing iteration'))  return 'Nearing iteration limit'
  if (msg.includes('Final phase'))        return 'Final phase — wrapping up'
  // Truncate long error messages
  const clean = msg.replace(/^Model error:\s+/, '').replace(/^API Error Response.*?:\s+/, '')
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean
}

export interface CodeEvent {
  id: string
  type: 'tool' | 'warn' | 'error'
  detail: string
  timestamp: string
}

export interface CodeMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  events?: CodeEvent[]
}

interface CodeStore {
  isThinking: boolean
  thinkingStartTime: number | null
  currentAction: string | null

  pendingEvents: CodeEvent[]   // events accumulating for the current turn
  messages: CodeMessage[]

  // Session management
  isSessionStarted: boolean
  codeWorkspaceDir: string | null
  startSession: (dir: string) => Promise<{ success: boolean; error?: string }>
  loadConversation: (id: string) => Promise<void>

  sendMessage: (content: string) => Promise<void>
  initLogListener: () => void
  clearSession: () => Promise<void>
}

let logListenerRegistered = false

export const useCodeStore = create<CodeStore>((set, get) => ({
  isThinking: false,
  thinkingStartTime: null,
  currentAction: null,
  pendingEvents: [],
  messages: [],

  isSessionStarted: false,
  codeWorkspaceDir: null,

  initLogListener: () => {
    if (logListenerRegistered || !window.electron?.code?.onCodeLog) return
    logListenerRegistered = true

    window.electron.code.onCodeLog((event: CodeLogEvent) => {
      // Always update the rotating action label
      const action = logToAction(event.message)
      if (action) {
        set({ currentAction: action })
      }

      // Accumulate important events for the current turn's event list
      if (isImportantEvent(event)) {
        const entry: CodeEvent = {
          id: `${Date.now()}-${Math.random()}`,
          type: event.level === 'info' ? 'tool' : event.level,
          detail: eventLabel(event),
          timestamp: event.timestamp,
        }
        set(state => ({ pendingEvents: [...state.pendingEvents, entry] }))
      }
    })
  },

  startSession: async (dir: string) => {
    const result = await window.electron.code.init(dir)
    if (result.success) {
      set({ isSessionStarted: true, codeWorkspaceDir: dir })
    }
    return result
  },

  sendMessage: async (content: string) => {
    const userMsg: CodeMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    }

    set(state => ({
      messages: [...state.messages, userMsg],
      isThinking: true,
      thinkingStartTime: Date.now(),
      currentAction: 'Thinking...',
      pendingEvents: [],
    }))

    try {
      const response = await window.electron.code.sendMessage(content)

      const turnEvents = get().pendingEvents

      const agentMsg: CodeMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: response.success && response.content
          ? response.content
          : response.error ?? 'An error occurred.',
        timestamp: new Date(),
        events: turnEvents.length > 0 ? turnEvents : undefined,
      }

      set(state => ({
        messages: [...state.messages, agentMsg],
        isThinking: false,
        thinkingStartTime: null,
        currentAction: null,
        pendingEvents: [],
      }))
    } catch (err) {
      const agentMsg: CodeMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: err instanceof Error ? err.message : 'An error occurred.',
        timestamp: new Date(),
        events: get().pendingEvents,
      }

      set(state => ({
        messages: [...state.messages, agentMsg],
        isThinking: false,
        thinkingStartTime: null,
        currentAction: null,
        pendingEvents: [],
      }))
    }
  },

  loadConversation: async (id: string) => {
    const raw = await window.electron.conversations.load(id) as {
      metadata?: { workspace?: string }
      messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
    } | null

    if (!raw) return

    const workspace = raw.metadata?.workspace ?? null
    const messages: CodeMessage[] = (raw.messages ?? []).map((m, i) => {
      const content = typeof m.content === 'string'
        ? m.content
        : (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text!)
            .join('\n') || ''
      return {
        id: `loaded-${i}`,
        role: m.role === 'user' ? 'user' : 'agent',
        content,
        timestamp: new Date(),
      }
    })

    // Reset agent and init at the stored workspace so the user can continue
    try { await window.electron.code.resetSession() } catch { /* ignore */ }
    if (workspace) {
      await window.electron.code.init(workspace)
    }

    set({
      messages,
      isThinking: false,
      thinkingStartTime: null,
      currentAction: null,
      pendingEvents: [],
      isSessionStarted: true,
      codeWorkspaceDir: workspace,
    })
  },

  clearSession: async () => {
    // Tear down the underlying CodeRunner so next init starts clean
    try {
      await window.electron.code.resetSession()
    } catch { /* ignore — runner may already be stopped */ }
    set({
      messages: [],
      isThinking: false,
      thinkingStartTime: null,
      currentAction: null,
      pendingEvents: [],
      isSessionStarted: false,
      codeWorkspaceDir: null,
    })
  },
}))
