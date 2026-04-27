export interface CodeLogEvent {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  tag: string
  message: string
}

export interface GitFile {
  status: string
  file: string
}

import type { PersonaInfo } from './persona'
import type { JivaRunResult } from './jiva'

export interface MCPServerStatus {
  name: string
  enabled: boolean
  connected: boolean
  toolCount: number
  command: string
  args: string[]
  env: Record<string, string>
  url?: string
  type: 'stdio' | 'http'
  error?: string
}

export interface MCPTool {
  name: string
  description: string
}

export interface MCPServerConfig {
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
}

interface ElectronAPI {
  jiva: {
    startServer: () => Promise<{ success: boolean; status?: string; error?: string }>
    stopServer: () => Promise<{ success: boolean }>
    restartServer: () => Promise<{ success: boolean; status?: string; error?: string }>
    getStatus: () => Promise<{ status: string; port: number }>
    onStatusChange: (callback: (status: string, data?: unknown) => void) => void
    sendMessage: (
      prompt: string,
      persona?: string
    ) => Promise<{ success: boolean; result?: JivaRunResult; conversationId?: string; error?: string }>
    stopMessage: () => Promise<{ success: boolean }>
    onPhaseUpdate: (callback: (phase: string) => void) => void
    resetConversation: () => Promise<{ success: boolean }>
    loadConversation: (id: string) => Promise<{ success: boolean; error?: string }>
  }
  config: {
    read: () => Promise<unknown>
    write: (config: unknown) => Promise<boolean>
  }
  personas: {
    list: () => Promise<PersonaInfo[]>
    activate: (name: string) => Promise<{ success: boolean }>
  }
  conversations: {
    list: () => Promise<Array<{ id: string; summary: string; messageCount: number; lastModified: number; type: 'chat' | 'code' }>>
    load: (id: string) => Promise<unknown>
  }
  mcp: {
    listStatus: () => Promise<MCPServerStatus[]>
    getTools: () => Promise<Record<string, MCPTool[]>>
    addServer: (name: string, config: MCPServerConfig) => Promise<{ success: boolean; error?: string }>
    removeServer: (name: string) => Promise<{ success: boolean; error?: string }>
    toggleServer: (name: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
    reconnectServer: (name: string) => Promise<{ success: boolean; error?: string }>
  }
  workspace: {
    getDir: () => Promise<string>
    setDir: (dir: string) => Promise<{ success: boolean; error?: string }>
    pickDir: () => Promise<string | null>
    listFiles: (dirPath: string) => Promise<Array<{
      name: string
      path: string
      isDirectory: boolean
      size: number
      modified: number
    }>>
    readFile: (filePath: string) => Promise<string | null>
    openExternal: (filePath: string) => Promise<void>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  code: {
    sendMessage: (prompt: string) => Promise<{ success: boolean; content?: string; toolsUsed?: string[]; iterations?: number; error?: string }>
    stopMessage: () => Promise<{ success: boolean }>
    resetSession: () => Promise<{ success: boolean; error?: string }>
    init: (dir: string) => Promise<{ success: boolean; error?: string }>
    onCodeLog: (cb: (event: CodeLogEvent) => void) => void
  }
  git: {
    isRepo: (dir: string) => Promise<boolean>
    status: (dir: string) => Promise<GitFile[]>
    diffFile: (dir: string, file: string, status?: string) => Promise<string | null>
    initRepo: (dir: string) => Promise<{ success: boolean; error?: string }>
    branchInfo: (dir: string) => Promise<{ branch: string; ahead: number; behind: number } | null>
  }
  directive: {
    get: () => Promise<string>
    set: (content: string) => Promise<{ success: boolean }>
  }
  onNativeThemeChanged: (callback: (isDark: boolean) => void) => void
  setup: {
    check: () => Promise<{
      nodejs:   { ok: boolean; version?: string }
      jivaCore: { ok: boolean; version?: string }
      config:   { ok: boolean; path: string }
      platform: string
    }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
