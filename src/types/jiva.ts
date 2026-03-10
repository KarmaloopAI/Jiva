export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AgentWork {
  plan: {
    subtasks: string[]
    reasoning?: string
  } | null
  toolsUsed: string[]
  iterations: number
  durationMs?: number
}

export interface JivaRunResult {
  content: string
  iterations: number
  toolsUsed: string[]
  plan: {
    subtasks: string[]
    reasoning?: string
  } | null
  durationMs: number
  conversationId?: string
}

export interface JivaServerStatus {
  status: ServerStatus
  port: number
  pid?: number
  error?: string
}
