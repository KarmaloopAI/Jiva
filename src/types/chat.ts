import type { AgentWork } from './jiva'

export type MessageRole = 'user' | 'agent'
export type MessageStatus = 'sending' | 'thinking' | 'complete' | 'error'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  status: MessageStatus
  agentWork?: AgentWork
  workExpanded?: boolean
  errorMessage?: string
}
