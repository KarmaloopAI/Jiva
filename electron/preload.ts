import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
  },
  jiva: {
    startServer: () => ipcRenderer.invoke('jiva:server:start'),
    stopServer: () => ipcRenderer.invoke('jiva:server:stop'),
    restartServer: () => ipcRenderer.invoke('jiva:server:restart'),
    getStatus: () => ipcRenderer.invoke('jiva:server:status'),
    onStatusChange: (callback: (status: string, data?: unknown) => void) => {
      ipcRenderer.on('jiva:server:status-changed', (_event, status, data) => callback(status, data))
    },
    sendMessage: (prompt: string, persona?: string, opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }) =>
      ipcRenderer.invoke('jiva:send-message', prompt, persona, opts),
    stopMessage: () => ipcRenderer.invoke('jiva:stop-message'),
    onPhaseUpdate: (callback: (phase: string) => void) => {
      ipcRenderer.on('jiva:phase-update', (_event, phase) => callback(phase))
    },
    onJivaLog: (callback: (event: unknown) => void) => {
      ipcRenderer.on('jiva:jiva-log', (_event, e) => callback(e))
    },
    resetConversation: () => ipcRenderer.invoke('jiva:reset-conversation'),
    loadConversation: (id: string) => ipcRenderer.invoke('jiva:load-conversation', id),
  },
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (config: unknown) => ipcRenderer.invoke('config:write', config),
    getPath: () => ipcRenderer.invoke('config:get-path'),
    setupProvider: (args: {
      provider: 'sarvam' | 'krutrim' | 'groq' | 'openai-compatible'
      apiKey: string
      customEndpoint?: string
      customModel?: string
    }) => ipcRenderer.invoke('config:setup-provider', args),
  },
  personas: {
    list: () => ipcRenderer.invoke('personas:list'),
    activate: (name: string) => ipcRenderer.invoke('personas:activate', name),
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    load: (id: string) => ipcRenderer.invoke('conversations:load', id),
  },
  mcp: {
    listStatus: () => ipcRenderer.invoke('mcp:list-status'),
    getTools: () => ipcRenderer.invoke('mcp:get-tools'),
    addServer: (name: string, config: unknown) => ipcRenderer.invoke('mcp:add-server', name, config),
    removeServer: (name: string) => ipcRenderer.invoke('mcp:remove-server', name),
    toggleServer: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle-server', name, enabled),
    reconnectServer: (name: string) => ipcRenderer.invoke('mcp:reconnect-server', name),
  },
  workspace: {
    getDir: () => ipcRenderer.invoke('workspace:get-dir'),
    setDir: (dir: string) => ipcRenderer.invoke('workspace:set-dir', dir),
    pickDir: () => ipcRenderer.invoke('workspace:pick-dir'),
    listFiles: (dirPath: string) => ipcRenderer.invoke('workspace:list-files', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath),
    openExternal: (filePath: string) => ipcRenderer.invoke('workspace:open-external', filePath),
  },
  files: {
    pick: (includeImages: boolean) => ipcRenderer.invoke('file:pick-attachments', includeImages),
    convert: (filePath: string) => ipcRenderer.invoke('file:convert-attachment', filePath),
    describeImage: (dataUri: string) => ipcRenderer.invoke('file:describe-image', dataUri),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  code: {
    sendMessage: (prompt: string, opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }) => ipcRenderer.invoke('code:send-message', prompt, opts),
    stopMessage: () => ipcRenderer.invoke('code:stop-message'),
    resetSession: () => ipcRenderer.invoke('code:reset-session'),
    init: (dir: string, mcpServers?: string[], opts?: { deepRun?: boolean; maxIterations?: number }) => ipcRenderer.invoke('code:init', dir, mcpServers, opts),
    listMcpForCode: () => ipcRenderer.invoke('code:list-mcp-for-code'),
    getConversationId: () => ipcRenderer.invoke('code:get-conversation-id'),
    getMcpSelection: (convId: string) => ipcRenderer.invoke('code:get-mcp-selection', convId),
    setMcpSelection: (convId: string, servers: string[]) => ipcRenderer.invoke('code:set-mcp-selection', convId, servers),
    onCodeLog: (cb: (event: unknown) => void) => {
      ipcRenderer.on('jiva:code-log', (_event, e) => cb(e))
    },
  },
  git: {
    isRepo: (dir: string) => ipcRenderer.invoke('git:is-repo', dir),
    status: (dir: string) => ipcRenderer.invoke('git:status', dir),
    diffFile: (dir: string, file: string, status?: string) => ipcRenderer.invoke('git:diff-file', dir, file, status),
    initRepo: (dir: string) => ipcRenderer.invoke('git:init-repo', dir),
    branchInfo: (dir: string) => ipcRenderer.invoke('git:branch-info', dir),
  },
  directive: {
    get: () => ipcRenderer.invoke('directive:get'),
    set: (content: string) => ipcRenderer.invoke('directive:set', content),
  },
  onNativeThemeChanged: (callback: (isDark: boolean) => void) => {
    ipcRenderer.on('native-theme-changed', (_event, isDark) => callback(isDark))
  },
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
  },
  platform: process.platform,
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
    onAvailable: (cb: (info: { version: string; releaseNotes: string | null }) => void) => {
      ipcRenderer.on('updater:available', (_event, info) => cb(info))
    },
    onProgress: (cb: (percent: number) => void) => {
      ipcRenderer.on('updater:progress', (_event, pct) => cb(pct))
    },
    onReady: (cb: () => void) => {
      ipcRenderer.on('updater:ready', () => cb())
    },
    onNotAvailable: (cb: () => void) => {
      ipcRenderer.on('updater:not-available', () => cb())
    },
  },
  cloud: {
    openWindow: () => ipcRenderer.invoke('cloud:open-window'),
    signIn: (email: string, password: string) => ipcRenderer.invoke('cloud:sign-in', email, password),
    signUp: (email: string, password: string) => ipcRenderer.invoke('cloud:sign-up', email, password),
    signOut: () => ipcRenderer.invoke('cloud:sign-out'),
    init: (userId: string, sessionId: string) => ipcRenderer.invoke('cloud:init', userId, sessionId),
  },
})
