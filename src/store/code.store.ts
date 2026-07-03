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
  if (event.message.startsWith('Tool:')) return true
  return false
}

function eventLabel(event: CodeLogEvent): string {
  const msg = event.message
  if (msg.startsWith('Tool: edit_file'))   return 'Edited file'
  if (msg.startsWith('Tool: write_file'))  return 'Created file'
  if (msg.startsWith('Tool: bash'))        return 'Ran command'
  if (msg.startsWith('Tool: read_file'))   return 'Read file'
  if (msg.startsWith('Tool: glob'))        return 'Listed files'
  if (msg.startsWith('Tool: grep'))        return 'Searched files'
  if (msg.startsWith('Tool: spawn_code_agent')) return 'Delegated to sub-agent'
  if (msg.startsWith('Tool:'))             return `Tool: ${msg.slice(6).trim().split('(')[0].trim()}`
  if (msg.includes('Doom loop'))           return `Doom loop: ${msg.split('tool: ')[1] ?? 'tool'}`
  if (msg.includes('Nearing iteration'))   return 'Nearing iteration limit'
  if (msg.includes('Final phase'))         return 'Final phase — wrapping up'
  // Truncate long error messages
  const clean = msg.replace(/^Model error:\s+/, '').replace(/^API Error Response.*?:\s+/, '')
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean
}

export interface CodeEvent {
  id: string
  type: 'tool' | 'warn' | 'error' | 'brain'
  detail: string
  timestamp: string
}

export interface CodeMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  events?: CodeEvent[]          // tool / warn / error events
  brainCommentary?: string[]    // brain thought narration (Deep Run)
  workExpanded?: boolean
}

interface CodeStore {
  isThinking: boolean
  thinkingStartTime: number | null
  currentAction: string | null

  pendingEvents: CodeEvent[]   // events accumulating for the current turn
  liveEvents: CodeEvent[]      // events shown in real-time while agent runs
  messages: CodeMessage[]

  // Session management
  isSessionStarted: boolean
  codeWorkspaceDir: string | null
  activeMcpServers: string[]
  deepRun: boolean
  maxIterations: number
  setDeepRun: (value: boolean) => void
  setMaxIterations: (value: 10 | 50 | 100) => void
  startSession: (dir: string, mcpServers?: string[], opts?: { deepRun?: boolean; maxIterations?: number }) => Promise<{ success: boolean; error?: string }>
  loadConversation: (id: string) => Promise<void>

  sendMessage: (content: string) => Promise<void>
  toggleWorkPanel: (id: string) => void
  initLogListener: () => void
  clearSession: () => Promise<void>
}

let logListenerRegistered = false

export const useCodeStore = create<CodeStore>((set, get) => ({
  isThinking: false,
  thinkingStartTime: null,
  currentAction: null,
  pendingEvents: [],
  liveEvents: [],
  messages: [],

  isSessionStarted: false,
  codeWorkspaceDir: null,
  activeMcpServers: [],
  deepRun: true,
  maxIterations: 50,

  setDeepRun: (value) => set({ deepRun: value }),
  setMaxIterations: (value) => set({ maxIterations: value }),

  toggleWorkPanel: (id) => set(state => ({
    messages: state.messages.map(m =>
      m.id === id ? { ...m, workExpanded: !m.workExpanded } : m
    ),
  })),

  initLogListener: () => {
    if (logListenerRegistered || !window.electron?.code?.onCodeLog) return
    logListenerRegistered = true

    window.electron.code.onCodeLog((event: CodeLogEvent) => {
      // Brain commentary — handle before importance filter
      if (event.tag === 'brain') {
        set({ currentAction: event.message })
        const entry: CodeEvent = {
          id: `${Date.now()}-${Math.random()}`,
          type: 'brain',
          detail: event.message,
          timestamp: event.timestamp,
        }
        set(state => ({
          pendingEvents: [...state.pendingEvents, entry],
          liveEvents: [...state.liveEvents, entry],
        }))
        return
      }

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
        set(state => ({
          pendingEvents: [...state.pendingEvents, entry],
          liveEvents: [...state.liveEvents, entry],
        }))
      }
    })
  },

  startSession: async (dir: string, mcpServers: string[] = [], opts?: { deepRun?: boolean; maxIterations?: number }) => {
    const deepRun = opts?.deepRun ?? false
    const maxIterations = opts?.maxIterations ?? 50
    const result = await window.electron.code.init(dir, mcpServers.length > 0 ? mcpServers : undefined, { deepRun, maxIterations })
    if (result.success) {
      set({ isSessionStarted: true, codeWorkspaceDir: dir, activeMcpServers: mcpServers, deepRun, maxIterations })
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
      liveEvents: [],
    }))

    try {
      const { deepRun, maxIterations } = get()

      // Build full conversation history for the brain — exclude the current user message
      // (it's already passed as the prompt argument)
      const allMessages = get().messages
      const historyMessages = allMessages.slice(0, -1)
      const conversationHistory = historyMessages.length > 0
        ? historyMessages
            .map(m => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`)
            .join('\n\n')
        : undefined

      const response = await window.electron.code.sendMessage(content, { deepRun, maxIterations, conversationHistory })

      const turnEvents = get().pendingEvents
      const brainEvents = turnEvents.filter(e => e.type === 'brain')
      const toolEvents  = turnEvents.filter(e => e.type !== 'brain')

      const agentMsg: CodeMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: response.success && response.content
          ? response.content
          : response.error ?? 'An error occurred.',
        timestamp: new Date(),
        events: toolEvents.length > 0 ? toolEvents : undefined,
        brainCommentary: brainEvents.length > 0 ? brainEvents.map(e => e.detail) : undefined,
      }

      set(state => ({
        messages: [...state.messages, agentMsg],
        isThinking: false,
        thinkingStartTime: null,
        currentAction: null,
        pendingEvents: [],
        liveEvents: [],
      }))

      // Persist MCP selection to sidecar after the first successful message
      // (the conversation file exists now and has a stable ID)
      const { activeMcpServers, messages: currentMessages } = get()
      if (activeMcpServers.length > 0 && currentMessages.length <= 2) {
        try {
          const convId = await window.electron.code.getConversationId()
          if (convId) {
            await window.electron.code.setMcpSelection(convId, activeMcpServers)
          }
        } catch { /* non-critical */ }
      }
    } catch (err) {
      const errEvents = get().pendingEvents
      const agentMsg: CodeMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: err instanceof Error ? err.message : 'An error occurred.',
        timestamp: new Date(),
        events: errEvents.filter(e => e.type !== 'brain'),
        brainCommentary: errEvents.filter(e => e.type === 'brain').map(e => e.detail),
      }

      set(state => ({
        messages: [...state.messages, agentMsg],
        isThinking: false,
        thinkingStartTime: null,
        currentAction: null,
        pendingEvents: [],
        liveEvents: [],
      }))
    }
  },

  loadConversation: async (id: string) => {
    const [raw, mcpServers] = await Promise.all([
      window.electron.conversations.load(id) as Promise<{
        metadata?: { workspace?: string }
        messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
      } | null>,
      window.electron.code.getMcpSelection(id),
    ])

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

    // Reset agent and re-init at the stored workspace with the original MCPs
    try { await window.electron.code.resetSession() } catch { /* ignore */ }
    if (workspace) {
      await window.electron.code.init(workspace, mcpServers.length > 0 ? mcpServers : undefined)
    }

    set({
      messages,
      isThinking: false,
      thinkingStartTime: null,
      currentAction: null,
      pendingEvents: [],
      liveEvents: [],
      isSessionStarted: true,
      codeWorkspaceDir: workspace,
      activeMcpServers: mcpServers,
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
      liveEvents: [],
      isSessionStarted: false,
      codeWorkspaceDir: null,
      activeMcpServers: [],
      deepRun: false,
      maxIterations: 50,
    })
  },
}))
