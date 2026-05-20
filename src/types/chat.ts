import type { AgentWork } from './jiva'

export type MessageRole = 'user' | 'agent'
export type MessageStatus = 'sending' | 'thinking' | 'complete' | 'error'

export interface AttachedFile {
  name: string
  category: 'text' | 'pdf' | 'docx' | 'image'
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  status: MessageStatus
  agentWork?: AgentWork
  workExpanded?: boolean
  errorMessage?: string
  attachments?: AttachedFile[]
}
