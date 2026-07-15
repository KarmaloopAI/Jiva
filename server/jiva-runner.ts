import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { writeDirective } from './directive-manager'
import { readConfig } from './config-manager'
import * as harness from './harness'
import type { Completer } from './harness'
import { parseLogLine } from './code-runner'
import type { CodeLogEvent } from './code-runner'

/**
 * Resolve the absolute path to jiva-core's main entry point.
 * jiva-core is installed globally (npm install -g jiva-core), so we can't
 * use a bare `import('jiva-core')` from within dist-electron/ — Node.js
 * resolves bare specifiers relative to the file's directory, not the project root.
 * We detect the global npm root at runtime and build the absolute path.
 */
function resolveJivaCoreEntryPath(): string {
  // Try npm root -g
  try {
    const npmRoot = execSync('npm root -g', { timeout: 5000 }).toString().trim()
    const pkgJson = path.join(npmRoot, 'jiva-core', 'package.json')
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'))
      const main = pkg.main ?? 'dist/index.js'
      return path.join(npmRoot, 'jiva-core', main)
    }
  } catch {}

  // Try to find in common Windows locations
  if (process.platform === 'win32') {
    const possiblePaths = [
      path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'dist', 'index.js'),
      path.join(process.env.LOCALAPPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'dist', 'index.js'),
      'C:\\Program Files\\nodejs\\node_modules\\jiva-core\\dist\\index.js',
    ]
    for (const known of possiblePaths) {
      if (fs.existsSync(known)) return known
    }
  }

  // Known macOS/Linux fallback path
  const known = '/Users/abidev/.npm-global/lib/node_modules/jiva-core/dist/index.js'
  if (fs.existsSync(known)) return known

  throw new Error(
    'Could not find jiva-core. Please ensure it is installed globally: npm install -g jiva-core'
  )
}

export type RunnerStatus = 'stopped' | 'initializing' | 'ready' | 'busy' | 'error'

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

export type PhaseUpdate = 'initializing' | 'planning' | 'executing' | 'synthesizing' | 'done'

/**
 * JivaRunner — integrates jiva-core SDK directly in the Electron main process.
 *
 * Uses dynamic import() for ESM compatibility: jiva-core is "type": "module",
 * while our Electron main is compiled as CJS. The standard interop is
 * `await import('jiva-core')` which works in Node.js >= 12.
 *
 * Architecture:
 *   Renderer ─ IPC invoke ─▶ Main (JivaRunner) ─▶ DualAgent SDK
 *                                     │
 *                               IPC send (phase events)
 *                                     │
 *   Renderer ◀────────────────────────┘
 */
export class JivaRunner extends EventEmitter {
  private status: RunnerStatus = 'stopped'
  private agent: unknown = null          // DualAgent instance (typed as unknown for CJS→ESM)
  private orchestrator: unknown = null   // ModelOrchestrator
  private mcpManager: unknown = null     // MCPServerManager
  private workspace: unknown = null      // WorkspaceManager
  private conversationManager: unknown = null
  private personaManager: unknown = null
  private jivaLogger: unknown = null     // jiva-core logger singleton (for direct hook)
  private currentPersona: string | null = null
  private currentConversationId: string | null = null
  private maxIterations = 50             // user-configured; synced from chat() opts each call

  getStatus(): RunnerStatus {
    return this.status
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId
  }

  /**
   * Initialize the Jiva agent with current config.
   * Call once on app startup, and re-call when persona changes.
   */
  async initialize(persona?: string): Promise<void> {
    this.setStatus('initializing')

    try {
      // Resolve the absolute path to jiva-core's entry point.
      // We can't use bare `import('jiva-core')` from dist-electron/ because Node.js
      // resolves relative to the compiled file location, not the project root.
      const jivaCoreEntry = resolveJivaCoreEntryPath()
      console.log(`[JivaRunner] Loading jiva-core from: ${jivaCoreEntry}`)

      // Dynamic ESM import — the only way to load "type":"module" packages from CJS
      // Must use file:// URL on Windows for ESM compatibility
      const jiva = await import(pathToFileURL(jivaCoreEntry).href)

      const {
        MCPServerManager,
        WorkspaceManager,
        ConversationManager,
        ModelOrchestrator,
        DualAgent,
        createKrutrimModel,
        LogLevel,
        logger,
        createLocalProvider,
      } = jiva as Record<string, unknown>

      // --- 1. Load config from Jivam's own config file (not jiva-core's global singleton) ---
      const jivaConfig = readConfig()
      if (!jivaConfig?.models?.reasoning?.apiKey) {
        throw new Error('Jivam is not configured. Add your API key in Settings → Models.')
      }

      const reasoningConfig = jivaConfig.models.reasoning as {
        endpoint?: string; apiKey?: string; defaultModel?: string; model?: string
        useHarmonyFormat?: boolean; reasoningEffortStrategy?: string; defaultMaxTokens?: number
        maxRequestsPerMinute?: number; hasVision?: boolean
      }
      const multimodalConfig = jivaConfig.models.multimodal as {
        endpoint?: string; apiKey?: string; defaultModel?: string
      } | null | undefined

      // --- 2. Create models ---
      const createModel = createKrutrimModel as (config: unknown) => unknown
      // defaultModel is the canonical field; fall back to model for legacy configs
      const resolvedReasoningModel = reasoningConfig.defaultModel ?? reasoningConfig.model ?? ''
      const reasoningModel = createModel({
        endpoint: reasoningConfig.endpoint,
        apiKey: reasoningConfig.apiKey,
        model: resolvedReasoningModel,
        type: 'reasoning',
        useHarmonyFormat: reasoningConfig.useHarmonyFormat,
        ...(reasoningConfig.reasoningEffortStrategy ? { reasoningEffortStrategy: reasoningConfig.reasoningEffortStrategy } : {}),
        ...(reasoningConfig.defaultMaxTokens ? { defaultMaxTokens: reasoningConfig.defaultMaxTokens } : {}),
        ...(reasoningConfig.maxRequestsPerMinute ? { maxRequestsPerMinute: reasoningConfig.maxRequestsPerMinute } : {}),
        ...(reasoningConfig.hasVision ? { hasVision: true } : {}),
      })

      let multimodalModel: unknown
      if (multimodalConfig?.apiKey) {
        try {
          const resolvedMmModel = multimodalConfig.defaultModel ?? ''
          multimodalModel = createModel({
            endpoint: multimodalConfig.endpoint,
            apiKey: multimodalConfig.apiKey,
            model: resolvedMmModel,
            type: 'multimodal',
          })
        } catch {
          console.warn('[JivaRunner] Failed to create multimodal model, continuing without vision')
        }
      }

      // --- 3. Create orchestrator ---
      const OrchestratorClass = ModelOrchestrator as new (config: unknown) => unknown
      this.orchestrator = new OrchestratorClass({ reasoningModel, multimodalModel })

      // --- 4. Initialize MCP servers ---
      const mcpServers = (jivaConfig.mcpServers ?? {}) as Record<string, unknown>
      const allowedPath = os.platform() === 'win32' ? 'C:\\Users' : '/Users'

      // Ensure filesystem MCP server always exists
      if (!(mcpServers as Record<string, unknown>)['filesystem']) {
        (mcpServers as Record<string, unknown>)['filesystem'] = {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
          enabled: true,
        }
      }

      const McpManagerClass = MCPServerManager as new () => {
        initialize(servers: unknown): Promise<void>
        addServer(name: string, config: unknown): Promise<void>
        cleanup(): Promise<void>
      }
      this.mcpManager = new McpManagerClass()
      await (this.mcpManager as ReturnType<typeof McpManagerClass['prototype']['constructor']> & {
        initialize(servers: unknown): Promise<void>
      }).initialize(mcpServers)

      // --- 5. Write date-aware directive + Initialize workspace ---
      // The directive injects current date/time + recent activity so the LLM always
      // knows the correct date without relying on its training data.
      const { path: directivePath } = writeDirective(jivaConfig.userDirective)

      const workspaceDir = process.cwd()
      const WsClass = WorkspaceManager as new (config: unknown) => { initialize(): Promise<void> }
      this.workspace = new WsClass({ workspaceDir, directivePath })
      await (this.workspace as { initialize(): Promise<void> }).initialize()

      // --- 6. Initialize conversation manager ---
      const createProvider = createLocalProvider as () => Promise<unknown>
      const storageProvider = await createProvider()
      const ConvManagerClass = ConversationManager as new (provider: unknown, orchestrator?: unknown) => unknown
      this.conversationManager = new ConvManagerClass(storageProvider, this.orchestrator)

      // --- 7. Initialize persona manager ---
      // PersonaManager is not exported from the main index — use dynamic path import
      const jivaCoreDir = path.dirname(jivaCoreEntry)  // dist/
      const jivaCoreRoot = path.dirname(jivaCoreDir)   // jiva-core root
      const personaManagerPath = path.join(jivaCoreRoot, 'dist', 'personas', 'persona-manager.js')
      const { PersonaManager } = await import(
        pathToFileURL(personaManagerPath).href
      ) as { PersonaManager: new () => {
        initialize(persona?: string): Promise<void>
        getPersonaMCPServers(): Record<string, unknown>
        setActivePersona(name: string | null): void
      }}
      this.personaManager = new PersonaManager()
      await (this.personaManager as { initialize(p?: string): Promise<void> }).initialize(
        persona ?? undefined
      )

      // Merge persona-specific MCP servers
      const personaMCPServers = (this.personaManager as {
        getPersonaMCPServers(): Record<string, unknown>
      }).getPersonaMCPServers()

      for (const [name, config] of Object.entries(personaMCPServers)) {
        try {
          await (this.mcpManager as {
            addServer(name: string, config: unknown): Promise<void>
          }).addServer(name, config)
        } catch (err) {
          console.warn(`[JivaRunner] Failed to add persona MCP server '${name}':`, err)
        }
      }

      // --- 8. Create DualAgent ---
      const AgentClass = DualAgent as new (config: unknown) => {
        chat(prompt: string): Promise<{
          content: string
          iterations: number
          toolsUsed: string[]
          plan?: { subtasks: string[]; reasoning: string }
        }>
        cleanup(): Promise<void>
        resetConversation(): void
        saveConversation(): Promise<string | null>
        loadConversation(id: string): Promise<void>
        listConversations(): Promise<unknown[]>
      }

      this.agent = new AgentClass({
        orchestrator: this.orchestrator,
        mcpManager: this.mcpManager,
        workspace: this.workspace,
        conversationManager: this.conversationManager,
        personaManager: this.personaManager,
        maxSubtasks: 20,
        maxIterations: this.maxIterations,
        autoSave: true,
        condensingThreshold: 30,
      })

      // Store the jiva-core logger so runChat() can hook into it per call
      this.jivaLogger = logger

      this.currentPersona = persona ?? null
      this.setStatus('ready')
      console.log('[JivaRunner] Initialized successfully')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[JivaRunner] Initialization failed:', msg)
      this.setStatus('error', msg)
      throw err
    }
  }

  private makeCompleter(): Completer {
    const orch = this.orchestrator as Record<string, unknown>
    return async (systemPrompt: string, userPrompt: string): Promise<string | null> => {
      if (typeof orch['chat'] !== 'function') return null
      try {
        const chatFn = (orch['chat'] as (opts: {
          messages: Array<{ role: string; content: string }>
          reasoningEffort?: string
        }) => Promise<{ content: string }>).bind(orch)
        const result = await chatFn({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          reasoningEffort: 'low',
        })
        return result?.content ?? null
      } catch (err) {
        console.warn('[JivaRunner] makeCompleter: chat() failed:', err)
        return null
      }
    }
  }

  /**
   * Send a message to the Jiva agent and return the result.
   * Emits 'phase-update' events as execution progresses.
   *
   * Since DualAgent.chat() is synchronous end-to-end (no event emitter),
   * we emit a simulated phase timeline based on typical durations.
   */
  /**
   * Attach a per-call handler to the jiva-core logger.
   * Tries multiple hook patterns since we can't guarantee the logger's exact API.
   * Returns a cleanup function that removes the handler.
   */
  private hookLogger(onLog: (event: CodeLogEvent) => void): () => void {
    const log = this.jivaLogger as Record<string, unknown> | null
    if (!log) return () => {}

    const emit = (level: string, tag: string, message: string) => {
      const lvl = level.toLowerCase()
      onLog({
        timestamp: new Date().toISOString(),
        level: (lvl === 'warn' || lvl === 'error' ? lvl : 'info') as CodeLogEvent['level'],
        tag,
        message,
      })
    }

    // Pattern 1: EventEmitter 'log' event — common for custom loggers
    // Signature variants: (level, tag, msg) or ({ level, tag, message }) or (level, msg)
    if (typeof log.on === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (...args: any[]) => {
        if (args.length >= 3 && typeof args[0] === 'string') {
          emit(args[0], args[1] ?? 'jiva', args[2])
        } else if (args.length >= 2 && typeof args[0] === 'string') {
          emit('info', 'jiva', args[1])
        } else if (args.length >= 1 && typeof args[0] === 'object') {
          const e = args[0] as Record<string, unknown>
          emit(String(e.level ?? 'info'), String(e.tag ?? e.name ?? 'jiva'), String(e.message ?? e.msg ?? ''))
        }
      }
      try {
        ;(log.on as (e: string, fn: unknown) => void)('log', handler)
        return () => {
          if (typeof log.off === 'function') (log.off as (e: string, fn: unknown) => void)('log', handler)
          else if (typeof log.removeListener === 'function') (log.removeListener as (e: string, fn: unknown) => void)('log', handler)
        }
      } catch {}
    }

    // Pattern 2: addTransport / addHandler
    for (const addMethod of ['addTransport', 'addHandler', 'addSink']) {
      if (typeof log[addMethod] !== 'function') continue
      const removeMethod = addMethod.replace('add', 'remove')
      const transport = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        write: (entry: Record<string, unknown>) => {
          emit(String(entry.level ?? 'info'), String(entry.tag ?? entry.name ?? 'jiva'), String(entry.message ?? entry.msg ?? ''))
        },
        // Some loggers call log() instead of write()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        log: (entry: Record<string, unknown>) => {
          emit(String(entry.level ?? 'info'), String(entry.tag ?? entry.name ?? 'jiva'), String(entry.message ?? entry.msg ?? ''))
        },
      }
      try {
        ;(log[addMethod] as (t: unknown) => void)(transport)
        return () => {
          if (typeof log[removeMethod] === 'function') {
            try { (log[removeMethod] as (t: unknown) => void)(transport) } catch {}
          }
        }
      } catch {}
    }

    // Pattern 3: stdout interception — last resort for loggers that only write to stdout
    const origWrite = process.stdout.write.bind(process.stdout)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = (data: string | Uint8Array, ...args: any[]) => {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString()
      for (const line of text.split('\n')) {
        // Try strict structured format first
        const structured = parseLogLine(line)
        if (structured) { onLog(structured); continue }
        // Lenient fallback: any line mentioning a tool call
        const toolMatch = /(?:tool(?:\s+call)?|calling|executing)[:\s]+([^\s(]+)/i.exec(line.trim())
        if (toolMatch) {
          onLog({ timestamp: new Date().toISOString(), level: 'info', tag: 'jiva', message: `Tool: ${toolMatch[1]}` })
        }
      }
      return origWrite(data, ...args)
    }
    return () => { process.stdout.write = origWrite }
  }

  private async runChat(
    prompt: string,
    startTime: number,
    onLog?: (event: CodeLogEvent) => void
  ): Promise<JivaRunResult> {
    const unhook = onLog ? this.hookLogger(onLog) : null

    const agent = this.agent as {
      chat(prompt: string): Promise<{
        content: string
        iterations: number
        toolsUsed: string[]
        plan?: { subtasks: string[]; reasoning: string }
      }>
    }

    let response: { content: string; iterations: number; toolsUsed: string[]; plan?: { subtasks: string[]; reasoning: string } }
    try {
      response = await agent.chat(prompt)
    } finally {
      unhook?.()
    }

    // Synthesise tool events from toolsUsed if none were emitted during execution
    // (covers the case where DualAgent doesn't log intermediately)
    if (onLog && response.toolsUsed?.length) {
      for (const tool of response.toolsUsed) {
        onLog({ timestamp: new Date().toISOString(), level: 'info', tag: 'jiva', message: `Tool: ${tool}` })
      }
    }

    // Capture conversation ID (auto-saved by DualAgent).
    let convId: string | null = null
    try {
      convId = (this.conversationManager as {
        getCurrentConversationId?(): string | null
      }).getCurrentConversationId?.() ?? null
    } catch {}

    if (!convId) {
      try {
        convId = await (this.agent as {
          saveConversation(): Promise<string | null>
        }).saveConversation()
      } catch {}
    }

    if (convId) this.currentConversationId = convId

    return {
      content: response.content,
      iterations: response.iterations,
      toolsUsed: response.toolsUsed ?? [],
      plan: response.plan
        ? { subtasks: response.plan.subtasks ?? [], reasoning: response.plan.reasoning }
        : null,
      durationMs: Date.now() - startTime,
      conversationId: this.currentConversationId ?? undefined,
    }
  }

  /**
   * Send a message to the Jiva agent and return the result.
   * Emits 'phase-update' events as execution progresses.
   *
   * Since DualAgent.chat() is synchronous end-to-end (no event emitter),
   * we emit a simulated phase timeline based on typical durations.
   */
  async chat(
    prompt: string,
    onPhase: (phase: PhaseUpdate) => void,
    opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string },
    onLog?: (event: CodeLogEvent) => void
  ): Promise<JivaRunResult> {
    if (!this.agent) {
      throw new Error('JivaRunner not initialized. Call initialize() first.')
    }
    if (this.status === 'busy') {
      throw new Error('Agent is already processing a request.')
    }

    // Sync maxIterations from caller and propagate to agent instance lazily
    if (opts?.maxIterations !== undefined && opts.maxIterations !== this.maxIterations) {
      this.maxIterations = opts.maxIterations
      try { (this.agent as Record<string, unknown>).maxIterations = this.maxIterations } catch {}
    }

    this.setStatus('busy')
    const startTime = Date.now()

    onPhase('planning')
    const executingTimer = setTimeout(() => onPhase('executing'), 2000)
    const synthesizingTimer = setTimeout(() => onPhase('synthesizing'), 30000)

    try {
      let result: JivaRunResult

      if (opts?.deepRun !== false) {
        // Collect names of currently configured MCP servers so the brain can recommend
        // additional ones the user hasn't set up yet.
        const mcpServerNames = Object.keys(readConfig()?.mcpServers ?? {})

        result = await harness.run(
          prompt,
          this.makeCompleter(),
          (p, execOpts) => {
            // Apply per-subtask iteration limit from the brain's complexity hint
            if (execOpts?.maxIterations !== undefined && execOpts.maxIterations !== this.maxIterations) {
              this.maxIterations = execOpts.maxIterations
              try { (this.agent as Record<string, unknown>).maxIterations = this.maxIterations } catch {}
            }
            return this.runChat(p, startTime, onLog)
          },
          (brainEvent) => onLog?.(brainEvent),
          this.maxIterations,
          opts?.conversationHistory || undefined,
          mcpServerNames
        )
      } else {
        result = await this.runChat(prompt, startTime, onLog)
      }

      clearTimeout(executingTimer)
      clearTimeout(synthesizingTimer)
      onPhase('done')
      this.setStatus('ready')

      return result
    } catch (err) {
      clearTimeout(executingTimer)
      clearTimeout(synthesizingTimer)
      this.setStatus('ready')
      throw err
    }
  }

  /**
   * Load a past conversation into the agent by ID.
   * This restores the full conversation history so subsequent chat() calls continue in context.
   */
  async loadConversation(id: string): Promise<void> {
    if (!this.agent) {
      throw new Error('JivaRunner not initialized. Call initialize() first.')
    }
    await (this.agent as { loadConversation(id: string): Promise<void> }).loadConversation(id)
    this.currentConversationId = id
    console.log(`[JivaRunner] Loaded conversation: ${id}`)
  }

  /**
   * Switch to a different persona. Re-initializes the agent with new persona config.
   */
  async switchPersona(persona: string): Promise<void> {
    if (this.agent) {
      await this.cleanup()
    }
    await this.initialize(persona)
  }

  /**
   * Reset conversation history without re-initializing.
   */
  resetConversation(): void {
    if (this.agent) {
      ;(this.agent as { resetConversation(): void }).resetConversation()
    }
    this.currentConversationId = null
  }

  // ─── MCP Server Management ────────────────────────────────────────────────

  /**
   * Get all tools grouped by server name.
   */
  getMCPTools(): Record<string, Array<{ name: string; description: string }>> {
    if (!this.mcpManager) return {}
    try {
      const allTools = (this.mcpManager as {
        getAllTools?(): Array<{ name: string; description?: string }>
      }).getAllTools?.() ?? []

      const grouped: Record<string, Array<{ name: string; description: string }>> = {}
      for (const tool of allTools) {
        // Tool names are prefixed as "serverName__toolName"
        const parts = tool.name.split('__')
        const serverName = parts.length > 1 ? parts[0] : 'unknown'
        const toolName = parts.length > 1 ? parts.slice(1).join('__') : tool.name
        if (!grouped[serverName]) grouped[serverName] = []
        grouped[serverName].push({ name: toolName, description: tool.description ?? '' })
      }
      return grouped
    } catch {
      return {}
    }
  }

  /**
   * Add a new MCP server to the running manager.
   * The caller is responsible for persisting to config.
   */
  async addMCPServer(name: string, config: unknown): Promise<void> {
    if (!this.mcpManager) throw new Error('MCP manager not initialized')
    await (this.mcpManager as {
      addServer(name: string, config: unknown): Promise<void>
    }).addServer(name, config)
  }

  /**
   * Remove an MCP server from the running manager.
   * The caller is responsible for updating config.
   */
  async removeMCPServer(name: string): Promise<void> {
    if (!this.mcpManager) throw new Error('MCP manager not initialized')
    const manager = this.mcpManager as {
      removeServer?(name: string): Promise<void>
      disableServer?(name: string): Promise<void>
    }
    if (manager.removeServer) {
      await manager.removeServer(name)
    } else if (manager.disableServer) {
      await manager.disableServer(name)
    }
  }

  /**
   * Get status of all connected MCP servers, including any error info.
   */
  getMCPServerStatus(): Array<{ name: string; enabled: boolean; connected: boolean; toolCount: number; error?: string }> {
    if (!this.mcpManager) return []
    try {
      const statuses = (this.mcpManager as {
        getServerStatus?(): Array<{ name: string; enabled: boolean; connected: boolean; toolCount: number }>
      }).getServerStatus?.() ?? []
      return statuses.map(s => ({
        ...s,
        error: (s as Record<string, unknown>).error as string | undefined
          ?? (s as Record<string, unknown>).lastError as string | undefined,
      }))
    } catch {
      return []
    }
  }

  /**
   * Reconnect an MCP server without touching config.
   * Tries native reconnect first, falls back to remove + re-add.
   */
  async reconnectMCPServer(name: string): Promise<void> {
    if (!this.mcpManager) throw new Error('MCP manager not initialized')
    const manager = this.mcpManager as Record<string, unknown>

    // Try native reconnect if available
    if (typeof manager.reconnectServer === 'function') {
      await (manager.reconnectServer as (n: string) => Promise<void>)(name)
      return
    }

    // Fallback: get current status, remove from manager, re-add
    const statuses = this.getMCPServerStatus()
    const srv = statuses.find(s => s.name === name)
    if (!srv) throw new Error(`MCP server "${name}" not found`)

    const fullStatus = (this.mcpManager as {
      getServerStatus?(): Array<Record<string, unknown>>
    }).getServerStatus?.()?.find((s) => s.name === name) ?? {}

    await this.removeMCPServer(name)
    const config = (fullStatus.url != null)
      ? { type: 'http' as const, url: fullStatus.url as string, env: fullStatus.env as Record<string, string> | undefined, enabled: true }
      : { type: 'stdio' as const, command: fullStatus.command as string, args: fullStatus.args as string[] | undefined, env: fullStatus.env as Record<string, string> | undefined, enabled: true }
    await this.addMCPServer(name, config)
  }

  /**
   * Enable or disable an MCP server at runtime.
   * The caller is responsible for updating config.
   */
  async toggleMCPServer(name: string, enabled: boolean): Promise<void> {
    if (!this.mcpManager) throw new Error('MCP manager not initialized')
    const manager = this.mcpManager as {
      enableServer?(name: string): Promise<void>
      disableServer?(name: string): Promise<void>
    }
    if (enabled && manager.enableServer) {
      await manager.enableServer(name)
    } else if (!enabled && manager.disableServer) {
      await manager.disableServer(name)
    }
  }

  /**
   * Describe an image using the configured multimodal model.
   * Returns a text description suitable for injection into a text prompt.
   * Throws if no multimodal model is configured or runner is not initialized.
   */
  async describeImage(base64DataUri: string): Promise<string> {
    if (!this.orchestrator) {
      throw new Error('JivaRunner not initialized. Call initialize() first.')
    }

    const config = readConfig()
    if (!config?.models?.multimodal) {
      throw new Error('No multimodal (vision) model is configured. Enable it in Settings → Models.')
    }

    const orchestrator = this.orchestrator as {
      chat(options: unknown): Promise<{ content: string }>
    }

    const response = await orchestrator.chat({
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64DataUri } },
          { type: 'text', text: 'Describe this image in detail, including all visible content, text, charts, diagrams, and any notable elements.' },
        ],
      }],
    })

    return response.content
  }

  /**
   * Clean up all resources (MCP servers, agent).
   */
  async cleanup(): Promise<void> {
    try {
      if (this.agent) {
        await (this.agent as { cleanup(): Promise<void> }).cleanup()
        this.agent = null
      }
      if (this.mcpManager) {
        await (this.mcpManager as { cleanup(): Promise<void> }).cleanup()
        this.mcpManager = null
      }
    } catch (err) {
      console.warn('[JivaRunner] Cleanup error:', err)
    }
    this.orchestrator = null
    this.workspace = null
    this.conversationManager = null
    this.personaManager = null
    this.currentConversationId = null
    this.setStatus('stopped')
  }

  stop(): void {
    if (this.agent) {
      (this.agent as { stop(): void }).stop()
    }
  }

  private setStatus(status: RunnerStatus, error?: string) {
    this.status = status
    this.emit('status-changed', status, { error })
  }
}
