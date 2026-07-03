/**
 * Browser-side shim that exposes the same window.electron API surface,
 * implemented via fetch + WebSocket to the local Jivam server.
 */

const API = '/api'

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json() as Promise<T>
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = params
    ? `${API}${path}?${new URLSearchParams(params)}`
    : `${API}${path}`
  const res = await fetch(url)
  return res.json() as Promise<T>
}

// --- WebSocket event bus ---
type EventCallback = (...args: unknown[]) => void
const listeners = new Map<string, Set<EventCallback>>()

function on(type: string, cb: EventCallback) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(cb)
}

function emit(type: string, ...args: unknown[]) {
  listeners.get(type)?.forEach(cb => cb(...args))
}

function connectWS() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`)

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as { type: string; [key: string]: unknown }
      const { type, ...rest } = msg
      emit(type, rest)
    } catch {}
  }

  ws.onclose = () => {
    // Reconnect after a brief delay
    setTimeout(connectWS, 2000)
  }
}

connectWS()

// --- File picker helper (browser native → upload to server) ---
async function pickAndUploadFiles(includeImages: boolean): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    const imageExts = '.png,.jpg,.jpeg,.gif,.webp,.bmp'
    const docExts = '.pdf,.docx'
    const textExts = '.txt,.md,.markdown,.rst,.log,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.cc,.h,.hpp,.cs,.css,.scss,.sass,.less,.html,.htm,.xml,.svg,.json,.jsonc,.yaml,.yml,.toml,.ini,.cfg,.conf,.sh,.bash,.zsh,.ps1,.bat,.sql,.graphql,.proto,.vue,.svelte,.astro'
    input.accept = includeImages
      ? `${imageExts},${docExts},${textExts}`
      : `${docExts},${textExts}`

    input.onchange = async () => {
      if (!input.files?.length) return resolve([])
      const files = Array.from(input.files)
      const encoded = await Promise.all(files.map(async f => {
        const buf = await f.arrayBuffer()
        const data = btoa(String.fromCharCode(...new Uint8Array(buf)))
        return { name: f.name, data, mimeType: f.type }
      }))
      const results = await post<Array<{ name: string; category: string; markdown: string; mimeType?: string; error?: string }>>(
        '/files/upload-and-convert', { files: encoded }
      )
      // Store results by a synthetic key for files.convert() to retrieve
      results.forEach(r => uploadedFiles.set(r.name, r))
      resolve(results.map(r => `__uploaded__${r.name}`))
    }

    input.click()
  })
}

// Temporary store for files uploaded via the browser picker
const uploadedFiles = new Map<string, { name: string; category: string; markdown: string; mimeType?: string; error?: string }>()

// --- The shim object (same shape as ElectronAPI) ---
const electronShim = {
  platform: 'web',

  jiva: {
    startServer: () => post<{ success: boolean; status?: string; error?: string }>('/jiva/start'),
    stopServer: () => post<{ success: boolean }>('/jiva/stop'),
    restartServer: () => post<{ success: boolean; status?: string; error?: string }>('/jiva/restart'),
    getStatus: () => get<{ status: string; port: number }>('/jiva/status'),
    onStatusChange: (cb: (status: string, data?: unknown) => void) => {
      on('jiva:server:status-changed', (msg: unknown) => { const { status, data } = msg as Record<string, unknown>; cb(status as string, data) })
    },
    sendMessage: (prompt: string, _persona?: string, opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }) =>
      post('/jiva/send-message', { prompt, opts }),
    stopMessage: () => post('/jiva/stop-message'),
    onPhaseUpdate: (cb: (phase: string) => void) => {
      on('jiva:phase-update', (msg: unknown) => cb((msg as Record<string, unknown>).phase as string))
    },
    onJivaLog: (cb: (event: unknown) => void) => {
      on('jiva:jiva-log', (msg: unknown) => cb((msg as Record<string, unknown>).event))
    },
    resetConversation: () => post('/jiva/reset-conversation'),
    loadConversation: (id: string) => post('/jiva/load-conversation', { id }),
  },

  config: {
    read: () => get('/config'),
    write: (config: unknown) => post('/config', config),
    getPath: () => get<string>('/config/path'),
    setupProvider: (args: { provider: 'sarvam' | 'krutrim' | 'groq' | 'openai-compatible'; apiKey: string; customEndpoint?: string; customModel?: string }) =>
      post<{ success: boolean; error?: string }>('/config/setup-provider', args),
  },

  app: {
    getVersion: () => get<string>('/version'),
  },

  personas: {
    list: () => get('/personas'),
    activate: (name: string) => post('/personas/activate', { name }),
  },

  conversations: {
    list: () => get('/conversations'),
    load: (id: string) => get(`/conversations/${id}`),
  },

  mcp: {
    listStatus: () => get('/mcp/status'),
    getTools: () => get('/mcp/tools'),
    addServer: (name: string, config: unknown) => post('/mcp/add', { name, config }),
    removeServer: (name: string) => post('/mcp/remove', { name }),
    toggleServer: (name: string, enabled: boolean) => post('/mcp/toggle', { name, enabled }),
    reconnectServer: (name: string) => post('/mcp/reconnect', { name }),
  },

  workspace: {
    getDir: () => get<string>('/workspace/dir'),
    setDir: (dir: string) => post('/workspace/dir', { dir }),
    pickDir: () => post<string | null>('/workspace/pick-dir'),
    listFiles: (dirPath: string) => get('/workspace/files', { path: dirPath }),
    readFile: (filePath: string) => get('/workspace/file', { path: filePath }),
    openExternal: (filePath: string) => post('/workspace/open-external', { filePath }),
  },

  files: {
    pick: (includeImages: boolean) => pickAndUploadFiles(includeImages),
    convert: (filePath: string) => {
      if (filePath.startsWith('__uploaded__')) {
        const name = filePath.replace('__uploaded__', '')
        const cached = uploadedFiles.get(name)
        if (cached) return Promise.resolve(cached)
      }
      return post('/files/convert', { filePath })
    },
    describeImage: (dataUri: string) => post('/files/describe-image', { dataUri }),
  },

  window: {
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    close: () => { window.close(); return Promise.resolve() },
    isMaximized: () => Promise.resolve(false),
  },

  code: {
    sendMessage: (prompt: string, opts?: { deepRun?: boolean }) => post('/code/send-message', { prompt, opts }),
    stopMessage: () => post('/code/stop-message'),
    resetSession: () => post('/code/reset-session'),
    init: (dir: string, mcpServers?: string[], opts?: { deepRun?: boolean; maxIterations?: number }) =>
      post('/code/init', { dir, mcpServers, opts }),
    listMcpForCode: () => get('/code/mcp-for-code'),
    getConversationId: () => get('/code/conversation-id'),
    getMcpSelection: (convId: string) => get(`/code/mcp-selection/${convId}`),
    setMcpSelection: (convId: string, servers: string[]) => post('/code/mcp-selection', { convId, servers }),
    onCodeLog: (cb: (event: unknown) => void) => {
      on('jiva:code-log', (msg: unknown) => cb((msg as Record<string, unknown>).event))
    },
  },

  git: {
    isRepo: (dir: string) => get<boolean>('/git/is-repo', { dir }),
    status: (dir: string) => get('/git/status', { dir }),
    diffFile: (dir: string, file: string, status?: string) =>
      get('/git/diff-file', { dir, file, ...(status ? { status } : {}) }),
    initRepo: (dir: string) => post('/git/init-repo', { dir }),
    branchInfo: (dir: string) => get('/git/branch-info', { dir }),
  },

  directive: {
    get: () => get<string>('/directive'),
    set: (content: string) => post('/directive', { content }),
  },

  onNativeThemeChanged: (cb: (isDark: boolean) => void) => {
    // Use browser media query instead of native theme IPC
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', (e) => cb(e.matches))
  },

  setup: {
    check: () => get('/setup/check'),
  },

  updater: {
    check: () => Promise.resolve(),
    quitAndInstall: () => Promise.resolve(),
    onAvailable: (_cb: unknown) => {},
    onProgress: (_cb: unknown) => {},
    onReady: (_cb: unknown) => {},
  },

  cloud: {
    openWindow: () => {
      window.open('/?mode=cloud', '_blank')
      return Promise.resolve()
    },
    signIn: (email: string, password: string) => post('/cloud/sign-in', { email, password }),
    signUp: (email: string, password: string) => post('/cloud/sign-up', { email, password }),
    signOut: () => post('/cloud/sign-out'),
    init: (userId: string, sessionId: string) => post('/cloud/init', { userId, sessionId }),
  },
}

// Expose on window so all existing code keeps working without changes
window.electron = electronShim as typeof window.electron

// Fetch platform from server and update
get<string>('/platform').then(p => {
  ;(window.electron as unknown as Record<string, unknown>).platform = p
}).catch(() => {})
