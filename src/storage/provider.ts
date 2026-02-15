/**
 * StorageProvider - Abstract interface for state persistence
 * 
 * Enables Jiva to run on:
 * - Local filesystem (CLI, Desktop)
 * - Cloud storage (GCP Bucket, AWS S3)
 * - In-memory caches (Redis)
 * 
 * IMPORTANT: Context (tenantId, sessionId) must be set before operations
 * - CLI mode: Uses defaults automatically
 * - Cloud mode: Must call setContext() with values from JWT/auth
 */

import {
  StorageInfraConfig,
  StorageContext,
  SavedConversation,
  ConversationMetadata,
  LogEntry,
  JivaState,
} from './types.js';

export abstract class StorageProvider {
  protected infraConfig: StorageInfraConfig;
  protected context: StorageContext | null = null;
  protected logBuffer: LogEntry[] = [];
  protected initialized: boolean = false;

  constructor(infraConfig: StorageInfraConfig) {
    this.infraConfig = infraConfig;
  }

  /**
   * Initialize the storage provider (connect, verify access, etc.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Check if provider is ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ─────────────────────────────────────────────────────────────
  // Context Management (CRITICAL for multi-tenancy)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set the tenant and session context
   * MUST be called before any tenant-specific operations in cloud mode
   * 
   * @param context - Contains tenantId and sessionId from authenticated request
   */
  setContext(context: StorageContext): void {
    if (!context.tenantId || !context.sessionId) {
      throw new Error('Both tenantId and sessionId are required in StorageContext');
    }
    this.context = context;
  }

  /**
   * Get current context
   */
  getContext(): StorageContext | null {
    return this.context;
  }

  /**
   * Check if context is set and valid
   */
  hasContext(): boolean {
    return this.context !== null && 
           !!this.context.tenantId && 
           !!this.context.sessionId;
  }

  /**
   * Ensure context is set before operations
   * @throws Error if context not set
   */
  protected requireContext(): StorageContext {
    if (!this.context) {
      throw new Error(
        'Storage context not set. Call setContext({tenantId, sessionId}) before performing operations. ' +
        'In cloud mode, extract these from the authenticated JWT.'
      );
    }
    return this.context;
  }

  // ─────────────────────────────────────────────────────────────
  // Configuration (tenant-level)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a configuration value
   */
  abstract getConfig<T>(key: string): Promise<T | undefined>;

  /**
   * Set a configuration value
   */
  abstract setConfig<T>(key: string, value: T): Promise<void>;

  /**
   * Get all configuration as object
   */
  abstract getAllConfig(): Promise<Record<string, any>>;

  // ─────────────────────────────────────────────────────────────
  // Conversations (session-level)
  // ─────────────────────────────────────────────────────────────

  /**
   * Save a conversation
   * @returns The conversation ID
   */
  abstract saveConversation(conversation: SavedConversation): Promise<string>;

  /**
   * Load a conversation by ID
   */
  abstract loadConversation(id: string): Promise<SavedConversation | null>;

  /**
   * List all conversations for the tenant
   */
  abstract listConversations(): Promise<ConversationMetadata[]>;

  /**
   * Delete a conversation
   */
  abstract deleteConversation(id: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Directive (workspace-level)
  // ─────────────────────────────────────────────────────────────

  /**
   * Load directive content for a workspace
   * @param workspacePath - The workspace identifier/path
   */
  abstract loadDirective(workspacePath: string): Promise<string | undefined>;

  /**
   * Save directive content (for cloud scenarios where directive is uploaded)
   */
  abstract saveDirective(workspacePath: string, content: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Logging (session-level, buffered)
  // ─────────────────────────────────────────────────────────────

  /**
   * Append a log entry to the buffer
   * Logs are held in memory until flush() is called
   */
  appendLog(entry: LogEntry): void {
    this.logBuffer.push({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Flush buffered logs to persistent storage
   */
  abstract flushLogs(): Promise<void>;

  /**
   * Get current log buffer (for debugging)
   */
  getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Clear the log buffer
   */
  clearLogBuffer(): void {
    this.logBuffer = [];
  }

  // ─────────────────────────────────────────────────────────────
  // State Snapshots (for cloud functions)
  // ─────────────────────────────────────────────────────────────

  /**
   * Export complete state for cloud function handoff
   */
  abstract exportState(): Promise<JivaState>;

  /**
   * Import state from a previous export
   */
  abstract importState(state: JivaState): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Path Helpers (for implementations)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get the base path for a tenant
   * Format: {tenantId}/
   */
  protected getTenantPath(): string {
    const ctx = this.requireContext();
    return `${ctx.tenantId}/`;
  }

  /**
   * Get the path for a session
   * Format: {tenantId}/sessions/{sessionId}/
   */
  protected getSessionPath(): string {
    const ctx = this.requireContext();
    return `${ctx.tenantId}/sessions/${ctx.sessionId}/`;
  }

  /**
   * Get the path for conversations
   * Format: {tenantId}/conversations/
   */
  protected getConversationsPath(): string {
    const ctx = this.requireContext();
    return `${ctx.tenantId}/conversations/`;
  }

  /**
   * Get the path for config
   * Format: {tenantId}/config.json
   */
  protected getConfigPath(): string {
    const ctx = this.requireContext();
    return `${ctx.tenantId}/config.json`;
  }

  /**
   * Get the path for logs
   * Format: {tenantId}/logs/{sessionId}/
   */
  protected getLogsPath(): string {
    const ctx = this.requireContext();
    return `${ctx.tenantId}/logs/${ctx.sessionId}/`;
  }
}
