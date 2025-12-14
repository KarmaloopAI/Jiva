/**
 * Jiva - Versatile Autonomous Agent
 *
 * Main exports for programmatic usage
 */

export { JivaAgent } from './core/agent.js';
export { DualAgent } from './core/dual-agent.js';
export { ManagerAgent } from './core/manager-agent.js';
export { WorkerAgent } from './core/worker-agent.js';
export { configManager, ConfigManager } from './core/config.js';
export { WorkspaceManager } from './core/workspace.js';

export { KrutrimModel, createKrutrimModel } from './models/krutrim.js';
export { ModelOrchestrator } from './models/orchestrator.js';

export { MCPClient } from './mcp/client.js';
export { MCPServerManager } from './mcp/server-manager.js';

export { logger, LogLevel } from './utils/logger.js';

export * from './utils/errors.js';
export * from './models/base.js';
export * from './models/harmony.js';
