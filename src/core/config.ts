import Conf from 'conf';
import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigurationError } from '../utils/errors.js';
import { getDefaultFilesystemAllowedPath } from '../utils/platform.js';

/**
 * Jiva's per-user data directory. Conversations and logs already live here
 * (see LocalStorageProvider); config.json now lives here too, unifying the
 * CLI's config storage with what the local (non-cloud) HTTP interface's
 * LocalStorageProvider was already using.
 */
const JIVA_HOME = path.join(os.homedir(), '.jiva');

/**
 * Where `conf` (via `projectName: 'jiva'`) used to store config.json, before
 * the move to JIVA_HOME. Same platform-specific resolution `conf` itself
 * used internally — kept here only to detect and migrate a pre-existing
 * config on first run after upgrading.
 */
function getLegacyConfigPath(): string {
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'jiva-nodejs', 'Config', 'config.json');
    }
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Preferences', 'jiva-nodejs', 'config.json');
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        'jiva-nodejs', 'config.json',
      );
  }
}

/**
 * One-time migration: if a config already exists at the new location
 * (JIVA_HOME/config.json), it's authoritative — leave it alone. Otherwise,
 * if a legacy config exists at the old platform-specific path, copy it to
 * the new location so existing users don't lose their configuration.
 *
 * Defensive: if something already exists at the new path by the time we go
 * to write (a race, or a stray file created between the check above and
 * now), it is backed up to config-backup.json first rather than clobbered.
 *
 * Returns a short message describing what happened, or null if nothing
 * needed to happen — callers (CLI, HTTP) print this so the migration is
 * visible rather than silent.
 */
export function migrateLegacyConfigIfNeeded(): string | null {
  const newPath = path.join(JIVA_HOME, 'config.json');
  if (fs.existsSync(newPath)) return null; // already using the new location

  const legacyPath = getLegacyConfigPath();
  if (!fs.existsSync(legacyPath)) return null; // fresh install, nothing to migrate

  fs.mkdirSync(JIVA_HOME, { recursive: true });

  let backupMessage = '';
  if (fs.existsSync(newPath)) {
    const backupPath = path.join(JIVA_HOME, 'config-backup.json');
    fs.copyFileSync(newPath, backupPath);
    backupMessage = ` (existing file at the new location backed up to ${backupPath})`;
  }

  fs.copyFileSync(legacyPath, newPath);
  return `Migrated config from ${legacyPath} to ${newPath}${backupMessage}`;
}

// Zod schemas for validation
// Support both stdio-based and HTTP/SSE-based MCP servers
const MCPServerConfigSchema = z.object({
  // Stdio transport (command-based)
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),

  // HTTP/SSE transport (URL-based)
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),

  enabled: z.boolean().default(true),
  /** When true, this server is automatically included in code mode without needing --mcp */
  codeMode: z.boolean().optional(),
}).refine(
  (data) => (data.command !== undefined) || (data.url !== undefined),
  { message: "Must specify either 'command' (for stdio) or 'url' (for HTTP/SSE)" }
);

const ModelConfigSchema = z.object({
  name: z.string().optional(),
  endpoint: z.string().url(),
  /**
   * Static API key. Not required (may be empty string) when useGoogleADC is true,
   * in which case short-lived GCP OAuth2 tokens are fetched automatically.
   */
  apiKey: z.string().default(''),
  type: z.enum(['reasoning', 'multimodal', 'tool-calling']).default('reasoning'),
  model: z.string().optional(),
  defaultModel: z.string().optional(),
  useHarmonyFormat: z.boolean().optional(),
  /**
   * True when this model instance itself has native vision/multimodal
   * capability, regardless of `type`. Lets a `reasoning`- (or `tool-calling`-)
   * typed model accept image content directly, without needing a separate
   * dedicated `multimodal` model configured for image captioning.
   */
  hasVision: z.boolean().optional(),
  /** How to send reasoning effort: 'api_param' | 'system_prompt' | 'both' */
  reasoningEffortStrategy: z.enum(['api_param', 'system_prompt', 'both']).optional(),
  /** Default max tokens — required for reasoning models like Sarvam-105B */
  defaultMaxTokens: z.number().optional(),
  /**
   * Client-side proactive rate limit — max requests this model instance will
   * send per trailing 60s window (e.g. Sarvam's standard plan: 40 req/min).
   * Model-agnostic: set for any provider with a known hard rate ceiling.
   */
  maxRequestsPerMinute: z.number().optional(),
  /**
   * Use Google Application Default Credentials instead of a static apiKey.
   * Required for Vertex AI MaaS endpoints (aiplatform.googleapis.com).
   * On Cloud Run the service account token is fetched automatically;
   * locally falls back to google-auth-library / `gcloud auth application-default`.
   */
  useGoogleADC: z.boolean().optional(),
});

const CodeModeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  lsp: z.object({
    enabled: z.boolean().default(true),
  }).optional(),
  maxIterations: z.number().default(50),
  includeMcp: z.boolean().default(false),
});

const JivaConfigSchema = z.object({
  models: z.object({
    reasoning: ModelConfigSchema.optional(),
    multimodal: ModelConfigSchema.optional(),
    toolCalling: ModelConfigSchema.optional(),
  }),
  mcpServers: z.record(MCPServerConfigSchema).optional(),
  workspace: z.object({
    defaultDirectivePath: z.string().optional(),
  }).optional(),
  activePersona: z.string().optional(),
  debug: z.boolean().default(false),
  codeMode: CodeModeConfigSchema.optional(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type CodeModeConfig = z.infer<typeof CodeModeConfigSchema>;
export type JivaConfig = z.infer<typeof JivaConfigSchema>;

export class ConfigManager {
  private store: Conf<JivaConfig>;
  private static instance: ConfigManager;
  /**
   * Set once, the first time the singleton is constructed, if a legacy
   * config was migrated to the new ~/.jiva/config.json location. CLI and
   * HTTP entry points should check this right after the first
   * `getInstance()` call and surface it (console/log) so the migration is
   * visible rather than silent.
   */
  static lastMigrationMessage: string | null = null;

  private constructor() {
    ConfigManager.lastMigrationMessage = migrateLegacyConfigIfNeeded();
    this.store = new Conf<JivaConfig>({
      // cwd takes priority over projectName for path resolution — this is
      // what actually pins storage to ~/.jiva/config.json. projectName is
      // still required by Conf's types even when cwd is set.
      projectName: 'jiva',
      cwd: JIVA_HOME,
    });
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  isConfigured(): boolean {
    const config = this.store.store;
    const r = config.models?.reasoning;
    const m = config.models?.multimodal;
    return !!(r?.apiKey || r?.useGoogleADC || m?.apiKey || m?.useGoogleADC);
  }

  getConfig(): JivaConfig {
    return this.store.store;
  }

  setReasoningModel(config: ModelConfig) {
    const validated = ModelConfigSchema.parse(config);
    this.store.set('models.reasoning', validated);
  }

  setMultimodalModel(config: ModelConfig) {
    const validated = ModelConfigSchema.parse(config);
    this.store.set('models.multimodal', validated);
  }

  getReasoningModel(): ModelConfig | undefined {
    return this.store.get('models.reasoning');
  }

  getMultimodalModel(): ModelConfig | undefined {
    return this.store.get('models.multimodal');
  }

  setToolCallingModel(config: ModelConfig) {
    const validated = ModelConfigSchema.parse(config);
    this.store.set('models.toolCalling', validated);
  }

  getToolCallingModel(): ModelConfig | undefined {
    return this.store.get('models.toolCalling');
  }

  addMCPServer(name: string, config: MCPServerConfig) {
    const validated = MCPServerConfigSchema.parse(config);
    this.store.set(`mcpServers.${name}`, validated);
  }

  removeMCPServer(name: string) {
    this.store.delete(`mcpServers.${name}`);
  }

  getMCPServers(): Record<string, MCPServerConfig> {
    return this.store.get('mcpServers', {});
  }

  getMCPServer(name: string): MCPServerConfig | undefined {
    return this.store.get(`mcpServers.${name}`);
  }

  setDebug(enabled: boolean) {
    this.store.set('debug', enabled);
  }

  isDebug(): boolean {
    return this.store.get('debug', false);
  }

  setDefaultDirectivePath(path: string) {
    this.store.set('workspace.defaultDirectivePath', path);
  }

  getDefaultDirectivePath(): string | undefined {
    return this.store.get('workspace.defaultDirectivePath');
  }

  setActivePersona(name: string | null) {
    if (name === null) {
      this.store.delete('activePersona');
    } else {
      this.store.set('activePersona', name);
    }
  }

  getActivePersona(): string | undefined {
    return this.store.get('activePersona');
  }

  getCodeMode(): CodeModeConfig | undefined {
    return this.store.get('codeMode');
  }

  setCodeModeEnabled(enabled: boolean) {
    const current = this.store.get('codeMode') || {};
    this.store.set('codeMode', { ...current, enabled });
  }

  reset() {
    this.store.clear();
  }

  getConfigPath(): string {
    return this.store.path;
  }

  /**
   * Initialize default MCP servers
   */
  initializeDefaultServers() {
    const servers = this.getMCPServers();

    // Add filesystem server if not exists (enabled by default)
    // Note: The filesystem MCP server rejects "/" as a security measure
    // Use /Users on macOS, /home on Linux, C:\Users on Windows for broad access to user files
    if (!servers['filesystem']) {
      const allowedPath = getDefaultFilesystemAllowedPath();
      this.addMCPServer('filesystem', {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
        enabled: true,
      });
    }

    // Add shell server if not exists — gives agents the ability to run shell commands
    if (!servers['mcp-shell-server']) {
      this.addMCPServer('mcp-shell-server', {
        command: 'npx',
        args: ['-y', '@mkusaka/mcp-shell-server'],
        enabled: true,
      });
    }
  }

  /**
   * Validate configuration and throw if invalid
   */
  validateConfig() {
    const config = this.getConfig();

    if (!config.models?.reasoning) {
      throw new ConfigurationError(
        'Reasoning model not configured. Please run setup wizard.'
      );
    }

    if (!config.models.reasoning.apiKey && !config.models.reasoning.useGoogleADC) {
      throw new ConfigurationError(
        'API key for reasoning model not configured. ' +
        'Either set apiKey or enable useGoogleADC for Vertex AI MaaS.'
      );
    }

    // Multimodal model is optional
    if (config.models.multimodal && !config.models.multimodal.apiKey && !config.models.multimodal.useGoogleADC) {
      throw new ConfigurationError(
        'API key for multimodal model not configured. ' +
        'Either set apiKey or enable useGoogleADC for Vertex AI MaaS.'
      );
    }
  }
}

export const configManager = ConfigManager.getInstance();
