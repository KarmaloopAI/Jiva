import { create } from 'zustand'
import type { ServerStatus, ConnectionStatus, JivaRunResult } from '../types/jiva'
import { useChatStore } from './chat.store'

interface JivaStore {
  lastPlan: { subtasks: string[]; reasoning?: string } | null;
  setLastPlan: (plan: { subtasks: string[]; reasoning?: string } | null) => void;
  serverStatus: ServerStatus
  connectionStatus: ConnectionStatus
  currentPhase: string | null
  lastError: string | null

  setServerStatus: (status: ServerStatus) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setLastError: (error: string | null) => void
  setCurrentPhase: (phase: string | null) => void

  startServer: () => Promise<{ success: boolean; error?: string }>
  stopServer: () => Promise<void>
  restartServer: () => Promise<{ success: boolean; error?: string }>

  sendMessage: (content: string, persona?: string) => Promise<JivaRunResult>

  initPhaseListener: () => void
}

let phaseListenerRegistered = false

export const useJivaStore = create<JivaStore>((set) => ({
  serverStatus: 'stopped',
  connectionStatus: 'disconnected',
  currentPhase: null,
  lastError: null,
  lastPlan: null,

  setServerStatus: (status) => set({ serverStatus: status }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLastError: (error) => set({ lastError: error }),
    setCurrentPhase: (phase) => set({ currentPhase: phase }),
    setLastPlan: (plan) => set({ lastPlan: plan }),

    // Register the global phase update listener once (called from App.tsx on mount)
  initPhaseListener: () => {
    if (phaseListenerRegistered || !window.electron?.jiva?.onPhaseUpdate) return
    phaseListenerRegistered = true
    window.electron.jiva.onPhaseUpdate((phase: string) => {
      useJivaStore.getState().setCurrentPhase(phase === 'done' ? null : phase)
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
    set({ currentPhase: 'planning' })

    const response = await window.electron.jiva.sendMessage(content, persona)

    set({ currentPhase: null })

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get response from Jiva')
    }

    // Ensure we have a result object
    if (!response.result) {
      throw new Error('Jiva response missing result')
    }

    // Store the conversation ID so the sidebar can track active conversation
    if (response.conversationId) {
      useChatStore.getState().setConversationId(response.conversationId)
    }

    // Save the plan for UI display (plan may be null)
    useJivaStore.getState().setLastPlan(response.result.plan ?? null)
    return response.result as JivaRunResult
  },
}))
