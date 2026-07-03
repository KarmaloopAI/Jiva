import { ipcMain, BrowserWindow, dialog, shell, app } from 'electron'
import { execSync, execFileSync } from 'child_process'
import { JivaRunner } from './jiva-runner'
import type { CodeRunner } from './code-runner'
import { readConfig, writeConfig, getJivamConfigPath, migrateFromJivaCoreIfNeeded } from './config-manager'
import { writeDirective } from './directive-manager'
import { listPersonas, activatePersona, getActivePersona } from './persona-manager'
import { cloudSignIn, cloudSignUp, cloudSignOut, initCloudSession } from './cloud-auth'
import { CloudRunner } from './cloud-runner'
import { convertFile } from './file-converter'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Singleton CloudRunner — configured when user signs into cloud mode
const cloudRunner = new CloudRunner()

export function setupIpcHandlers(
  jivaRunner: JivaRunner,
  codeRunner: CodeRunner,
  getWindow: () => BrowserWindow | null
) {
  // --- Pre-flight setup check (fast, no agent needed) ---
  ipcMain.handle('setup:check', () => {
    // Migrate jiva-core config to Jivam's own path on first run
    migrateFromJivaCoreIfNeeded()

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

    // 3. Configuration — check Jivam's own config path
    const jivamConfigPath = getJivamConfigPath()
    let configOk = false
    let foundConfigPath = ''
    if (fs.existsSync(jivamConfigPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(jivamConfigPath, 'utf-8')) as Record<string, unknown>
        const reasoning = ((cfg?.models as Record<string, unknown>)?.reasoning ?? {}) as Record<string, unknown>
        const apiKey = ((reasoning?.apiKey ?? cfg?.apiKey) ?? '') as string
        if (apiKey.length > 0) {
          configOk = true
          foundConfigPath = jivamConfigPath
        }
      } catch {}
    }

    // 4. jiva-core version compatibility
    let jivaVersionMismatch = false
    let requiredJivaVersion: string | undefined
    try {
      // Read jivaCompatibleVersion from the bundled package.json
      const appPkgPath = path.join(__dirname, '..', 'package.json')
      const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf-8')) as Record<string, unknown>
      requiredJivaVersion = appPkg.jivaCompatibleVersion as string | undefined
      if (requiredJivaVersion && jivaCoreVersion) {
        // Compare major.minor — patch differences are fine
        const [reqMaj, reqMin] = requiredJivaVersion.split('.').map(Number)
        const [instMaj, instMin] = jivaCoreVersion.split('.').map(Number)
        if (reqMaj !== instMaj || reqMin !== instMin) {
          jivaVersionMismatch = true
        }
      }
    } catch {}

    return {
      nodejs:   { ok: nodejsOk,   version: nodejsVersion },
      jivaCore: { ok: jivaCoreOk, version: jivaCoreVersion },
      config:   { ok: configOk,   path: foundConfigPath || jivamConfigPath },
      platform: process.platform,
      jivaVersionMismatch,
      requiredJivaVersion,
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
  ipcMain.handle('jiva:send-message', async (event, prompt: string, _persona?: string, opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }) => {
    // Send phase and log events back to whichever window invoked this handler
    // (works for both the main local window and the separate cloud window)
    const sender = event.sender

    // Detect cloud window by URL param so we can wait for runner init
    const senderUrl = sender.getURL()
    const isCloudSender = senderUrl.includes('mode=cloud')

    try {
      // Cloud window path: wait for runner if init is in flight, then route to cloud
      if (isCloudSender) {
        if (!cloudRunner.isActive()) {
          await cloudRunner.waitUntilReady(30_000)
        }
        const result = await cloudRunner.chat(prompt, (phase) => {
          sender.send('jiva:phase-update', phase)
        }, opts, (logEvent) => {
          sender.send('jiva:jiva-log', logEvent)
        })
        return { success: true, result, conversationId: result.conversationId }
      }

      // Initialize local runner if not ready
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }

      const result = await jivaRunner.chat(prompt, (phase) => {
        sender.send('jiva:phase-update', phase)
      }, opts, (logEvent) => {
        sender.send('jiva:jiva-log', logEvent)
      })

      return { success: true, result, conversationId: result.conversationId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Stop active Jiva agent (cooperative: finishes current tool, then exits) ---
  ipcMain.handle('jiva:stop-message', () => {
    jivaRunner.stop()
    return { success: true }
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

  ipcMain.handle('config:get-path', () => {
    return getJivamConfigPath()
  })

  // --- Provider Quick Setup ---
  type ProviderKey = 'sarvam' | 'krutrim' | 'groq' | 'openai-compatible'

  const PROVIDER_PRESETS: Record<ProviderKey, {
    endpoint: string
    defaultModel: string
    useHarmonyFormat: boolean
    reasoningEffortStrategy: string
    defaultMaxTokens?: number
    multimodal: { defaultModel: string } | null
  }> = {
    sarvam: {
      endpoint: 'https://api.sarvam.ai/v1/chat/completions',
      defaultModel: 'sarvam-105b',
      useHarmonyFormat: false,
      reasoningEffortStrategy: 'api_param',
      defaultMaxTokens: 8192,
      multimodal: null,
    },
    krutrim: {
      endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
      defaultModel: 'gpt-oss-120b',
      useHarmonyFormat: true,
      reasoningEffortStrategy: 'system_prompt',
      multimodal: { defaultModel: 'Llama-4-Maverick-17B-128E-Instruct' },
    },
    groq: {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      defaultModel: 'openai/gpt-oss-120b',
      useHarmonyFormat: false,
      reasoningEffortStrategy: 'api_param',
      multimodal: { defaultModel: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
    },
    'openai-compatible': {
      endpoint: '',
      defaultModel: '',
      useHarmonyFormat: false,
      reasoningEffortStrategy: 'both',
      multimodal: null,
    },
  }

  ipcMain.handle('config:setup-provider', (_event, args: {
    provider: ProviderKey
    apiKey: string
    customEndpoint?: string
    customModel?: string
  }) => {
    try {
      const { provider, apiKey, customEndpoint, customModel } = args
      const preset = PROVIDER_PRESETS[provider]
      if (!preset) return { success: false, error: `Unknown provider: ${provider}` }

      const endpoint = provider === 'openai-compatible' ? (customEndpoint ?? '') : preset.endpoint
      const defaultModel = provider === 'openai-compatible' ? (customModel ?? '') : preset.defaultModel

      const existing = readConfig()
      const config = existing ?? { models: { reasoning: null } }

      config.models = {
        ...config.models,
        reasoning: {
          name: 'reasoning',
          type: 'reasoning',
          provider,
          endpoint,
          apiKey,
          defaultModel,
          useHarmonyFormat: preset.useHarmonyFormat,
          reasoningEffortStrategy: preset.reasoningEffortStrategy,
          ...(preset.defaultMaxTokens ? { defaultMaxTokens: preset.defaultMaxTokens } : {}),
        },
        multimodal: preset.multimodal
          ? {
              name: 'multimodal',
              type: 'multimodal',
              endpoint,
              apiKey,
              defaultModel: preset.multimodal.defaultModel,
            }
          : undefined,
      }

      // Ensure default MCP servers are configured
      if (!config.mcpServers) {
        const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users'
        config.mcpServers = {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
            enabled: true,
          },
          'mcp-shell-server': {
            command: 'npx',
            args: ['-y', '@mkusaka/mcp-shell-server'],
            enabled: true,
          },
        }
      }

      const ok = writeConfig(config)
      return { success: ok, error: ok ? undefined : 'Failed to write config' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
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
              type: (raw.metadata?.type ?? 'chat') as 'chat' | 'code',
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

  // --- File Attachment Handlers ---

  ipcMain.handle('file:pick-attachments', async (_event, includeImages: boolean) => {
    const win = getWindow()
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
    const docExts = ['pdf', 'docx']
    const textExts = [
      'txt', 'md', 'markdown', 'rst', 'log',
      'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
      'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
      'c', 'cpp', 'cc', 'h', 'hpp', 'cs',
      'css', 'scss', 'sass', 'less',
      'html', 'htm', 'xml', 'svg',
      'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
      'sh', 'bash', 'zsh', 'ps1', 'bat',
      'sql', 'graphql', 'proto',
      'env', 'dockerfile', 'makefile',
      'vue', 'svelte', 'astro', 'r', 'lua', 'scala',
    ]

    // Put a combined filter FIRST — on macOS the dialog defaults to the first entry,
    // so without this only the first category's extensions are visible.
    const allSupportedExts = includeImages
      ? [...imageExts, ...docExts, ...textExts]
      : [...docExts, ...textExts]

    const filters: Electron.FileFilter[] = [
      { name: 'All Supported Files', extensions: allSupportedExts },
      { name: 'Documents', extensions: docExts },
      { name: 'Text & Code', extensions: textExts },
    ]
    if (includeImages) {
      filters.push({ name: 'Images', extensions: imageExts })
    }

    const result = await dialog.showOpenDialog(win!, {
      title: 'Attach Files',
      properties: ['openFile', 'multiSelections'],
      filters,
    })

    if (result.canceled || result.filePaths.length === 0) return []
    return result.filePaths
  })

  ipcMain.handle('file:convert-attachment', (_event, filePath: string) => {
    // Security: must be within home dir
    const homeDir = os.homedir()
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(homeDir))) {
      return { name: path.basename(filePath), category: 'unsupported', markdown: '', error: 'Access denied: file is outside home directory' }
    }

    const result = convertFile(filePath)

    if (result.category === 'image' && !result.error) {
      // Copy image into <workspaceDir>/.jiva/uploads/ so the agent can reference it by path
      try {
        const config = readConfig()
        const workspaceDir = config?.workspaceDir ?? homeDir
        const uploadsDir = path.join(workspaceDir, '.jiva', 'uploads')
        fs.mkdirSync(uploadsDir, { recursive: true })
        const destPath = path.join(uploadsDir, path.basename(filePath))
        fs.copyFileSync(filePath, destPath)
        result.markdown = destPath
      } catch (err) {
        result.error = `Failed to save image to workspace: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    return result
  })

  ipcMain.handle('file:describe-image', async (_event, filePath: string) => {
    try {
      const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      }
      const mimeType = mimeMap[ext] ?? 'image/png'
      const base64 = fs.readFileSync(filePath).toString('base64')
      const dataUri = `data:${mimeType};base64,${base64}`
      const description = await jivaRunner.describeImage(dataUri)
      return { success: true, description }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- App Info ---
  ipcMain.handle('app:get-version', () => app.getVersion())

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

  // --- Code Mode: send message via CodeAgent ---
  ipcMain.handle('code:send-message', async (_event, prompt: string, opts?: { deepRun?: boolean; maxIterations?: number; conversationHistory?: string }) => {
    const win = getWindow()
    try {
      if (!codeRunner.isReady()) {
        const config = readConfig()
        const workspaceDir = (config as Record<string, unknown>)?.workspaceDir as string | undefined
          ?? os.homedir()
        await codeRunner.initialize(workspaceDir)
      }

      const result = await codeRunner.chat(prompt, (event) => {
        win?.webContents.send('jiva:code-log', event)
      }, opts)

      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Stop active Code agent (cooperative: finishes current tool, then exits) ---
  ipcMain.handle('code:stop-message', () => {
    codeRunner.stop()
    return { success: true }
  })

  // --- Reset / tear down CodeRunner so next code:init starts fresh ---
  ipcMain.handle('code:reset-session', async () => {
    try {
      await codeRunner.cleanup()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Git: check if directory is a git repo ---
  ipcMain.handle('git:is-repo', (_event, dir: string) => {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 3000 })
      return true
    } catch {
      return false
    }
  })

  // --- Git: get changed files (git status --porcelain) ---
  ipcMain.handle('git:status', (_event, dir: string) => {
    try {
      const output = execFileSync('git', ['status', '--porcelain'], { cwd: dir, timeout: 5000 }).toString()
      return output
        .split('\n')
        .filter(Boolean)
        .map(line => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(3).trim(),
        }))
    } catch {
      return []
    }
  })

  // --- Git: get unified diff for a specific file ---
  // status param: '??' = untracked, 'A' = staged new, others = modified/deleted/renamed
  ipcMain.handle('git:diff-file', (_event, dir: string, file: string, status?: string) => {
    try {
      // Untracked file — synthesise a diff showing all lines as additions
      if (status === '??') {
        const fullPath = path.join(dir, file)
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const lines = content.split('\n')
          if (lines[lines.length - 1] === '') lines.pop()
          const body = lines.map(l => `+${l}`).join('\n')
          return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}`
        } catch {
          return null
        }
      }

      // Staged new file — show what was added to the index
      if (status === 'A') {
        try {
          const diff = execFileSync('git', ['diff', '--cached', '--', file], { cwd: dir, timeout: 5000 }).toString()
          if (diff.trim()) return diff
        } catch {}
      }

      // Modified / deleted / renamed — diff HEAD covers staged + unstaged vs last commit
      try {
        const diff = execFileSync('git', ['diff', 'HEAD', '--', file], { cwd: dir, timeout: 5000 }).toString()
        if (diff.trim()) return diff
      } catch {}

      // Fallback: staged-only diff (e.g. AM — added to index, modified in worktree)
      try {
        const diff = execFileSync('git', ['diff', '--cached', '--', file], { cwd: dir, timeout: 5000 }).toString()
        if (diff.trim()) return diff
      } catch {}

      // Last resort: plain unstaged diff
      try {
        const diff = execFileSync('git', ['diff', '--', file], { cwd: dir, timeout: 5000 }).toString()
        if (diff.trim()) return diff
      } catch {}

      return null
    } catch {
      return null
    }
  })

  // --- Git: initialise a new repository in a directory ---
  ipcMain.handle('git:init-repo', (_event, dir: string) => {
    try {
      execFileSync('git', ['init'], { cwd: dir, timeout: 10000 })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Git: get current branch name + ahead/behind vs upstream ---
  ipcMain.handle('git:branch-info', (_event, dir: string) => {
    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: dir, timeout: 3000 }).toString().trim()

      let ahead = 0, behind = 0
      try {
        const tracking = execFileSync(
          'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
          { cwd: dir, timeout: 3000 }
        ).toString().trim()
        if (tracking) {
          const ab = execFileSync(
            'git', ['rev-list', '--left-right', '--count', `${tracking}...HEAD`],
            { cwd: dir, timeout: 3000 }
          ).toString().trim().split('\t')
          behind = parseInt(ab[0]) || 0
          ahead = parseInt(ab[1]) || 0
        }
      } catch { /* no upstream configured — leave 0/0 */ }

      return { branch, ahead, behind }
    } catch {
      return null
    }
  })

  // --- Code Mode: explicitly initialise CodeRunner with a chosen directory ---
  ipcMain.handle('code:init', async (_event, dir: string, mcpServers?: string[], opts?: { deepRun?: boolean; maxIterations?: number }) => {
    try {
      await codeRunner.initialize(dir, mcpServers, opts)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Code Mode: list all configured MCP servers available for code mode ---
  ipcMain.handle('code:list-mcp-for-code', () => {
    try {
      const config = readConfig()
      const servers = (config as Record<string, unknown>)?.mcpServers as Record<string, Record<string, unknown>> ?? {}
      return Object.entries(servers).map(([name, cfg]) => ({
        name,
        enabled: (cfg.enabled ?? true) as boolean,
        codeMode: cfg.codeMode === true,
        command: (cfg.command ?? '') as string,
        url: cfg.url as string | undefined,
      }))
    } catch {
      return []
    }
  })

  // --- Code Mode: get the active conversation ID from the runner ---
  ipcMain.handle('code:get-conversation-id', () => {
    return codeRunner.getConversationId()
  })

  // --- Code Mode: read/write per-conversation MCP selections (sidecar store) ---
  const MCP_SELECTIONS_PATH = path.join(os.homedir(), '.jiva', 'jivam-mcp-selections.json')

  function readMcpSelections(): Record<string, string[]> {
    try {
      if (fs.existsSync(MCP_SELECTIONS_PATH)) {
        return JSON.parse(fs.readFileSync(MCP_SELECTIONS_PATH, 'utf-8')) as Record<string, string[]>
      }
    } catch {}
    return {}
  }

  ipcMain.handle('code:get-mcp-selection', (_event, convId: string) => {
    return readMcpSelections()[convId] ?? []
  })

  ipcMain.handle('code:set-mcp-selection', (_event, convId: string, servers: string[]) => {
    try {
      const data = readMcpSelections()
      data[convId] = servers
      fs.mkdirSync(path.dirname(MCP_SELECTIONS_PATH), { recursive: true })
      fs.writeFileSync(MCP_SELECTIONS_PATH, JSON.stringify(data, null, 2))
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Directive: read user-editable directive prefix from config ---
  ipcMain.handle('directive:get', () => {
    const config = readConfig()
    return (config as Record<string, unknown>)?.userDirective as string ?? ''
  })

  // --- Directive: save user-editable directive prefix to config and immediately
  //     rewrite ~/.jiva/jiva-directive.md so the change is visible right away ---
  ipcMain.handle('directive:set', (_event, content: string) => {
    const config = readConfig() ?? { models: { reasoning: null } }
    writeConfig({ ...config, userDirective: content } as Parameters<typeof writeConfig>[0])
    // Rewrite the directive file immediately so it is up-to-date for the next agent session
    writeDirective(content || undefined)
    return { success: true }
  })

  // --- Cloud Mode: auth + session routing ---

  ipcMain.handle('cloud:sign-in', async (_event, email: string, password: string) => {
    try {
      const user = await cloudSignIn(email, password)
      return { userId: user.userId, email: user.email }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cloud:sign-up', async (_event, email: string, password: string) => {
    try {
      const user = await cloudSignUp(email, password)
      return { userId: user.userId, email: user.email }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cloud:sign-out', async () => {
    cloudRunner.deactivate()
  })

  ipcMain.handle('cloud:init', async (_event, userId: string, sessionId: string) => {
    cloudRunner.startInit()
    try {
      await initCloudSession(userId, sessionId)
      cloudRunner.configure(userId, sessionId)
      return { success: true }
    } catch (err) {
      cloudRunner.deactivate()
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
