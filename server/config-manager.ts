import fs from 'fs'
import path from 'path'
import os from 'os'

/** Returns the platform-appropriate path where jiva-core stores its config.json */
export function getJivaConfigPath(): string {
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
      return path.join(appData, 'jiva-nodejs', 'Config', 'config.json')
    }
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Preferences', 'jiva-nodejs', 'config.json')
    default: // Linux and other unix (XDG-aware)
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        'jiva-nodejs', 'config.json'
      )
  }
}

const JIVA_CONFIG_PATH = getJivaConfigPath()

export interface JivaConfig {
  models: {
    reasoning: {
      provider?: string
      apiKey?: string
      endpoint?: string
      model?: string
      useHarmonyFormat?: boolean
    } | null
    multimodal?: unknown
  }
  mcpServers?: Record<string, {
    command?: string       // stdio servers: present; http servers: absent
    args?: string[]
    env?: Record<string, string>
    url?: string           // http servers
    enabled: boolean
  }>
  workspaceDir?: string  // configurable workspace directory for the Files browser
  userDirective?: string // user-authored directive prefix, prepended before dynamic context
  debug?: boolean
  autoSave?: boolean
}

export function readConfig(): JivaConfig | null {
  try {
    if (fs.existsSync(JIVA_CONFIG_PATH)) {
      const raw = fs.readFileSync(JIVA_CONFIG_PATH, 'utf-8')
      return JSON.parse(raw) as JivaConfig
    }
    return null
  } catch (err) {
    console.error('[ConfigManager] Failed to read config:', err)
    return null
  }
}

export function writeConfig(config: JivaConfig): boolean {
  try {
    const dir = path.dirname(JIVA_CONFIG_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(JIVA_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('[ConfigManager] Failed to write config:', err)
    return false
  }
}
