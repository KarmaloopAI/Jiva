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

// Spreading a large Uint8Array into String.fromCharCode(...) as call args blows
// the JS engine's argument-count limit (~65k) — chunk it instead so image/doc
// uploads of any size survive base64 encoding.
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// --- File picker helper (browser native → upload to server) ---
async function pickAndUploadFiles(includeImages: boolean): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    // WebKit — especially inside an installed Safari "Add to Dock" web app,
    // which runs in a stricter process than a regular tab — can silently
    // refuse to open the native picker for a file input that was never
    // attached to the document. Keep it in the DOM (visually hidden) for
    // the picker's lifetime instead of calling .click() on a detached node.
    input.style.position = 'fixed'
    input.style.top = '-1000px'
    input.style.left = '-1000px'
    const imageExts = '.png,.jpg,.jpeg,.gif,.webp,.bmp'
    const docExts = '.pdf,.docx'
    const textExts = '.txt,.md,.markdown,.rst,.log,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.cc,.h,.hpp,.cs,.css,.scss,.sass,.less,.html,.htm,.xml,.svg,.json,.jsonc,.yaml,.yml,.toml,.ini,.cfg,.conf,.sh,.bash,.zsh,.ps1,.bat,.sql,.graphql,.proto,.vue,.svelte,.astro'
    input.accept = includeImages
      ? `${imageExts},${docExts},${textExts}`
      : `${docExts},${textExts}`

    const cleanup = () => {
      input.remove()
      window.removeEventListener('focus', onWindowFocus)
    }

    // The `change` event never fires if the user cancels the dialog, which
    // would otherwise leak the input and leave the caller's promise
    // unresolved forever. A window focus event fires reliably when the
    // native dialog closes either way, so use it (after a short delay, to
    // let `change` win the race when a file really was picked) as a
    // cancel-safe fallback.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!document.body.contains(input)) return
        cleanup()
        resolve([])
      }, 300)
    }
    window.addEventListener('focus', onWindowFocus)

    input.onchange = async () => {
      if (!input.files?.length) { cleanup(); return resolve([]) }
      try {
        const files = Array.from(input.files)
        const encoded = await Promise.all(files.map(async f => {
          const buf = await f.arrayBuffer()
          const data = arrayBufferToBase64(buf)
          return { name: f.name, data, mimeType: f.type }
        }))
        const results = await post<Array<{ name: string; category: string; markdown: string; mimeType?: string; error?: string }>>(
          '/files/upload-and-convert', { files: encoded }
        )
        // Store results by a synthetic key for files.convert() to retrieve
        results.forEach(r => uploadedFiles.set(r.name, r))
        cleanup()
        resolve(results.map(r => `__uploaded__${r.name}`))
      } catch {
        cleanup()
        resolve([])
      }
    }

    document.body.appendChild(input)
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
    switchModel: (model: string) => post<{ success: boolean; error?: string }>('/jiva/switch-model', { model }),
  },

  config: {
    read: () => get('/config'),
    write: (config: unknown) => post('/config', config),
    getPath: () => get<string>('/config/path'),
    setupProvider: (args: { provider: 'sarvam' | 'krutrim' | 'groq' | 'together' | 'openai-compatible'; apiKey: string; customEndpoint?: string; customModel?: string; hasVision?: boolean }) =>
      post<{ success: boolean; error?: string }>('/config/setup-provider', args),
    listModels: (params?: { endpoint?: string; apiKey?: string }) =>
      get<{ success: boolean; models: string[]; error?: string }>('/config/models', params as Record<string, string> | undefined),
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
    // Same upload-and-convert path pickAndUploadFiles() uses internally,
    // exposed directly for callers (e.g. clipboard paste) that already have
    // base64 data in hand and don't need the native file-picker dialog.
    uploadAndConvert: (files: Array<{ name: string; data: string; mimeType: string }>) =>
      post<Array<{ name: string; category: string; markdown: string; mimeType?: string; dataUri?: string; error?: string }>>(
        '/files/upload-and-convert', { files }
      ),
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
    restoreConversation: (id: string) => post<{
      success: boolean; workspace?: string; mcpServers?: string[]; maxIterations?: number; harness?: string; error?: string
    }>('/code/restore-conversation', { id }),
    switchModel: (model: string) => post<{ success: boolean; error?: string }>('/code/switch-model', { model }),
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
    listFiles: (dir: string) => get<string[]>('/git/list-files', { dir }),
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

  // Fired once `jivam --install` detects the Safari "Add to Dock" bundle —
  // see AddToDockGuide in App.tsx.
  onPwaInstalled: (cb: () => void) => {
    on('jivam:pwa-installed', () => cb())
  },

  setup: {
    check: () => get('/setup/check'),
  },

  updater: {
    getStatus: () => get('/system/update-status'),
    check: () => post('/system/update-check'),
    apply: () => post<{ success: boolean; error?: string }>('/system/update-apply'),
    onStatus: (cb: (status: unknown) => void) => {
      on('jivam:update-status', (status: unknown) => cb(status))
    },
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
