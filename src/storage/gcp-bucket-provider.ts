/**
 * GCPBucketProvider - Google Cloud Storage based persistence
 * 
 * Path structure:
 * {bucket}/
 *   {tenantId}/
 *     config.json
 *     conversations/
 *       {conversationId}.json
 *     sessions/
 *       {sessionId}/
 *         state.json
 *     logs/
 *       {sessionId}.log
 *     directives/
 *       {workspaceHash}.md
 * 
 * IMPORTANT: In cloud mode, setContext() MUST be called with tenantId/sessionId
 * from the authenticated request (JWT) before any operations.
 */

import { StorageProvider } from './provider.js';
import {
  StorageInfraConfig,
  SavedConversation,
  ConversationMetadata,
  JivaState,
} from './types.js';
import { createHash } from 'crypto';
import { Storage, Bucket, File } from '@google-cloud/storage';

export class GCPBucketProvider extends StorageProvider {
  private bucket: Bucket | null = null;
  private bucketName: string;
  private configCache: Map<string, Record<string, any>> = new Map(); // Per-tenant config cache

  constructor(infraConfig: StorageInfraConfig) {
    super(infraConfig);
    
    if (!infraConfig.gcpBucketName) {
      throw new Error('GCP bucket name is required (gcpBucketName or JIVA_GCP_BUCKET env var)');
    }
    
    this.bucketName = infraConfig.gcpBucketName;
    // No default context - MUST be set via setContext() in cloud mode
  }

  async initialize(): Promise<void> {
    const storageOptions: { projectId?: string; keyFilename?: string } = {};
    
    if (this.infraConfig.gcpProjectId) {
      storageOptions.projectId = this.infraConfig.gcpProjectId;
    }
    
    if (this.infraConfig.gcpKeyFilePath) {
      storageOptions.keyFilename = this.infraConfig.gcpKeyFilePath;
    }
    // Otherwise uses Application Default Credentials (ADC)

    const storage = new Storage(storageOptions);
    this.bucket = storage.bucket(this.bucketName);

    // Verify bucket access
    try {
      await this.bucket.exists();
    } catch (error) {
      throw new Error(`Cannot access GCP bucket '${this.bucketName}': ${error}`);
    }
    
    this.initialized = true;
  }

  // ─────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────

  private async readJson<T>(path: string): Promise<T | null> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    try {
      const file = this.bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      
      const [content] = await file.download();
      return JSON.parse(content.toString('utf-8'));
    } catch (error) {
      return null;
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    const file = this.bucket.file(path);
    await file.save(JSON.stringify(data, null, 2), {
      contentType: 'application/json',
    });
  }

  private async writeText(path: string, content: string): Promise<void> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    const file = this.bucket.file(path);
    await file.save(content, {
      contentType: 'text/plain',
    });
  }

  private async readText(path: string): Promise<string | null> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    try {
      const file = this.bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      
      const [content] = await file.download();
      return content.toString('utf-8');
    } catch (error) {
      return null;
    }
  }

  private async deleteFile(path: string): Promise<void> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    try {
      await this.bucket.file(path).delete();
    } catch (error) {
      // Ignore if doesn't exist
    }
  }

  private async listFiles(prefix: string): Promise<string[]> {
    if (!this.bucket) throw new Error('Provider not initialized');
    
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f: File) => f.name);
  }

  private hashWorkspacePath(workspacePath: string): string {
    return createHash('sha256').update(workspacePath).digest('hex').substring(0, 16);
  }

  // ─────────────────────────────────────────────────────────────
  // Configuration (per-tenant, cached)
  // ─────────────────────────────────────────────────────────────

  private async loadConfigCache(): Promise<Record<string, any>> {
    const ctx = this.requireContext();
    
    // Check memory cache first
    if (this.configCache.has(ctx.tenantId)) {
      return this.configCache.get(ctx.tenantId)!;
    }
    
    // Load from storage
    const configPath = this.getConfigPath();
    const config = (await this.readJson<Record<string, any>>(configPath)) || {};
    this.configCache.set(ctx.tenantId, config);
    return config;
  }

  async getConfig<T>(key: string): Promise<T | undefined> {
    const config = await this.loadConfigCache();
    return config[key] as T | undefined;
  }

  async setConfig<T>(key: string, value: T): Promise<void> {
    const config = await this.loadConfigCache();
    config[key] = value;
    
    const ctx = this.requireContext();
    this.configCache.set(ctx.tenantId, config);
    await this.writeJson(this.getConfigPath(), config);
  }

  async getAllConfig(): Promise<Record<string, any>> {
    return { ...(await this.loadConfigCache()) };
  }

  // ─────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────

  private getConversationObjectPath(id: string): string {
    return `${this.getConversationsPath()}${id}.json`;
  }

  async saveConversation(conversation: SavedConversation): Promise<string> {
    const objectPath = this.getConversationObjectPath(conversation.metadata.id);
    await this.writeJson(objectPath, conversation);
    return conversation.metadata.id;
  }

  async loadConversation(id: string): Promise<SavedConversation | null> {
    const objectPath = this.getConversationObjectPath(id);
    return await this.readJson<SavedConversation>(objectPath);
  }

  async listConversations(): Promise<ConversationMetadata[]> {
    const prefix = this.getConversationsPath();
    const files = await this.listFiles(prefix);
    const conversations: ConversationMetadata[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const conv = await this.readJson<SavedConversation>(file);
        if (conv) {
          conversations.push(conv.metadata);
        }
      }
    }

    return conversations.sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  async deleteConversation(id: string): Promise<void> {
    const objectPath = this.getConversationObjectPath(id);
    await this.deleteFile(objectPath);
  }

  // ─────────────────────────────────────────────────────────────
  // Directive
  // ─────────────────────────────────────────────────────────────

  async loadDirective(workspacePath: string): Promise<string | undefined> {
    const hash = this.hashWorkspacePath(workspacePath);
    const objectPath = `${this.getTenantPath()}directives/${hash}.md`;
    const content = await this.readText(objectPath);
    return content || undefined;
  }

  async saveDirective(workspacePath: string, content: string): Promise<void> {
    const hash = this.hashWorkspacePath(workspacePath);
    const objectPath = `${this.getTenantPath()}directives/${hash}.md`;
    await this.writeText(objectPath, content);
  }

  // ─────────────────────────────────────────────────────────────
  // Logging
  // ─────────────────────────────────────────────────────────────

  async appendToLog(key: string, content: string): Promise<void> {
    try {
      // Read existing content, append new content, write back
      const existingContent = await this.readText(key);
      const newContent = existingContent ? existingContent + content : content;
      await this.writeText(key, newContent);
    } catch (error) {
      // If file doesn't exist, create it
      if ((error as any)?.code === 404) {
        await this.writeText(key, content);
      } else {
        throw error;
      }
    }
  }

  async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logPath = `${this.getLogsPath()}orchestration.log`;
    const logContent = this.logBuffer
      .map(entry => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.event}${entry.data ? ' ' + JSON.stringify(entry.data) : ''}`)
      .join('\n') + '\n';

    // Append to existing log or create new
    const existingContent = await this.readText(logPath);
    const newContent = existingContent ? existingContent + logContent : logContent;
    
    await this.writeText(logPath, newContent);
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
      directive: undefined,
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
    const ctx = this.requireContext();
    this.configCache.set(ctx.tenantId, state.config);
    await this.writeJson(this.getConfigPath(), state.config);

    // Import conversation if present
    if (state.conversation) {
      await this.saveConversation(state.conversation);
    }

    // Import log buffer
    this.logBuffer = [...state.logBuffer];
  }

  /**
   * Save complete state snapshot for cloud function handoff
   */
  async saveStateSnapshot(state: JivaState): Promise<void> {
    const snapshotPath = `${this.getSessionPath()}state.json`;
    await this.writeJson(snapshotPath, state);
  }

  /**
   * Load state snapshot for cloud function restoration
   */
  async loadStateSnapshot(): Promise<JivaState | null> {
    const snapshotPath = `${this.getSessionPath()}state.json`;
    return await this.readJson<JivaState>(snapshotPath);
  }
}
