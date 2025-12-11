import Conf from 'conf';
import { z } from 'zod';
import { ConfigurationError } from '../utils/errors.js';

// Zod schemas for validation
const MCPServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

const ModelConfigSchema = z.object({
  name: z.string(),
  endpoint: z.string().url(),
  apiKey: z.string(),
  type: z.enum(['reasoning', 'multimodal']),
  defaultModel: z.string(),
  useHarmonyFormat: z.boolean().optional(),
});

const JivaConfigSchema = z.object({
  models: z.object({
    reasoning: ModelConfigSchema.optional(),
    multimodal: ModelConfigSchema.optional(),
  }),
  mcpServers: z.record(MCPServerConfigSchema).optional(),
  workspace: z.object({
    defaultDirectivePath: z.string().optional(),
  }).optional(),
  debug: z.boolean().default(false),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type JivaConfig = z.infer<typeof JivaConfigSchema>;

export class ConfigManager {
  private store: Conf<JivaConfig>;
  private static instance: ConfigManager;

  private constructor() {
    this.store = new Conf<JivaConfig>({
      projectName: 'jiva',
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
    return !!(config.models?.reasoning?.apiKey || config.models?.multimodal?.apiKey);
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
    // Use /Users on macOS/Linux, C:\Users on Windows for broad access to user files
    if (!servers['filesystem']) {
      const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';
      this.addMCPServer('filesystem', {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
        enabled: true,
      });
    }

    // Note: @modelcontextprotocol/server-commands does not exist in npm registry
    // The official MCP servers are: filesystem, github, google-maps, slack, etc.
    // Users can add custom MCP servers via `jiva config`
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

    if (!config.models.reasoning.apiKey) {
      throw new ConfigurationError(
        'API key for reasoning model not configured.'
      );
    }

    // Multimodal model is optional
    if (config.models.multimodal && !config.models.multimodal.apiKey) {
      throw new ConfigurationError(
        'API key for multimodal model not configured.'
      );
    }
  }
}

export const configManager = ConfigManager.getInstance();
