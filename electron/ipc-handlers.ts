import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { execSync } from 'child_process'
import { JivaRunner } from './jiva-runner'
import { readConfig, writeConfig, getJivaConfigPath } from './config-manager'
import { listPersonas, activatePersona, getActivePersona } from './persona-manager'
import fs from 'fs'
import path from 'path'
import os from 'os'

export function setupIpcHandlers(
  jivaRunner: JivaRunner,
  getWindow: () => BrowserWindow | null
) {
  // --- Pre-flight setup check (fast, no agent needed) ---
  ipcMain.handle('setup:check', () => {
    // 1. Node.js — verify npm exists for the ok flag; separately get node version for display
    let nodejsOk = false
    let nodejsVersion: string | undefined
    try {
      execSync('npm --version', { timeout: 3000 })
      nodejsOk = true
      try {
        nodejsVersion = execSync('node --version', { timeout: 3000 })
          .toString().trim().replace(/^v/, '')  // "v20.11.0" → "20.11.0"
      } catch {}
    } catch {}

    // 2. jiva-core
    let jivaCoreOk = false
    let jivaCoreVersion: string | undefined
    if (nodejsOk) {
      try {
        const npmRoot = execSync('npm root -g', { timeout: 5000 }).toString().trim()
        const pkgJson = path.join(npmRoot, 'jiva-core', 'package.json')
        if (fs.existsSync(pkgJson)) {
          const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')) as { version?: string }
          jivaCoreVersion = pkg.version
          jivaCoreOk = true
        }
      } catch {}
      // Known macOS/Linux fallback
      if (!jivaCoreOk) {
        const known = path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'jiva-core', 'package.json')
        if (fs.existsSync(known)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(known, 'utf-8')) as { version?: string }
            jivaCoreVersion = pkg.version
            jivaCoreOk = true
          } catch {}
        }
      }
      // Windows fallback paths
      if (!jivaCoreOk && process.platform === 'win32') {
        const windowsPaths = [
          path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'package.json'),
          path.join(process.env.LOCALAPPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'package.json'),
        ]
        for (const wp of windowsPaths) {
          if (fs.existsSync(wp)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(wp, 'utf-8')) as { version?: string }
              jivaCoreVersion = pkg.version
              jivaCoreOk = true
              break
            } catch {}
          }
        }
      }
    }

    // 3. Configuration — check correct platform path first, fall back to legacy ~/.jiva
    const configCandidates = [
      getJivaConfigPath(),                                      // correct OS-specific path
      path.join(os.homedir(), '.jiva', 'config.json'),         // legacy fallback
    ]

    let configOk = false
    let foundConfigPath = ''
    for (const candidate of configCandidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        const cfg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Record<string, unknown>
        const reasoning = ((cfg?.models as Record<string, unknown>)?.reasoning ?? {}) as Record<string, unknown>
        const apiKey = ((reasoning?.apiKey ?? cfg?.apiKey) ?? '') as string
        if (apiKey.length > 0) {
          configOk = true
          foundConfigPath = candidate
          break
        }
      } catch {}
    }

    return {
      nodejs:   { ok: nodejsOk,   version: nodejsVersion },
      jivaCore: { ok: jivaCoreOk, version: jivaCoreVersion },
      config:   { ok: configOk,   path: foundConfigPath || configCandidates[0] },
      platform: process.platform,
    }
  })

  // Forward runner status changes to renderer
  jivaRunner.on('status-changed', (status, data) => {
    const win = getWindow()
    // Map runner status to the renderer-facing ServerStatus shape
    const serverStatus = status === 'ready' || status === 'busy' ? 'running' : status
    win?.webContents.send('jiva:server:status-changed', serverStatus, data)
  })

  // --- Jiva Lifecycle ---
  ipcMain.handle('jiva:server:start', async () => {
    try {
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }
      return { success: true, status: jivaRunner.getStatus() }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] jiva:server:start failed:', errorMsg)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle('jiva:server:stop', async () => {
    try {
      await jivaRunner.cleanup()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('jiva:server:restart', async () => {
    try {
      await jivaRunner.cleanup()
      await jivaRunner.initialize()
      return { success: true, status: jivaRunner.getStatus() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('jiva:server:status', () => {
    const status = jivaRunner.getStatus()
    return {
      status: status === 'ready' || status === 'busy' ? 'running' : status,
      port: 0,
    }
  })

  // --- Send Message (SDK-based, direct) ---
  // NOTE: Persona switching is intentionally NOT done here on every message.
  // The `persona` parameter is accepted but ignored to avoid destroying conversation history.
  // Persona switches happen only via the explicit `personas:activate` IPC call.
  ipcMain.handle('jiva:send-message', async (_event, prompt: string, _persona?: string) => {
    const win = getWindow()

    try {
      // Initialize if not ready
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }

      const result = await jivaRunner.chat(prompt, (phase) => {
        win?.webContents.send('jiva:phase-update', phase)
      })

      return { success: true, result, conversationId: result.conversationId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Reset conversation ---
  ipcMain.handle('jiva:reset-conversation', () => {
    jivaRunner.resetConversation()
    return { success: true }
  })

  // --- Load a past conversation into the agent ---
  ipcMain.handle('jiva:load-conversation', async (_event, id: string) => {
    try {
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }
      await jivaRunner.loadConversation(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Config ---
  ipcMain.handle('config:read', () => {
    return readConfig()
  })

  ipcMain.handle('config:write', (_event, config: unknown) => {
    return writeConfig(config as Parameters<typeof writeConfig>[0])
  })

  // --- Personas ---
  ipcMain.handle('personas:list', () => {
    return listPersonas()
  })

  ipcMain.handle('personas:activate', async (_event, name: string) => {
    const success = activatePersona(name)
    if (success) {
      // Switch agent to new persona
      try {
        await jivaRunner.switchPersona(name)
      } catch (err) {
        console.error('[IPC] Failed to switch persona:', err)
      }
    }
    return { success }
  })

  ipcMain.handle('personas:active', () => {
    return getActivePersona()
  })

  // --- Conversations ---
  ipcMain.handle('conversations:list', () => {
    const convsDir = path.join(os.homedir(), '.jiva', 'conversations')
    try {
      if (!fs.existsSync(convsDir)) return []
      const files = fs.readdirSync(convsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(convsDir, f)
          const stat = fs.statSync(filePath)
          try {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

            // Try metadata.title first (jiva-core nests title in metadata object),
            // then fall back to top-level summary/title, then extract from first user message
            let summary: string = raw.metadata?.title ?? raw.summary ?? raw.title ?? ''
            if (!summary && Array.isArray(raw.messages)) {
              const firstUser = raw.messages.find(
                (m: { role?: string; content?: unknown }) => m.role === 'user'
              )
              if (firstUser?.content) {
                const text =
                  typeof firstUser.content === 'string'
                    ? firstUser.content
                    : Array.isArray(firstUser.content)
                    ? firstUser.content
                        .filter((p: { type: string }) => p.type === 'text')
                        .map((p: { text?: string }) => p.text ?? '')
                        .join('')
                    : ''
                summary = text.slice(0, 60).replace(/\n/g, ' ')
                if (text.length > 60) summary += '...'
              }
            }
            summary = summary || 'Untitled'

            return {
              id: f.replace('.json', ''),
              summary,
              messageCount: raw.messages?.length ?? 0,
              lastModified: stat.mtimeMs,
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b!.lastModified - a!.lastModified))
      return files
    } catch {
      return []
    }
  })

  ipcMain.handle('conversations:load', (_event, id: string) => {
    const filePath = path.join(os.homedir(), '.jiva', 'conversations', `${id}.json`)
    try {
      if (!fs.existsSync(filePath)) return null
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  })

  // --- MCP Server Management ---

  ipcMain.handle('mcp:list-status', () => {
    try {
      const runtimeStatus = jivaRunner.getMCPServerStatus()
      const config = readConfig()
      const configServers = config?.mcpServers ?? {}
      const statusMap = new Map(runtimeStatus.map((s) => [s.name, s]))

      const allServers = Object.entries(configServers).map(([name, serverCfg]) => {
        const rt = statusMap.get(name)
        return {
          name,
          enabled: serverCfg.enabled ?? true,
          connected: rt?.connected ?? false,
          toolCount: rt?.toolCount ?? 0,
          command: serverCfg.command ?? '',
          args: serverCfg.args ?? [],
          env: serverCfg.env ?? {},
          url: (serverCfg as Record<string, unknown>).url as string | undefined,
          type: serverCfg.command ? 'stdio' : 'http',
          error: rt?.error,
        }
      })

      for (const rt of runtimeStatus) {
        if (!configServers[rt.name]) {
          allServers.push({
            name: rt.name,
            enabled: rt.enabled,
            connected: rt.connected,
            toolCount: rt.toolCount,
            command: '',
            args: [],
            env: {},
            url: undefined,
            type: 'stdio',
          })
        }
      }

      return allServers
    } catch {
      return []
    }
  })

  ipcMain.handle('mcp:get-tools', () => {
    try {
      return jivaRunner.getMCPTools()
    } catch {
      return {}
    }
  })

  ipcMain.handle('mcp:add-server', async (_event, name: string, serverConfig: {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    type: 'stdio' | 'http'
    enabled?: boolean
  }) => {
    try {
      const config = readConfig()
      if (!config) return { success: false, error: 'Config not found' }

      const mcpEntry: Record<string, unknown> = { enabled: serverConfig.enabled ?? true }
      if (serverConfig.type === 'stdio') {
        mcpEntry.command = serverConfig.command ?? ''
        mcpEntry.args = serverConfig.args ?? []
        if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
          mcpEntry.env = serverConfig.env
        }
      } else {
        mcpEntry.url = serverConfig.url ?? ''
        if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
          mcpEntry.env = serverConfig.env
        }
      }

      config.mcpServers = { ...(config.mcpServers ?? {}), [name]: mcpEntry as Parameters<typeof writeConfig>[0]['mcpServers'][string] }
      writeConfig(config)

      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.addMCPServer(name, mcpEntry)
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mcp:remove-server', async (_event, name: string) => {
    try {
      const config = readConfig()
      if (config?.mcpServers) {
        delete config.mcpServers[name]
        writeConfig(config)
      }
      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.removeMCPServer(name)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mcp:toggle-server', async (_event, name: string, enabled: boolean) => {
    try {
      const config = readConfig()
      if (config?.mcpServers?.[name]) {
        config.mcpServers[name].enabled = enabled
        writeConfig(config)
      }
      if (jivaRunner.getStatus() === 'ready' || jivaRunner.getStatus() === 'busy') {
        await jivaRunner.toggleMCPServer(name, enabled)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mcp:reconnect-server', async (_event, name: string) => {
    try {
      await jivaRunner.reconnectMCPServer(name)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Workspace / File Browser ---

  ipcMain.handle('workspace:get-dir', () => {
    const config = readConfig()
    return config?.workspaceDir ?? os.homedir()
  })

  ipcMain.handle('workspace:set-dir', (_event, dir: string) => {
    try {
      const config = readConfig() ?? { models: { reasoning: null } }
      writeConfig({ ...config, workspaceDir: dir })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('workspace:pick-dir', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('workspace:list-files', (_event, dirPath: string) => {
    try {
      // Security: must be within home dir
      const homeDir = os.homedir()
      const resolvedDir = path.resolve(dirPath)
      const resolvedHome = path.resolve(homeDir)
      if (!resolvedDir.startsWith(resolvedHome) && resolvedDir !== resolvedHome) {
        return []
      }
      if (!fs.existsSync(resolvedDir)) return []
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true })
      return entries
        .filter(e => !e.name.startsWith('.')) // hide hidden files
        .map(e => {
          const fullPath = path.join(resolvedDir, e.name)
          const stat = fs.statSync(fullPath)
          return {
            name: e.name,
            path: fullPath,
            isDirectory: e.isDirectory(),
            size: stat.size,
            modified: stat.mtimeMs,
          }
        })
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:read-file', (_event, filePath: string) => {
    try {
      // Security: must be within home dir
      const homeDir = os.homedir()
      const resolvedFile = path.resolve(filePath)
      const resolvedHome = path.resolve(homeDir)
      if (!resolvedFile.startsWith(resolvedHome)) return null

      if (!fs.existsSync(resolvedFile)) return null
      const stat = fs.statSync(resolvedFile)
      // Max 500KB — larger files shown as "too large"
      if (stat.size > 512 * 1024) return '[File too large to preview — open in an external editor]'
      return fs.readFileSync(resolvedFile, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('workspace:open-external', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // --- Window Controls ---
  ipcMain.handle('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    getWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return getWindow()?.isMaximized() ?? false
  })
}
