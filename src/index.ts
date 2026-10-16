/**
 * Jiva - Versatile Autonomous Agent
 *
 * Main exports for programmatic usage
 */

/** @deprecated Use DualAgent or CodeAgent. Kept for backward compatibility; will be removed. */
export { JivaAgent } from './core/agent.js';
export { DualAgent } from './core/dual-agent.js';
export { CodeAgent } from './code/agent.js';
export { LspManager } from './code/lsp/manager.js';
export { ManagerAgent } from './core/manager-agent.js';
export { WorkerAgent } from './core/worker-agent.js';
export { ClientAgent } from './core/client-agent.js';
export { configManager, ConfigManager } from './core/config.js';
export type { IAgent, AgentChatResponse } from './core/agent-interface.js';
export { WorkspaceManager } from './core/workspace.js';
export { ConversationManager } from './core/conversation-manager.js';

export { ModelClient, createModelClient } from './models/model-client.js';
// Backward-compat aliases (deprecated — use ModelClient / createModelClient)
export { KrutrimModel, createKrutrimModel } from './models/krutrim.js';
export { ModelOrchestrator } from './models/orchestrator.js';
export { modelClientConfigFromStored } from './models/client-config.js';
export type { ModelClientConfig } from './models/model-client.js';

// OpenRouter: provider routing config + helpers (provider discovery for UIs)
export {
  OpenRouterConfigSchema,
  OPENROUTER_ENDPOINT,
  OPENROUTER_API_BASE,
  isOpenRouterEndpoint,
  isOpenRouterModel,
  parseSlugList,
  normalizeSlugs,
  buildOpenRouterRouting,
  fetchModelProviderEndpoints,
  fetchOpenRouterModels,
  findUnknownSlugs,
} from './models/openrouter.js';
export type { OpenRouterConfig, OpenRouterProviderEndpoint, OpenRouterRoutingInfo, OpenRouterModelInfo } from './models/openrouter.js';

// Parallel tool execution
export { resolveToolExecutionSettings, DEFAULT_MAX_TOOL_CONCURRENCY } from './core/tool-scheduler.js';
export type { ToolExecutionSettingsInput, ToolAccess } from './core/tool-scheduler.js';
export type { TurnTiming, AgentResponse as CodeAgentResponse } from './code/agent.js';

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
