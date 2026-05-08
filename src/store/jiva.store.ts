import { create } from 'zustand'
import type { ServerStatus, ConnectionStatus, JivaRunResult } from '../types/jiva'
import type { CodeLogEvent } from '../types/electron'
import { useChatStore } from './chat.store'
import type { CodeEvent } from './code.store'

function jivaLogToAction(msg: string): string | null {
  // MCP tool calls use "serverName__toolName" format
  const toolMatch = /^Tool:\s+(.+)$/.exec(msg)
  if (toolMatch) {
    const tool = toolMatch[1].toLowerCase()
    if (tool.includes('read_file') || tool.includes('read_multiple')) return 'Reading file...'
    if (tool.includes('write_file') || tool.includes('edit_file') || tool.includes('create_file')) return 'Writing file...'
    if (tool.includes('search_files') || tool.includes('list_directory') || tool.includes('directory_tree')) return 'Searching files...'
    if (tool.includes('glob') || tool.includes('find')) return 'Searching files...'
    if (tool.includes('bash') || tool.includes('run_') || tool.includes('execute')) return 'Running command...'
    if (tool.includes('web_search') || tool.includes('brave') || tool.includes('search')) return 'Searching the web...'
    if (tool.includes('fetch') || tool.includes('get_page') || tool.includes('navigate')) return 'Fetching page...'
    if (tool.includes('move_file') || tool.includes('copy')) return 'Moving file...'
    return `Using tool: ${toolMatch[1].split('__').pop() ?? toolMatch[1]}`
  }
  if (/planning subtask|planning step/i.test(msg)) return 'Planning subtasks...'
  if (/executing subtask|executing step/i.test(msg)) return 'Executing subtask...'
  if (/synthesiz/i.test(msg)) return 'Synthesizing response...'
  return null
}

function jivaIsImportantEvent(event: CodeLogEvent): boolean {
  if (event.level === 'warn' || event.level === 'error') return true
  if (event.message.startsWith('Tool:')) return true
  return false
}

function jivaEventLabel(event: CodeLogEvent): string {
  const msg = event.message
  const toolMatch = /^Tool:\s+(.+)$/.exec(msg)
  if (toolMatch) {
    const tool = toolMatch[1].toLowerCase()
    if (tool.includes('read_file') || tool.includes('read_multiple')) return 'Read file'
    if (tool.includes('write_file') || tool.includes('create_file')) return 'Created file'
    if (tool.includes('edit_file')) return 'Edited file'
    if (tool.includes('bash') || tool.includes('run_') || tool.includes('execute')) return 'Ran command'
    if (tool.includes('web_search') || tool.includes('brave') || tool.includes('search')) return 'Searched the web'
    if (tool.includes('fetch') || tool.includes('get_page') || tool.includes('navigate')) return 'Fetched page'
    return `Tool: ${toolMatch[1].split('__').pop() ?? toolMatch[1]}`
  }
  const clean = msg.replace(/^Model error:\s+/, '').replace(/^API Error Response.*?:\s+/, '')
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean
}

interface JivaStore {
  lastPlan: { subtasks: string[]; reasoning?: string } | null
  setLastPlan: (plan: { subtasks: string[]; reasoning?: string } | null) => void
  serverStatus: ServerStatus
  connectionStatus: ConnectionStatus
  currentPhase: string | null
  currentAction: string | null
  liveEvents: CodeEvent[]
  lastError: string | null
  deepRun: boolean
  maxIterations: 10 | 50 | 100

  setServerStatus: (status: ServerStatus) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setLastError: (error: string | null) => void
  setCurrentPhase: (phase: string | null) => void
  setDeepRun: (value: boolean) => void
  setMaxIterations: (value: 10 | 50 | 100) => void

  startServer: () => Promise<{ success: boolean; error?: string }>
  stopServer: () => Promise<void>
  restartServer: () => Promise<{ success: boolean; error?: string }>

  sendMessage: (content: string, persona?: string) => Promise<JivaRunResult>

  initPhaseListener: () => void
  initJivaLogListener: () => void
}

let phaseListenerRegistered = false
let jivaLogListenerRegistered = false

export const useJivaStore = create<JivaStore>((set) => ({
  serverStatus: 'stopped',
  connectionStatus: 'disconnected',
  currentPhase: null,
  currentAction: null,
  liveEvents: [],
  lastError: null,
  lastPlan: null,
  deepRun: false,
  maxIterations: 50,

  setServerStatus: (status) => set({ serverStatus: status }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLastError: (error) => set({ lastError: error }),
  setCurrentPhase: (phase) => set({ currentPhase: phase }),
  setLastPlan: (plan) => set({ lastPlan: plan }),
  setDeepRun: (value) => set({ deepRun: value }),
  setMaxIterations: (value) => set({ maxIterations: value }),

  initPhaseListener: () => {
    if (phaseListenerRegistered || !window.electron?.jiva?.onPhaseUpdate) return
    phaseListenerRegistered = true
    window.electron.jiva.onPhaseUpdate((phase: string) => {
      useJivaStore.getState().setCurrentPhase(phase === 'done' ? null : phase)
    })
  },

  initJivaLogListener: () => {
    if (jivaLogListenerRegistered || !window.electron?.jiva?.onJivaLog) return
    jivaLogListenerRegistered = true
    window.electron.jiva.onJivaLog((event: CodeLogEvent) => {
      const action = jivaLogToAction(event.message)
      if (action) set({ currentAction: action })
      if (jivaIsImportantEvent(event)) {
        const codeEvent: CodeEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' : 'tool',
          detail: jivaEventLabel(event),
          timestamp: event.timestamp,
        }
        set((state) => ({ liveEvents: [...state.liveEvents, codeEvent] }))
      }
    })
  },

  startServer: async () => {
    set({ serverStatus: 'starting', lastError: null })
    const result = await window.electron.jiva.startServer()
    if (result.success) {
      set({ serverStatus: 'running', connectionStatus: 'connected' })
    } else {
      set({ serverStatus: 'error', lastError: result.error ?? 'Unknown error' })
    }
    return result
  },

  stopServer: async () => {
    await window.electron.jiva.stopServer()
    set({ serverStatus: 'stopped', connectionStatus: 'disconnected' })
  },

  restartServer: async () => {
    set({ serverStatus: 'starting', lastError: null })
    const result = await window.electron.jiva.restartServer()
    if (result.success) {
      set({ serverStatus: 'running', connectionStatus: 'connected' })
    } else {
      set({ serverStatus: 'error', lastError: result.error ?? 'Unknown error' })
    }
    return result
  },

  sendMessage: async (content, persona) => {
    set({ currentPhase: 'planning', lastPlan: null, currentAction: null, liveEvents: [] })

    const { deepRun } = useJivaStore.getState()
    const response = await window.electron.jiva.sendMessage(content, persona, { deepRun })

    set({ currentPhase: null, currentAction: null, liveEvents: [] })

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get response from Jiva')
    }

    if (!response.result) {
      throw new Error('Jiva response missing result')
    }

    if (response.conversationId) {
      useChatStore.getState().setConversationId(response.conversationId)
    }

    useJivaStore.getState().setLastPlan(response.result.plan ?? null)
    return response.result as JivaRunResult
  },
}))
