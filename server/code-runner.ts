import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { writeDirective } from './directive-manager'
import { readConfig, writeConfig } from './config-manager'
import * as harness from './harness'
import type { Completer } from './harness'

export interface CodeLogEvent {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  tag: string
  message: string
}

export interface CodeRunResult {
  content: string
  toolsUsed: string[]
  iterations: number
}

function resolveJivaCoreEntryPath(): string {
  try {
    const npmRoot = execSync('npm root -g', { timeout: 5000 }).toString().trim()
    const pkgJson = path.join(npmRoot, 'jiva-core', 'package.json')
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'))
      const main = pkg.main ?? 'dist/index.js'
      return path.join(npmRoot, 'jiva-core', main)
    }
  } catch {}

  const known = path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'jiva-core', 'dist', 'index.js')
  if (fs.existsSync(known)) return known

  throw new Error('Could not find jiva-core. Please run: npm install -g jiva-core')
}

// Parses a jiva-core log line into a structured event
// Format: "2026-03-13T10:28:32.695Z [INFO] [CodeAgent] Tool: glob"
const LOG_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.Z]+)\s+\[(INFO|WARN|ERROR)\]\s+\[(\w+)\]\s+(.+)$/

export function parseLogLine(line: string): CodeLogEvent | null {
  const m = LOG_RE.exec(line.trim())
  if (!m) return null
  return {
    timestamp: m[1],
    level: m[2].toLowerCase() as CodeLogEvent['level'],
    tag: m[3],
    message: m[4],
  }
}

export class CodeRunner extends EventEmitter {
  private agent: unknown = null
  private orchestrator: unknown = null
  private workspace: unknown = null
  private conversationManager: unknown = null
  private mcpManager: unknown = null
  private codeLogger: unknown = null   // jiva-core logger singleton (for direct hook)
  private ready = false
  private deepRun = false
  private maxIterations = 50
  // Cached so switchModel() can re-initialize with the same workspace/MCP
  // servers — initialize() itself doesn't retain these as instance state.
  private lastWorkspaceDir: string | null = null
  private lastMcpServerNames: string[] | undefined = undefined

  isReady(): boolean {
    return this.ready
  }

  getConversationId(): string | null {
    if (!this.conversationManager) return null
    return (this.conversationManager as Record<string, unknown>).currentConversationId as string ?? null
  }

  /**
   * Restore a previously-saved code conversation: reads the workspace/MCP
   * servers/maxIterations/harness it was configured with (from
   * ConversationMetadata, added in jiva-core v0.3.50) and re-initializes
   * with those exact settings before loading conversation history into the
   * agent, so continuing a session behaves like it never stopped.
   */
  async restoreConversation(id: string): Promise<{ workspace?: string; mcpServers?: string[]; maxIterations?: number; harness?: string }> {
    const convPath = path.join(os.homedir(), '.jiva', 'conversations', `${id}.json`)
    let meta: { workspace?: string; mcpServers?: string[]; maxIterations?: number; harness?: string }
    try {
      const raw = JSON.parse(fs.readFileSync(convPath, 'utf-8'))
      meta = raw.metadata ?? {}
    } catch {
      throw new Error(`Conversation ${id} not found`)
    }
    if (!meta.workspace) {
      throw new Error('Conversation has no recorded workspace to restore')
    }

    await this.initialize(meta.workspace, meta.mcpServers, {
      deepRun: meta.harness === 'deep-run',
      maxIterations: meta.maxIterations ?? 50,
    })

    await (this.agent as { loadConversation(id: string): Promise<void> }).loadConversation(id)

    return meta
  }

  async initialize(workspaceDir: string, mcpServerNames?: string[], opts?: { deepRun?: boolean; maxIterations?: number }): Promise<void> {
    this.deepRun = opts?.deepRun ?? false
    this.maxIterations = opts?.maxIterations ?? 50
    this.lastWorkspaceDir = workspaceDir
    this.lastMcpServerNames = mcpServerNames

    const entry = resolveJivaCoreEntryPath()
    console.log(`[CodeRunner] Loading jiva-core from: ${entry}`)

    const jiva = await import(pathToFileURL(entry).href)

    const {
      ModelOrchestrator,
      WorkspaceManager,
      ConversationManager,
      CodeAgent,
      MCPServerManager,
      createKrutrimModel,
      createLocalProvider,
      logger,
    } = jiva as Record<string, unknown>

    // Store the jiva-core logger so runChat() can hook into it for tool event capture
    this.codeLogger = logger ?? null

    // 1. Load config from Jivam's own config file (not jiva-core's global
    // singleton) — same source jiva-runner.ts uses for chat mode. This used
    // to call jiva-core's own configManager.getReasoningModel(), which reads
    // an entirely separate config file that's only populated by running the
    // `jiva` CLI's own setup wizard — so defaultMaxTokens/hasVision/
    // maxRequestsPerMinute/reasoningEffortStrategy set via Jivam's Settings
    // UI never reached Code Mode at all.
    const jivaConfig = readConfig()
    if (!jivaConfig?.models?.reasoning?.apiKey) {
      throw new Error('Jivam is not configured. Add your API key in Settings → Models.')
    }
    const reasoningConfig = jivaConfig.models.reasoning as {
      endpoint?: string; apiKey?: string; defaultModel?: string; model?: string
      useHarmonyFormat?: boolean; reasoningEffortStrategy?: string; defaultMaxTokens?: number
      maxRequestsPerMinute?: number; hasVision?: boolean
    }

    // 2. Create model + orchestrator
    const createModel = createKrutrimModel as (config: unknown) => unknown
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

    const OrchestratorClass = ModelOrchestrator as new (config: unknown) => unknown
    this.orchestrator = new OrchestratorClass({ reasoningModel })

    // 3. Write directive + workspace
    const { path: directivePath } = writeDirective(
      (readConfig() as unknown as Record<string, unknown>)?.userDirective as string | undefined
    )
    const WsClass = WorkspaceManager as new (config: unknown) => { initialize(): Promise<void> }
    this.workspace = new WsClass({ workspaceDir, directivePath })
    await (this.workspace as { initialize(): Promise<void> }).initialize()

    // 4. Conversation manager (auto-saves to ~/.jiva/conversations/)
    const createProvider = createLocalProvider as () => Promise<unknown>
    const storageProvider = await createProvider()
    const ConvManagerClass = ConversationManager as new (provider: unknown, orchestrator?: unknown) => unknown
    this.conversationManager = new ConvManagerClass(storageProvider, this.orchestrator)

    // 5. Optionally create MCPServerManager for requested code-mode servers
    this.mcpManager = null
    const activeMcpNames = mcpServerNames && mcpServerNames.length > 0 ? mcpServerNames : null
    if (activeMcpNames && MCPServerManager) {
      const MgrClass = MCPServerManager as new () => { initialize(servers: Record<string, unknown>): Promise<void> }
      const mgr = new MgrClass()
      const allServers = (readConfig() as unknown as Record<string, unknown>)?.mcpServers as Record<string, unknown> ?? {}
      const selectedServers: Record<string, unknown> = {}
      for (const name of activeMcpNames) {
        if (allServers[name]) selectedServers[name] = allServers[name]
      }
      await mgr.initialize(selectedServers)
      this.mcpManager = mgr
      console.log(`[CodeRunner] MCP servers loaded: ${activeMcpNames.join(', ')}`)
    }

    // 6. Create CodeAgent
    const AgentClass = CodeAgent as new (config: unknown) => {
      chat(prompt: string, onChunk?: (text: string) => void): Promise<{ content: string; toolsUsed: string[]; iterations: number }>
      cleanup(): Promise<void>
      resetConversation(): void
    }

    this.agent = new AgentClass({
      orchestrator: this.orchestrator,
      workspace: this.workspace,
      conversationManager: this.conversationManager,
      maxIterations: this.maxIterations,
      ...(this.mcpManager && activeMcpNames ? { mcpManager: this.mcpManager, mcpServerNames: activeMcpNames } : {}),
    })

    this.ready = true
    console.log(`[CodeRunner] Initialized (maxIterations=${this.maxIterations}, deepRun=${this.deepRun})`)
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
        console.warn('[CodeRunner] makeCompleter: chat() failed:', err)
        return null
      }
    }
  }

  async chat(
    prompt: string,
    onLog: (event: CodeLogEvent) => void,
    opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }
  ): Promise<CodeRunResult> {
    // Sync maxIterations from caller and propagate to agent instance lazily
    if (opts?.maxIterations !== undefined && opts.maxIterations !== this.maxIterations) {
      this.maxIterations = opts.maxIterations
      try { (this.agent as Record<string, unknown>).maxIterations = this.maxIterations } catch {}
    }

    const useDeepRun = opts?.deepRun !== false && (opts?.deepRun ?? this.deepRun)
    if (useDeepRun) {
      const result = await harness.run(
        prompt,
        this.makeCompleter(),
        (p, execOpts) => this.runChatWithIterations(p, onLog, execOpts?.maxIterations),
        (brainEvent) => onLog(brainEvent),
        this.maxIterations,
        opts?.conversationHistory || undefined
      )
      return result
    }
    return this.runChat(prompt, onLog)
  }

  private async runChatWithIterations(
    prompt: string,
    onLog: (event: CodeLogEvent) => void,
    maxIterations?: number
  ): Promise<CodeRunResult> {
    if (maxIterations !== undefined && maxIterations !== this.maxIterations) {
      this.maxIterations = maxIterations
      try { (this.agent as Record<string, unknown>).maxIterations = this.maxIterations } catch {}
    }
    return this.runChat(prompt, onLog)
  }

  /**
   * Attach a per-call handler to the jiva-core logger.
   * Tries multiple hook patterns since the logger's exact API is version-dependent.
   * Returns a cleanup function that removes the handler.
   */
  private hookLogger(onLog: (event: CodeLogEvent) => void): () => void {
    const log = this.codeLogger as Record<string, unknown> | null

    const emit = (level: string, tag: string, message: string) => {
      const lvl = level.toLowerCase()
      onLog({
        timestamp: new Date().toISOString(),
        level: (lvl === 'warn' || lvl === 'error' ? lvl : 'info') as CodeLogEvent['level'],
        tag,
        message,
      })
    }

    // Pattern 1: EventEmitter 'log' event
    if (log && typeof log.on === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (...args: any[]) => {
        if (args.length >= 3 && typeof args[0] === 'string') {
          emit(args[0], args[1] ?? 'CodeAgent', args[2])
        } else if (args.length >= 2 && typeof args[0] === 'string') {
          emit('info', 'CodeAgent', args[1])
        } else if (args.length >= 1 && typeof args[0] === 'object') {
          const e = args[0] as Record<string, unknown>
          emit(String(e.level ?? 'info'), String(e.tag ?? e.name ?? 'CodeAgent'), String(e.message ?? e.msg ?? ''))
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

    // Pattern 2: addTransport / addHandler / addSink
    if (log) {
      for (const addMethod of ['addTransport', 'addHandler', 'addSink']) {
        if (typeof log[addMethod] !== 'function') continue
        const removeMethod = addMethod.replace('add', 'remove')
        const transport = {
          write: (entry: Record<string, unknown>) => {
            emit(String(entry.level ?? 'info'), String(entry.tag ?? entry.name ?? 'CodeAgent'), String(entry.message ?? entry.msg ?? ''))
          },
          log: (entry: Record<string, unknown>) => {
            emit(String(entry.level ?? 'info'), String(entry.tag ?? entry.name ?? 'CodeAgent'), String(entry.message ?? entry.msg ?? ''))
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
    }

    // Pattern 3: stdout interception — fallback for loggers that write to stdout
    const origWrite = process.stdout.write.bind(process.stdout)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = (data: string | Uint8Array, ...args: any[]) => {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString()
      for (const line of text.split('\n')) {
        const structured = parseLogLine(line)
        if (structured) { onLog(structured); continue }
        // Lenient fallback: any line mentioning a tool call
        const toolMatch = /(?:tool(?:\s+call)?|calling|executing)[:\s]+([^\s(]+)/i.exec(line.trim())
        if (toolMatch) {
          onLog({ timestamp: new Date().toISOString(), level: 'info', tag: 'CodeAgent', message: `Tool: ${toolMatch[1]}` })
        }
      }
      return origWrite(data, ...args)
    }
    return () => { process.stdout.write = origWrite }
  }

  private async runChat(
    prompt: string,
    onLog: (event: CodeLogEvent) => void
  ): Promise<CodeRunResult> {
    if (!this.agent) {
      throw new Error('CodeRunner not initialized')
    }

    const agent = this.agent as {
      chat(prompt: string, onChunk?: (text: string) => void): Promise<{ content: string; toolsUsed: string[]; iterations: number }>
    }

    const unhook = this.hookLogger(onLog)

    try {
      const result = await agent.chat(prompt)

      // Emit one Tool: event per distinct tool used as a guaranteed fallback,
      // in case the logger hook didn't fire live events during execution
      if (result.toolsUsed?.length) {
        const seen = new Set<string>()
        for (const tool of result.toolsUsed) {
          if (!seen.has(tool)) {
            seen.add(tool)
            onLog({ timestamp: new Date().toISOString(), level: 'info', tag: 'CodeAgent', message: `Tool: ${tool}` })
          }
        }
      }

      return {
        content: result.content,
        toolsUsed: result.toolsUsed ?? [],
        iterations: result.iterations ?? 0,
      }
    } finally {
      unhook()
    }
  }

  stop(): void {
    if (this.agent) {
      (this.agent as { stop(): void }).stop()
    }
  }

  /**
   * Switch the reasoning model's defaultModel for dynamic mid-session model
   * selection. Same approach as JivaRunner.switchModel: jiva-core's
   * ModelOrchestrator has no live setter for its reasoning model, so this
   * persists the new choice and re-initializes with the same
   * workspace/MCP servers/settings, then reloads the current conversation
   * (if any) so history survives the swap.
   */
  async switchModel(model: string): Promise<void> {
    if (!this.lastWorkspaceDir) {
      throw new Error('CodeRunner not initialized')
    }
    const conversationId = this.getConversationId()

    const cfg = readConfig()
    if (cfg?.models?.reasoning) {
      cfg.models.reasoning.defaultModel = model
      writeConfig(cfg)
    }

    const workspaceDir = this.lastWorkspaceDir
    const mcpServerNames = this.lastMcpServerNames
    await this.cleanup()
    await this.initialize(workspaceDir, mcpServerNames, { deepRun: this.deepRun, maxIterations: this.maxIterations })

    if (conversationId) {
      await (this.agent as { loadConversation(id: string): Promise<void> }).loadConversation(conversationId)
    }
  }

  async cleanup(): Promise<void> {
    if (this.agent) {
      try {
        await (this.agent as { cleanup(): Promise<void> }).cleanup()
      } catch (err) {
        console.warn('[CodeRunner] Cleanup error:', err)
      }
    }
    if (this.mcpManager) {
      try {
        await (this.mcpManager as { cleanup(): Promise<void> }).cleanup()
      } catch {}
    }
    this.agent = null
    this.orchestrator = null
    this.workspace = null
    this.conversationManager = null
    this.mcpManager = null
    this.ready = false
  }
}
