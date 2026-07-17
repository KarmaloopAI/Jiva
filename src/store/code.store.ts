import { create } from 'zustand'
import type { CodeLogEvent } from '../types/electron'
import { extractThinking } from '../lib/strip-thinking'
import { useGitStore } from './git.store'

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
  thinking?: string             // <think> content extracted from raw model output
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
  currentModel: string | null
  switchingModel: boolean
  setDeepRun: (value: boolean) => void
  setMaxIterations: (value: 10 | 50 | 100) => void
  switchModel: (model: string) => Promise<{ success: boolean; error?: string }>
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
  currentModel: null,
  switchingModel: false,

  setDeepRun: (value) => set({ deepRun: value }),
  setMaxIterations: (value) => set({ maxIterations: value }),

  switchModel: async (model: string) => {
    set({ switchingModel: true })
    try {
      const result = await window.electron.code.switchModel(model)
      if (result.success) set({ currentModel: model })
      return result
    } finally {
      set({ switchingModel: false })
    }
  },

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
    const deepRun = opts?.deepRun ?? true
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

      const rawContent = response.success && response.content
        ? response.content
        : response.error ?? 'An error occurred.'
      const { thinking, content: visibleContent } = extractThinking(rawContent)

      const agentMsg: CodeMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: visibleContent,
        timestamp: new Date(),
        events: toolEvents.length > 0 ? toolEvents : undefined,
        brainCommentary: brainEvents.length > 0 ? brainEvents.map(e => e.detail) : undefined,
        thinking: thinking ?? undefined,
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
    const raw = await window.electron.conversations.load(id) as {
      metadata?: { workspace?: string; mcpServers?: string[]; maxIterations?: number; harness?: string }
      messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
    } | null

    if (!raw) return

    const messages: CodeMessage[] = (raw.messages ?? []).map((m, i) => {
      const rawContent = typeof m.content === 'string'
        ? m.content
        : (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text!)
            .join('\n') || ''
      const role: 'user' | 'agent' = m.role === 'user' ? 'user' : 'agent'
      const { thinking, content } = role === 'agent' ? extractThinking(rawContent) : { thinking: null, content: rawContent }
      return {
        id: `loaded-${i}`,
        role,
        content,
        timestamp: new Date(),
        thinking: thinking ?? undefined,
      }
    })

    // Reset any live agent instance before restoring — the actual re-init
    // (with the right workspace/MCP servers/maxIterations) happens inside
    // restoreConversation, driven by the conversation's own saved metadata.
    try { await window.electron.code.resetSession() } catch { /* ignore */ }

    const result = await window.electron.code.restoreConversation(id)

    // The git panel keys off its own store's workspaceDir, which only ever
    // gets set from WorkspacePickerView when a session first starts — it
    // never heard about a restored conversation potentially pointing at a
    // different workspace. Sync it here so the git panel refreshes to match
    // whichever workspace this conversation actually restored into.
    const syncGitWorkspace = (dir: string | null) => {
      const gitStore = useGitStore.getState()
      gitStore.setWorkspaceDir(dir ?? '')
      if (dir) gitStore.checkIsRepo()
    }

    if (result.success) {
      const workspace = result.workspace ?? raw.metadata?.workspace ?? null
      set({
        messages,
        isThinking: false,
        thinkingStartTime: null,
        currentAction: null,
        pendingEvents: [],
        liveEvents: [],
        isSessionStarted: true,
        codeWorkspaceDir: workspace,
        activeMcpServers: result.mcpServers ?? [],
        maxIterations: result.maxIterations ?? 50,
        deepRun: result.harness === 'deep-run',
      })
      syncGitWorkspace(workspace)
      return
    }

    // Fallback for conversations saved before v0.3.50 (no workspace/mcpServers/
    // maxIterations/harness recorded in metadata) — best-effort restore using
    // the legacy MCP-selection sidecar file.
    const workspace = raw.metadata?.workspace ?? null
    const mcpServers = await window.electron.code.getMcpSelection(id)
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
    syncGitWorkspace(workspace)
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
      deepRun: true,
      maxIterations: 50,
      currentModel: null,
    })
  },
}))
