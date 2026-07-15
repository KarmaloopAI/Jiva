import fs from 'fs'
import path from 'path'
import os from 'os'

/** Returns the Jivam-specific config path (separate from jiva-core's global config). */
export function getJivamConfigPath(): string {
  return path.join(os.homedir(), '.jivam', 'config.json')
}

/**
 * Returns the path where jiva-core (the CLI) stores its own config.
 * Used for one-time migration only — Jivam never writes here directly.
 */
export function getJivaCoreConfigPath(): string {
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
      return path.join(appData, 'jiva-nodejs', 'Config', 'config.json')
    }
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Preferences', 'jiva-nodejs', 'config.json')
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        'jiva-nodejs', 'config.json'
      )
  }
}

/** @deprecated Use getJivamConfigPath() — kept for callers that haven't migrated yet */
export function getJivaConfigPath(): string {
  return getJivamConfigPath()
}

/**
 * On first run: if ~/.jivam/config.json doesn't exist but jiva-core's config does,
 * copy it so the user's existing `jiva setup` credentials carry over.
 * Jivam will manage its own copy from that point on.
 */
export function migrateFromJivaCoreIfNeeded(): void {
  const jivamPath = getJivamConfigPath()
  if (fs.existsSync(jivamPath)) return   // already set up, nothing to do

  const jivaCorePath = getJivaCoreConfigPath()
  if (!fs.existsSync(jivaCorePath)) return  // no jiva-core config to import

  try {
    const dir = path.dirname(jivamPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(jivaCorePath, jivamPath)
    console.log('[ConfigManager] Imported config from jiva-core:', jivamPath)
  } catch (err) {
    console.warn('[ConfigManager] Could not migrate jiva-core config:', err)
  }
}

const JIVAM_CONFIG_PATH = getJivamConfigPath()

export interface JivaReasoningConfig {
  provider?: string
  apiKey?: string
  endpoint?: string
  defaultModel?: string
  model?: string           // legacy alias — jiva-core reads defaultModel
  useHarmonyFormat?: boolean
  reasoningEffortStrategy?: string
  defaultMaxTokens?: number
  // Client-side proactive rate limit — max requests this model instance
  // sends per trailing 60s window (e.g. Sarvam's standard plan: 40/min).
  maxRequestsPerMinute?: number
  // Declares this reasoning model has native vision support, so image
  // content can be routed to it directly instead of through a separate
  // dedicated multimodal model's caption-then-forward pipeline.
  hasVision?: boolean
  name?: string
  type?: string
}

export interface JivaMultimodalConfig {
  apiKey?: string
  endpoint?: string
  defaultModel?: string
  name?: string
  type?: string
}

export interface JivaConfig {
  models: {
    reasoning: JivaReasoningConfig | null
    multimodal?: JivaMultimodalConfig | null
    toolCalling?: unknown
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
    const configPath = getJivamConfigPath()
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
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
    const configPath = getJivamConfigPath()
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('[ConfigManager] Failed to write config:', err)
    return false
  }
}
