/**
 * Session Manager - Lifecycle management for DualAgent sessions
 * 
 * Responsibilities:
 * - Create/destroy DualAgent instances per session
 * - Track active sessions and enforce limits
 * - Handle idle timeouts
 * - Per-session MCP server initialization
 * - State persistence on shutdown
 */

import { EventEmitter } from 'events';
import { DualAgent } from '../../core/dual-agent.js';
import { ModelOrchestrator } from '../../models/orchestrator.js';
import { MCPServerManager } from '../../mcp/server-manager.js';
import { WorkspaceManager } from '../../core/workspace.js';
import { ConversationManager } from '../../core/conversation-manager.js';
import { StorageProvider } from '../../storage/provider.js';
import { logger } from '../../utils/logger.js';
import { orchestrationLogger } from '../../utils/orchestration-logger.js';
import { createKrutrimModel } from '../../models/krutrim.js';
import { Message } from '../../models/base.js';
import { PersonaManager } from '../../personas/persona-manager.js';

export interface SessionConfig {
  storageProvider: StorageProvider;
  maxConcurrentSessions: number;
  idleTimeoutMs: number;
}

export interface SessionInfo {
  sessionId: string;
  tenantId: string;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  status: 'initializing' | 'active' | 'idle' | 'closing';
}

interface ActiveSession {
  agent: DualAgent;
  mcpManager: MCPServerManager;
  workspace: WorkspaceManager;
  conversationManager: ConversationManager;
  personaManager: PersonaManager;
  info: SessionInfo;
  idleTimer?: NodeJS.Timeout;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private config: SessionConfig;

  constructor(config: SessionConfig) {
    super();
    this.config = config;
    logger.info(`[SessionManager] Initialized (max: ${config.maxConcurrentSessions}, timeout: ${config.idleTimeoutMs}ms)`);
  }

  /**
   * Get or create a session
   */
  async getOrCreateSession(tenantId: string, sessionId: string): Promise<DualAgent> {
    const key = this.getSessionKey(tenantId, sessionId);

    // Return existing session
    if (this.sessions.has(key)) {
      const session = this.sessions.get(key)!;
      this.resetIdleTimer(key);
      session.info.lastActivityAt = new Date();
      session.info.status = 'active';
      logger.debug(`[SessionManager] Reusing session: ${key}`);
      return session.agent;
    }

    // Check session limit
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      // Try to clean up idle sessions
      await this.cleanupIdleSessions();
      
      if (this.sessions.size >= this.config.maxConcurrentSessions) {
        throw new Error(`Maximum concurrent sessions reached (${this.config.maxConcurrentSessions})`);
      }
    }

    // Create new session
    logger.info(`[SessionManager] Creating session: ${key}`);
    const session = await this.createSession(tenantId, sessionId);
    this.sessions.set(key, session);
    this.resetIdleTimer(key);

    // Configure logger and orchestration logger for this session
    logger.setSessionId(sessionId);
    orchestrationLogger.setStorageProvider(this.config.storageProvider, sessionId);

    this.emit('sessionCreated', { tenantId, sessionId });
    return session.agent;
  }

  /**
   * Create a new session with all components
   */
  private async createSession(tenantId: string, sessionId: string): Promise<ActiveSession> {
    const info: SessionInfo = {
      sessionId,
      tenantId,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      messageCount: 0,
      status: 'initializing',
    };

    try {
      // Set storage context
      this.config.storageProvider.setContext({ tenantId, sessionId });

      // Load or create config
      let modelConfig = await this.config.storageProvider.getConfig<{
        reasoning: {
          provider: string;
          apiKey: string;
          endpoint: string;
          model: string;
        };
        multimodal: null;
      }>('models');
      
      // Always use environment variables if set, otherwise use stored config or defaults
      const envEndpoint = process.env.JIVA_MODEL_BASE_URL;
      const envApiKey = process.env.JIVA_MODEL_API_KEY;
      const envModel = process.env.JIVA_MODEL_NAME;
      
      if (!modelConfig) {
        // Use environment defaults
        modelConfig = {
          reasoning: {
            provider: process.env.JIVA_MODEL_PROVIDER || 'krutrim',
            apiKey: envApiKey || '',
            endpoint: envEndpoint || 'https://cloud.olakrutrim.com/v1/chat/completions',
            model: envModel || 'gpt-oss-120b',
          },
          multimodal: null, // Optional
        };
        await this.config.storageProvider.setConfig('models', modelConfig);
      } else {
        // Override stored config with environment variables if present
        if (envEndpoint) modelConfig.reasoning.endpoint = envEndpoint;
        if (envApiKey) modelConfig.reasoning.apiKey = envApiKey;
        if (envModel) modelConfig.reasoning.model = envModel;
      }

      // Create model orchestrator
      const reasoningModel = createKrutrimModel({
        endpoint: modelConfig.reasoning.endpoint,
        apiKey: modelConfig.reasoning.apiKey,
        model: modelConfig.reasoning.model,
        type: 'reasoning',
        useHarmonyFormat: true, // gpt-oss-120b requires Harmony format
      });

      const orchestrator = new ModelOrchestrator({
        reasoningModel,
        multimodalModel: undefined,
      });

      // Initialize MCP servers per-session
      const mcpManager = new MCPServerManager();
      
      // Ensure base filesystem MCP server is always available
      const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';
      const baseMcpServers: Record<string, any> = {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
          enabled: true,
        }
      };
      
      // Load MCP server config from storage
      const mcpConfig = await this.config.storageProvider.getConfig<Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>>('mcpServers');
      if (mcpConfig && Array.isArray(mcpConfig)) {
        for (const serverConfig of mcpConfig) {
          // Add to base servers (will override filesystem if configured)
          baseMcpServers[serverConfig.name] = {
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env,
            enabled: true,
          };
        }
      }
      
      // Initialize all MCP servers (base + configured)
      await mcpManager.initialize(baseMcpServers);

      // Initialize workspace
      const workspace = new WorkspaceManager(this.config.storageProvider);
      await workspace.initialize();

      // Initialize conversation manager
      const conversationManager = new ConversationManager(this.config.storageProvider);

      // Initialize persona manager with per-tenant storage provider
      // This ensures persona config is isolated per tenant, not shared globally
      const personaManager = new PersonaManager([], false, this.config.storageProvider);
      await personaManager.initialize();

      // Merge persona MCP servers with session MCP servers
      const personaMCPServers = personaManager.getPersonaMCPServers();
      if (Object.keys(personaMCPServers).length > 0) {
        logger.info(`[SessionManager] Adding ${Object.keys(personaMCPServers).length} MCP servers from active persona`);
        
        for (const [name, config] of Object.entries(personaMCPServers)) {
          try {
            await mcpManager.addServer(name, config as any);
            logger.success(`[SessionManager] Added persona MCP server: ${name}`);
          } catch (error) {
            logger.warn(`[SessionManager] Failed to add persona MCP server '${name}': ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // Load or create conversation
      const existingConversation = await this.config.storageProvider.loadConversation(sessionId);
      let conversationHistory: Message[] = [];
      
      if (existingConversation) {
        conversationHistory = existingConversation.messages;
        info.messageCount = conversationHistory.length;
        logger.info(`[SessionManager] Restored conversation: ${conversationHistory.length} messages`);
      }

      // Create DualAgent
      const agent = new DualAgent({
        orchestrator,
        mcpManager,
        workspace,
        conversationManager,
        personaManager,
        maxSubtasks: 20,
        maxIterations: 10,
        autoSave: true, // Always auto-save in cloud mode
      });

      info.status = 'active';

      return {
        agent,
        mcpManager,
        workspace,
        conversationManager,
        personaManager,
        info,
      };

    } catch (error) {
      logger.error(`[SessionManager] Failed to create session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Destroy a session and persist state
   */
  async destroySession(tenantId: string, sessionId: string): Promise<void> {
    const key = this.getSessionKey(tenantId, sessionId);
    const session = this.sessions.get(key);

    if (!session) {
      logger.debug(`[SessionManager] Session not found: ${key}`);
      return;
    }

    logger.info(`[SessionManager] Destroying session: ${key}`);
    session.info.status = 'closing';

    // Clear idle timer
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    try {
      // Persist conversation state
      const conversationHistory = session.agent.getConversationHistory();
      if (conversationHistory.length > 0) {
        await this.config.storageProvider.saveConversation({
          metadata: {
            id: sessionId,
            created: session.info.createdAt.toISOString(),
            updated: new Date().toISOString(),
            messageCount: conversationHistory.length,
          },
          messages: conversationHistory,
        });
        logger.debug(`[SessionManager] Persisted ${conversationHistory.length} messages`);
      }

      // Flush orchestration logs
      await orchestrationLogger.flush();

      // Flush structured logs
      await this.config.storageProvider.flushLogs();

      // Clean up session-specific logger context
      logger.clearSessionContext(sessionId);

      // Cleanup MCP servers
      await session.mcpManager.cleanup();

    } catch (error) {
      logger.error(`[SessionManager] Error persisting session ${key}:`, error);
    }

    this.sessions.delete(key);
    this.emit('sessionDestroyed', { tenantId, sessionId });
    logger.info(`[SessionManager] Session destroyed: ${key}`);
  }

  /**
   * Get session info
   */
  getSessionInfo(tenantId: string, sessionId: string): SessionInfo | null {
    const key = this.getSessionKey(tenantId, sessionId);
    const session = this.sessions.get(key);
    return session ? { ...session.info } : null;
  }

  /**
   * List all active sessions for a tenant
   */
  listSessions(tenantId: string): SessionInfo[] {
    const sessions: SessionInfo[] = [];
    for (const [key, session] of this.sessions) {
      if (key.startsWith(`${tenantId}:`)) {
        sessions.push({ ...session.info });
      }
    }
    return sessions;
  }

  /**
   * Update activity timestamp (call on each message)
   */
  updateActivity(tenantId: string, sessionId: string): void {
    const key = this.getSessionKey(tenantId, sessionId);
    const session = this.sessions.get(key);
    
    if (session) {
      session.info.lastActivityAt = new Date();
      session.info.messageCount++;
      this.resetIdleTimer(key);
      
      // Ensure logger knows current session context
      logger.setSessionId(sessionId);
    }
  }

  /**
   * Reset idle timer for a session
   */
  private resetIdleTimer(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;

    // Clear existing timer
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    // Set new timer
    session.idleTimer = setTimeout(async () => {
      logger.info(`[SessionManager] Session idle timeout: ${key}`);
      const [tenantId, sessionId] = key.split(':');
      await this.destroySession(tenantId, sessionId);
    }, this.config.idleTimeoutMs);
  }

  /**
   * Cleanup idle sessions
   */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const toDestroy: Array<{ tenantId: string; sessionId: string }> = [];

    for (const [key, session] of this.sessions) {
      const idleMs = now - session.info.lastActivityAt.getTime();
      if (idleMs > this.config.idleTimeoutMs) {
        const [tenantId, sessionId] = key.split(':');
        toDestroy.push({ tenantId, sessionId });
      }
    }

    for (const { tenantId, sessionId } of toDestroy) {
      await this.destroySession(tenantId, sessionId);
    }

    if (toDestroy.length > 0) {
      logger.info(`[SessionManager] Cleaned up ${toDestroy.length} idle session(s)`);
    }
  }

  /**
   * Shutdown all sessions gracefully
   */
  async shutdown(): Promise<void> {
    logger.info(`[SessionManager] Shutting down ${this.sessions.size} session(s)...`);
    
    const shutdownPromises: Promise<void>[] = [];
    for (const [key] of this.sessions) {
      const [tenantId, sessionId] = key.split(':');
      shutdownPromises.push(this.destroySession(tenantId, sessionId));
    }

    await Promise.all(shutdownPromises);
    logger.info('[SessionManager] All sessions shut down');
  }

  /**
   * Get stats
   */
  getStats(): { total: number; byTenant: Record<string, number> } {
    const byTenant: Record<string, number> = {};
    
    for (const [key] of this.sessions) {
      const tenantId = key.split(':')[0];
      byTenant[tenantId] = (byTenant[tenantId] || 0) + 1;
    }

    return {
      total: this.sessions.size,
      byTenant,
    };
  }

  private getSessionKey(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }
}
