import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CodeRunner } from '../code-runner'
import { readConfig } from '../config-manager'
import { broadcast } from '../ws'

const MCP_SELECTIONS_PATH = path.join(os.homedir(), '.jiva', 'jivam-mcp-selections.json')

function readMcpSelections(): Record<string, string[]> {
  try {
    if (fs.existsSync(MCP_SELECTIONS_PATH)) {
      return JSON.parse(fs.readFileSync(MCP_SELECTIONS_PATH, 'utf-8')) as Record<string, string[]>
    }
  } catch {}
  return {}
}

export function createCodeRouter(codeRunner: CodeRunner) {
  const router = Router()

  router.post('/send-message', async (req, res) => {
    const { prompt, opts } = req.body as { prompt: string; opts?: { deepRun?: boolean } }
    try {
      if (!codeRunner.isReady()) {
        const config = readConfig()
        const workspaceDir = (config as unknown as Record<string, unknown>)?.workspaceDir as string | undefined ?? os.homedir()
        await codeRunner.initialize(workspaceDir)
      }
      const result = await codeRunner.chat(prompt, (event) => {
        broadcast('jiva:code-log', { event })
      }, opts)
      res.json({ success: true, ...result })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/stop-message', (_req, res) => {
    codeRunner.stop()
    res.json({ success: true })
  })

  router.post('/reset-session', async (_req, res) => {
    try {
      await codeRunner.cleanup()
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/init', async (req, res) => {
    const { dir, mcpServers, opts } = req.body as {
      dir: string; mcpServers?: string[]; opts?: { deepRun?: boolean; maxIterations?: number }
    }
    try {
      await codeRunner.initialize(dir, mcpServers, opts)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/restore-conversation', async (req, res) => {
    const { id } = req.body as { id: string }
    try {
      const meta = await codeRunner.restoreConversation(id)
      res.json({ success: true, ...meta })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/switch-model', async (req, res) => {
    const { model } = req.body as { model: string }
    try {
      await codeRunner.switchModel(model)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.get('/mcp-for-code', (_req, res) => {
    try {
      const config = readConfig()
      const servers = (config as unknown as Record<string, unknown>)?.mcpServers as Record<string, Record<string, unknown>> ?? {}
      res.json(Object.entries(servers).map(([name, cfg]) => ({
        name, enabled: (cfg.enabled ?? true) as boolean,
        codeMode: cfg.codeMode === true, command: (cfg.command ?? '') as string,
        url: cfg.url as string | undefined,
      })))
    } catch { res.json([]) }
  })

  router.get('/conversation-id', (_req, res) => {
    res.json(codeRunner.getConversationId())
  })

  router.get('/mcp-selection/:convId', (req, res) => {
    res.json(readMcpSelections()[req.params.convId] ?? [])
  })

  router.post('/mcp-selection', (req, res) => {
    const { convId, servers } = req.body as { convId: string; servers: string[] }
    try {
      const data = readMcpSelections()
      data[convId] = servers
      fs.mkdirSync(path.dirname(MCP_SELECTIONS_PATH), { recursive: true })
      fs.writeFileSync(MCP_SELECTIONS_PATH, JSON.stringify(data, null, 2))
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
