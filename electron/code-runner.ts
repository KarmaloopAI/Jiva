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
  private ready = false
  private deepRun = false
  private maxIterations = 50

  isReady(): boolean {
    return this.ready
  }

  getConversationId(): string | null {
    if (!this.conversationManager) return null
    return (this.conversationManager as Record<string, unknown>).currentConversationId as string ?? null
  }

  async initialize(workspaceDir: string, mcpServerNames?: string[], opts?: { deepRun?: boolean; maxIterations?: number }): Promise<void> {
    this.deepRun = opts?.deepRun ?? false
    this.maxIterations = opts?.maxIterations ?? 50

    const entry = resolveJivaCoreEntryPath()
    console.log(`[CodeRunner] Loading jiva-core from: ${entry}`)

    const jiva = await import(pathToFileURL(entry).href)

    const {
      configManager,
      ModelOrchestrator,
      WorkspaceManager,
      ConversationManager,
      CodeAgent,
      MCPServerManager,
      createKrutrimModel,
      createLocalProvider,
    } = jiva as Record<string, unknown>

    // 1. Validate config
    ;(configManager as { validateConfig(): void }).validateConfig()

    const reasoningConfig = (configManager as {
      getReasoningModel(): { endpoint: string; apiKey: string; defaultModel: string; useHarmonyFormat?: boolean }
    }).getReasoningModel()

    // 2. Create model + orchestrator
    const createModel = createKrutrimModel as (config: unknown) => unknown
    const reasoningModel = createModel({
      endpoint: reasoningConfig.endpoint,
      apiKey: reasoningConfig.apiKey,
      model: reasoningConfig.defaultModel,
      type: 'reasoning',
      useHarmonyFormat: reasoningConfig.useHarmonyFormat,
    })

    const OrchestratorClass = ModelOrchestrator as new (config: unknown) => unknown
    this.orchestrator = new OrchestratorClass({ reasoningModel })

    // 3. Write directive + workspace
    const { path: directivePath } = writeDirective(
      (readConfig() as Record<string, unknown>)?.userDirective as string | undefined
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
      const allServers = (readConfig() as Record<string, unknown>)?.mcpServers as Record<string, unknown> ?? {}
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
      for (const method of ['complete', 'generateResponse', 'generate', 'chat', 'invoke']) {
        if (typeof orch[method] !== 'function') continue
        try {
          const fn = (orch[method] as (msgs: Array<{ role: string; content: string }>) => Promise<{ content: string }>).bind(orch)
          const result = await fn([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ])
          return result.content ?? null
        } catch {
          // try next method
        }
      }
      return null
    }
  }

  async chat(
    prompt: string,
    onLog: (event: CodeLogEvent) => void,
    opts?: { deepRun?: boolean }
  ): Promise<CodeRunResult> {
    const useDeepRun = opts?.deepRun ?? this.deepRun
    if (useDeepRun) {
      return harness.run(prompt, this.makeCompleter(), p => this.runChat(p, onLog))
    }
    return this.runChat(prompt, onLog)
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

    // Intercept stdout/stderr to capture structured log lines from jiva-core's logger
    const origStdoutWrite = process.stdout.write.bind(process.stdout)
    const origStderrWrite = process.stderr.write.bind(process.stderr)

    const intercept = (data: string | Uint8Array) => {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString()
      for (const line of text.split('\n')) {
        const evt = parseLogLine(line)
        if (evt) onLog(evt)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = (data: string | Uint8Array, ...args: any[]) => {
      intercept(data)
      return origStdoutWrite(data, ...args)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = (data: string | Uint8Array, ...args: any[]) => {
      intercept(data)
      return origStderrWrite(data, ...args)
    }

    try {
      const result = await agent.chat(prompt)
      return {
        content: result.content,
        toolsUsed: result.toolsUsed ?? [],
        iterations: result.iterations ?? 0,
      }
    } finally {
      process.stdout.write = origStdoutWrite
      process.stderr.write = origStderrWrite
    }
  }

  stop(): void {
    if (this.agent) {
      (this.agent as { stop(): void }).stop()
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
