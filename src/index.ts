/**
 * Jiva - Versatile Autonomous Agent
 *
 * Main exports for programmatic usage
 */

export { JivaAgent } from './core/agent.js';
export { DualAgent } from './core/dual-agent.js';
export { ManagerAgent } from './core/manager-agent.js';
export { WorkerAgent } from './core/worker-agent.js';
export { ClientAgent } from './core/client-agent.js';
export { configManager, ConfigManager } from './core/config.js';
export { WorkspaceManager } from './core/workspace.js';
export { ConversationManager } from './core/conversation-manager.js';

export { KrutrimModel, createKrutrimModel } from './models/krutrim.js';
export { ModelOrchestrator } from './models/orchestrator.js';

export { MCPClient } from './mcp/client.js';
export { MCPServerManager } from './mcp/server-manager.js';

// Storage abstraction for cloud-native deployments
export * from './storage/index.js';

export { logger, LogLevel } from './utils/logger.js';

export * from './utils/errors.js';
export * from './models/base.js';
export * from './models/harmony.js';

// Agent context and completion signal types
export type { AgentContext } from './core/types/agent-context.js';
export type { CompletionSignal } from './core/types/completion-signal.js';
export { serializeAgentContext } from './core/utils/serialize-agent-context.js';
