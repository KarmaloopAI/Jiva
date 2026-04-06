/**
 * Evaluator module — public API.
 *
 * Usage (CLI):
 *   const harness = await createEvaluatorHarness(mainAgent, mcpServers, orchestratorConfig);
 *   const result = await harness.run(userMessage);
 *
 * Usage (HTTP):
 *   const harness = await createEvaluatorHarness(mainAgent, mcpServers, orchestratorConfig);
 *   app.post('/api/chat/harness', async (req, res) => {
 *     const result = await harness.run(req.body.message);
 *     res.json(result);
 *   });
 */

export { EvaluatorAgent } from './evaluator-agent.js';
export { EvaluatorHarness } from './harness.js';
export { deriveEvaluatorDirective } from './directive-adapter.js';
export {
  InteractWithAgentTool,
  ListAgentConversationsTool,
  GetConversationHistoryTool,
  EVALUATOR_VIRTUAL_TOOLS,
} from './tools/agent-tools.js';
export type {
  EvaluatorConfig,
  EvaluationContext,
  EvaluationResult,
  HarnessOptions,
  HarnessResult,
  EvaluatorToolContext,
} from './types.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

import { MCPServerManager } from '../mcp/server-manager.js';
import { ModelOrchestrator } from '../models/orchestrator.js';
import { createModelClient } from '../models/model-client.js';
import { EvaluatorAgent } from './evaluator-agent.js';
import { EvaluatorHarness } from './harness.js';
import type { IAgent } from '../core/agent-interface.js';
import type { MCPServerConfig } from '../core/config.js';
import type { HarnessOptions } from './types.js';

export interface EvaluatorOrchestratorConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  useHarmonyFormat?: boolean;
  /** Optional tool-calling model (same env vars as main agent). */
  toolCallingEndpoint?: string;
  toolCallingApiKey?: string;
  toolCallingModel?: string;
}

/**
 * Create an EvaluatorHarness that pairs the given main agent with a fresh,
 * isolated EvaluatorAgent.
 *
 * The evaluator uses the same model config and MCP servers as the main agent
 * but runs with completely separate LLM state.
 *
 * @param mainAgent        The IAgent instance to supervise.
 * @param mcpServers       MCP server configs (same set as the main agent uses).
 * @param orchestratorCfg  Model connection details for the evaluator's orchestrator.
 * @param harnessOptions   Optional harness behaviour tweaks.
 */
export async function createEvaluatorHarness(
  mainAgent: IAgent,
  mcpServers: Record<string, MCPServerConfig>,
  orchestratorCfg: EvaluatorOrchestratorConfig,
  harnessOptions: HarnessOptions = {},
): Promise<EvaluatorHarness> {
  // 1. Fresh orchestrator — isolated LLM state
  const reasoningModel = createModelClient({
    endpoint: orchestratorCfg.endpoint,
    apiKey: orchestratorCfg.apiKey,
    model: orchestratorCfg.model,
    type: 'reasoning',
    useHarmonyFormat: orchestratorCfg.useHarmonyFormat ?? false,
    defaultReasoningEffort: 'high',
  });

  let toolCallingModel;
  if (
    orchestratorCfg.toolCallingEndpoint &&
    orchestratorCfg.toolCallingApiKey &&
    orchestratorCfg.toolCallingModel
  ) {
    toolCallingModel = createModelClient({
      endpoint: orchestratorCfg.toolCallingEndpoint,
      apiKey: orchestratorCfg.toolCallingApiKey,
      model: orchestratorCfg.toolCallingModel,
      type: 'tool-calling',
      useHarmonyFormat: false,
      defaultReasoningEffort: 'medium',
    });
  }

  const orchestrator = new ModelOrchestrator({
    reasoningModel,
    toolCallingModel,
  });

  // 2. Fresh MCPServerManager — same servers, independent connections
  const mcpManager = new MCPServerManager();
  await mcpManager.initialize(mcpServers);

  // 3. Shared workspace (reads the same files as the main agent)
  const workspace = mainAgent.getWorkspace();

  // 4. Construct evaluator agent
  const evaluatorAgent = new EvaluatorAgent({
    orchestrator,
    mcpManager,
    workspace,
    targetAgent: mainAgent,
  });

  // 5. Wire into harness
  return new EvaluatorHarness(mainAgent, evaluatorAgent, harnessOptions);
}
