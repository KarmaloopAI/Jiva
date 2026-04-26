import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { writeDirective } from './directive-manager'
import { readConfig } from './config-manager'

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
  private currentPersona: string | null = null
  private currentConversationId: string | null = null

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
        configManager,
        MCPServerManager,
        WorkspaceManager,
        ConversationManager,
        ModelOrchestrator,
        DualAgent,
        createKrutrimModel,
        LogLevel,
        logger,
        createLocalProvider,
      } = jiva as Record<string, unknown> & {
        configManager: {
          isConfigured(): boolean
          validateConfig(): void
          getReasoningModel(): unknown
          getMultimodalModel(): unknown
          getMCPServers(): Record<string, unknown>
          getActivePersona(): string | null
        }
      }

      // --- 1. Load config ---
      if (!(configManager as typeof configManager).isConfigured()) {
        throw new Error('Jiva is not configured. Please run: jiva setup')
      }
      ;(configManager as typeof configManager).validateConfig()

      const reasoningConfig = (configManager as typeof configManager).getReasoningModel() as {
        endpoint: string; apiKey: string; defaultModel: string; useHarmonyFormat?: boolean
      }
      const multimodalConfig = (configManager as typeof configManager).getMultimodalModel() as {
        endpoint: string; apiKey: string; defaultModel: string
      } | undefined

      // --- 2. Create models ---
      const createModel = createKrutrimModel as (config: unknown) => unknown
      const reasoningModel = createModel({
        endpoint: reasoningConfig.endpoint,
        apiKey: reasoningConfig.apiKey,
        model: reasoningConfig.defaultModel,
        type: 'reasoning',
        useHarmonyFormat: reasoningConfig.useHarmonyFormat,
      })

      let multimodalModel: unknown
      if (multimodalConfig) {
        try {
          multimodalModel = createModel({
            endpoint: multimodalConfig.endpoint,
            apiKey: multimodalConfig.apiKey,
            model: multimodalConfig.defaultModel,
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
      const mcpServers = (configManager as typeof configManager).getMCPServers()
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
      const { path: directivePath } = writeDirective(
        (readConfig() as Record<string, unknown>)?.userDirective as string | undefined
      )

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
        persona ?? (configManager as typeof configManager).getActivePersona() ?? undefined
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
        maxIterations: 10,
        autoSave: true,
        condensingThreshold: 30,
      })

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

  /**
   * Send a message to the Jiva agent and return the result.
   * Emits 'phase-update' events as execution progresses.
   *
   * Since DualAgent.chat() is synchronous end-to-end (no event emitter),
   * we emit a simulated phase timeline based on typical durations.
   */
  async chat(
    prompt: string,
    onPhase: (phase: PhaseUpdate) => void
  ): Promise<JivaRunResult> {
    if (!this.agent) {
      throw new Error('JivaRunner not initialized. Call initialize() first.')
    }
    if (this.status === 'busy') {
      throw new Error('Agent is already processing a request.')
    }

    this.setStatus('busy')
    const startTime = Date.now()

    // Emit simulated phase updates since DualAgent has no event emitter
    // Phase timing based on observed real-world durations:
    // - Planning: starts immediately
    // - Executing: ~3-8s after planning starts
    // - Synthesizing: toward the end
    onPhase('planning')
    const executingTimer = setTimeout(() => onPhase('executing'), 5000)
    const synthesizingTimer = setTimeout(() => onPhase('synthesizing'), 20000)

    try {
      const agent = this.agent as {
        chat(prompt: string): Promise<{
          content: string
          iterations: number
          toolsUsed: string[]
          plan?: { subtasks: string[]; reasoning: string }
        }>
      }

      const response = await agent.chat(prompt)

      clearTimeout(executingTimer)
      clearTimeout(synthesizingTimer)
      onPhase('done')

      // Capture conversation ID after chat completes (auto-saved by DualAgent).
      // Try getCurrentConversationId() first; fall back to saveConversation() if unavailable.
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

      this.setStatus('ready')

      return {
        content: response.content,
        iterations: response.iterations,
        toolsUsed: response.toolsUsed ?? [],
        plan: response.plan
          ? {
              subtasks: response.plan.subtasks ?? [],
              reasoning: response.plan.reasoning,
            }
          : null,
        durationMs: Date.now() - startTime,
        conversationId: this.currentConversationId ?? undefined,
      }
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
