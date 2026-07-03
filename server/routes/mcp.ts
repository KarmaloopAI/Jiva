import { Router } from 'express'
import { readConfig, writeConfig } from '../config-manager'
import { JivaRunner } from '../jiva-runner'

export function createMcpRouter(jivaRunner: JivaRunner) {
  const router = Router()

  router.get('/status', (_req, res) => {
    try {
      const runtimeStatus = jivaRunner.getMCPServerStatus()
      const config = readConfig()
      const configServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; enabled: boolean }> = config?.mcpServers ?? {}
      const statusMap = new Map(runtimeStatus.map((s) => [s.name, s]))

      const allServers = Object.entries(configServers).map(([name, serverCfg]) => {
        const rt = statusMap.get(name)
        return {
          name, enabled: serverCfg.enabled ?? true,
          connected: rt?.connected ?? false, toolCount: rt?.toolCount ?? 0,
          command: serverCfg.command ?? '', args: serverCfg.args ?? [],
          env: serverCfg.env ?? {}, url: (serverCfg as Record<string, unknown>).url as string | undefined,
          type: serverCfg.command ? 'stdio' : 'http', error: rt?.error,
        }
      })
      for (const rt of runtimeStatus) {
        if (!configServers[rt.name]) {
          allServers.push({ name: rt.name, enabled: rt.enabled, connected: rt.connected,
            toolCount: rt.toolCount, command: '', args: [], env: {}, url: undefined, type: 'stdio', error: undefined })
        }
      }
      res.json(allServers)
    } catch { res.json([]) }
  })

  router.get('/tools', (_req, res) => {
    try { res.json(jivaRunner.getMCPTools()) } catch { res.json({}) }
  })

  router.post('/add', async (req, res) => {
    const { name, config: serverConfig } = req.body as {
      name: string
      config: { command?: string; args?: string[]; env?: Record<string, string>; url?: string; type: 'stdio' | 'http'; enabled?: boolean }
    }
    try {
      const config = readConfig()
      if (!config) return res.json({ success: false, error: 'Config not found' })
      const mcpEntry: Record<string, unknown> = { enabled: serverConfig.enabled ?? true }
      if (serverConfig.type === 'stdio') {
        mcpEntry.command = serverConfig.command ?? ''
        mcpEntry.args = serverConfig.args ?? []
        if (serverConfig.env && Object.keys(serverConfig.env).length > 0) mcpEntry.env = serverConfig.env
      } else {
        mcpEntry.url = serverConfig.url ?? ''
        if (serverConfig.env && Object.keys(serverConfig.env).length > 0) mcpEntry.env = serverConfig.env
      }
      if (!config.mcpServers) config.mcpServers = {}
      ;(config.mcpServers as unknown as Record<string, unknown>)[name] = mcpEntry
      writeConfig(config)
      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.addMCPServer(name, mcpEntry)
      }
      return res.json({ success: true })
    } catch (err) {
      return res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/remove', async (req, res) => {
    const { name } = req.body as { name: string }
    try {
      const config = readConfig()
      if (config?.mcpServers) { delete config.mcpServers[name]; writeConfig(config) }
      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.removeMCPServer(name)
      }
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/toggle', async (req, res) => {
    const { name, enabled } = req.body as { name: string; enabled: boolean }
    try {
      const config = readConfig()
      if (config?.mcpServers?.[name]) { config.mcpServers[name].enabled = enabled; writeConfig(config) }
      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.toggleMCPServer(name, enabled)
      }
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/reconnect', async (req, res) => {
    const { name } = req.body as { name: string }
    try {
      await jivaRunner.reconnectMCPServer(name)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
