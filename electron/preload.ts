import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  jiva: {
    startServer: () => ipcRenderer.invoke('jiva:server:start'),
    stopServer: () => ipcRenderer.invoke('jiva:server:stop'),
    restartServer: () => ipcRenderer.invoke('jiva:server:restart'),
    getStatus: () => ipcRenderer.invoke('jiva:server:status'),
    onStatusChange: (callback: (status: string, data?: unknown) => void) => {
      ipcRenderer.on('jiva:server:status-changed', (_event, status, data) => callback(status, data))
    },
    sendMessage: (prompt: string, persona?: string) =>
      ipcRenderer.invoke('jiva:send-message', prompt, persona),
    onPhaseUpdate: (callback: (phase: string) => void) => {
      ipcRenderer.on('jiva:phase-update', (_event, phase) => callback(phase))
    },
    resetConversation: () => ipcRenderer.invoke('jiva:reset-conversation'),
    loadConversation: (id: string) => ipcRenderer.invoke('jiva:load-conversation', id),
  },
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (config: unknown) => ipcRenderer.invoke('config:write', config),
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
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  code: {
    sendMessage: (prompt: string) => ipcRenderer.invoke('code:send-message', prompt),
    init: (dir: string) => ipcRenderer.invoke('code:init', dir),
    onCodeLog: (cb: (event: unknown) => void) => {
      ipcRenderer.on('jiva:code-log', (_event, e) => cb(e))
    },
  },
  git: {
    isRepo: (dir: string) => ipcRenderer.invoke('git:is-repo', dir),
    status: (dir: string) => ipcRenderer.invoke('git:status', dir),
    diffFile: (dir: string, file: string, status?: string) => ipcRenderer.invoke('git:diff-file', dir, file, status),
    initRepo: (dir: string) => ipcRenderer.invoke('git:init-repo', dir),
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
})
