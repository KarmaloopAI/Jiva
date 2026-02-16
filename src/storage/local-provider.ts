/**
 * LocalStorageProvider - Filesystem-based storage for CLI/Desktop
 * 
 * Maintains backward compatibility with existing ~/.jiva structure
 * 
 * In CLI mode, uses default tenant/session for backward compatibility
 * Context can be overridden via setContext() if needed
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { StorageProvider } from './provider.js';
import {
  StorageInfraConfig,
  SavedConversation,
  ConversationMetadata,
  JivaState,
} from './types.js';

// Default context for CLI mode (backward compatibility)
const CLI_DEFAULT_TENANT = 'local';
const CLI_DEFAULT_SESSION = 'cli-session';

export class LocalStorageProvider extends StorageProvider {
  private basePath: string;
  private configCache: Record<string, any> = {};

  constructor(infraConfig: StorageInfraConfig = {}) {
    super(infraConfig);
    this.basePath = infraConfig.basePath || path.join(homedir(), '.jiva');
    
    // Set default context for CLI mode (backward compatibility)
    // Cloud mode should call setContext() to override this
    this.context = {
      tenantId: CLI_DEFAULT_TENANT,
      sessionId: CLI_DEFAULT_SESSION,
    };
  }

  async initialize(): Promise<void> {
    // Ensure base directories exist
    const dirs = [
      this.basePath,
      path.join(this.basePath, 'conversations'),
      path.join(this.basePath, 'logs'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Load config into cache
    await this.loadConfigCache();
    
    this.initialized = true;
  }

  /**
   * Update session ID (useful for CLI when starting new conversation)
   */
  setSessionId(sessionId: string): void {
    if (!this.context) {
      this.context = { tenantId: CLI_DEFAULT_TENANT, sessionId };
    } else {
      this.context.sessionId = sessionId;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────

  private async loadConfigCache(): Promise<void> {
    const configPath = path.join(this.basePath, 'config.json');
    try {
      if (existsSync(configPath)) {
        const content = await fs.readFile(configPath, 'utf-8');
        this.configCache = JSON.parse(content);
      }
    } catch (error) {
      this.configCache = {};
    }
  }

  private async saveConfigCache(): Promise<void> {
    const configPath = path.join(this.basePath, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(this.configCache, null, 2));
  }

  async getConfig<T>(key: string): Promise<T | undefined> {
    return this.configCache[key] as T | undefined;
  }

  async setConfig<T>(key: string, value: T): Promise<void> {
    this.configCache[key] = value;
    await this.saveConfigCache();
  }

  async getAllConfig(): Promise<Record<string, any>> {
    return { ...this.configCache };
  }

  // ─────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────

  private getConversationFilePath(id: string): string {
    return path.join(this.basePath, 'conversations', `${id}.json`);
  }

  async saveConversation(conversation: SavedConversation): Promise<string> {
    const filePath = this.getConversationFilePath(conversation.metadata.id);
    await fs.writeFile(filePath, JSON.stringify(conversation, null, 2));
    return conversation.metadata.id;
  }

  async loadConversation(id: string): Promise<SavedConversation | null> {
    const filePath = this.getConversationFilePath(id);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SavedConversation;
    } catch (error) {
      return null;
    }
  }

  async listConversations(): Promise<ConversationMetadata[]> {
    const conversationsDir = path.join(this.basePath, 'conversations');
    
    try {
      const files = await fs.readdir(conversationsDir);
      const conversations: ConversationMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(
              path.join(conversationsDir, file),
              'utf-8'
            );
            const conv = JSON.parse(content) as SavedConversation;
            conversations.push(conv.metadata);
          } catch (error) {
            // Skip invalid files
          }
        }
      }

      // Sort by updated date, newest first
      return conversations.sort(
        (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async deleteConversation(id: string): Promise<void> {
    const filePath = this.getConversationFilePath(id);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Directive
  // ─────────────────────────────────────────────────────────────

  async loadDirective(workspacePath: string): Promise<string | undefined> {
    // Try multiple locations (matching existing workspace.ts logic)
    const candidates = [
      path.join(workspacePath, 'jiva-directive.md'),
      path.join(workspacePath, 'directive.md'),
      path.join(workspacePath, '.jiva', 'directive.md'),
    ];

    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          return await fs.readFile(candidate, 'utf-8');
        }
      } catch (error) {
        // Continue to next candidate
      }
    }

    return undefined;
  }

  async saveDirective(workspacePath: string, content: string): Promise<void> {
    const directivePath = path.join(workspacePath, 'jiva-directive.md');
    await fs.writeFile(directivePath, content);
  }

  // ─────────────────────────────────────────────────────────────
  // Logging
  // ─────────────────────────────────────────────────────────────

  async appendToLog(key: string, content: string): Promise<void> {
    // For local filesystem, append directly to file
    const logFile = path.join(this.basePath, key);
    const logDir = path.dirname(logFile);
    
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    await fs.appendFile(logFile, content);
  }

  async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const ctx = this.requireContext();
    const logsDir = path.join(this.basePath, 'logs');
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, `${ctx.sessionId}.log`);
    const logContent = this.logBuffer
      .map(entry => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.event}${entry.data ? ' ' + JSON.stringify(entry.data) : ''}`)
      .join('\n') + '\n';

    await fs.appendFile(logFile, logContent);
    this.clearLogBuffer();
  }

  // ─────────────────────────────────────────────────────────────
  // State Snapshots
  // ─────────────────────────────────────────────────────────────

  async exportState(): Promise<JivaState> {
    const ctx = this.requireContext();
    const conversation = await this.loadConversation(ctx.sessionId);
    
    return {
      version: '1.0.0',
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      exportedAt: new Date().toISOString(),
      config: await this.getAllConfig(),
      conversation,
      directive: undefined, // Loaded separately per workspace
      logBuffer: this.getLogBuffer(),
    };
  }

  async importState(state: JivaState): Promise<void> {
    // Set context from imported state
    this.setContext({
      tenantId: state.tenantId,
      sessionId: state.sessionId,
    });

    // Import config
    for (const [key, value] of Object.entries(state.config)) {
      await this.setConfig(key, value);
    }

    // Import conversation if present
    if (state.conversation) {
      await this.saveConversation(state.conversation);
    }

    // Import log buffer
    this.logBuffer = [...state.logBuffer];
  }
}
