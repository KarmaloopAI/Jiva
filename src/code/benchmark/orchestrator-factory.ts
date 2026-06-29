/**
 * Shared ModelOrchestrator builder for the benchmark, used by both the CLI
 * command and the HTTP route. Mirrors the model-construction logic in the CLI
 * `run` command so benchmarks exercise exactly the same model stack a real
 * code-mode session would.
 */

import { createModelClient } from '../../models/model-client.js';
import { ModelOrchestrator } from '../../models/orchestrator.js';

/** Subset of the stored ModelConfig shape we need to build a client. */
export interface ModelConfigInput {
  endpoint: string;
  apiKey?: string;
  /** Preferred model id; `defaultModel` is the config-store alias. */
  model?: string;
  defaultModel?: string;
  useHarmonyFormat?: boolean;
  defaultReasoningEffort?: 'low' | 'medium' | 'high';
  reasoningEffortStrategy?: 'api_param' | 'system_prompt' | 'both';
  defaultMaxTokens?: number;
  useGoogleADC?: boolean;
}

export interface OrchestratorInput {
  reasoning: ModelConfigInput;
  multimodal?: ModelConfigInput;
  toolCalling?: ModelConfigInput;
  /** When true, ping each model first; throws if the reasoning model is unreachable. */
  testConnectivity?: boolean;
  /** Optional progress logger. */
  log?: (msg: string) => void;
}

export interface OrchestratorBundle {
  orchestrator: ModelOrchestrator;
  /** A short label for reports, e.g. the reasoning model id. */
  modelLabel: string;
}

function resolveModelId(cfg: ModelConfigInput): string {
  return cfg.model || cfg.defaultModel || '';
}

function buildClient(cfg: ModelConfigInput, type: 'reasoning' | 'multimodal' | 'tool-calling') {
  return createModelClient({
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey ?? '',
    model: resolveModelId(cfg),
    type,
    useHarmonyFormat: cfg.useHarmonyFormat,
    defaultReasoningEffort: cfg.defaultReasoningEffort,
    reasoningEffortStrategy: cfg.reasoningEffortStrategy,
    defaultMaxTokens: cfg.defaultMaxTokens,
    useGoogleADC: cfg.useGoogleADC,
  });
}

export async function createOrchestrator(input: OrchestratorInput): Promise<OrchestratorBundle> {
  const log = input.log ?? (() => {});

  if (!input.reasoning?.endpoint) {
    throw new Error('A reasoning model configuration is required for the benchmark');
  }

  const reasoningModel = buildClient(input.reasoning, 'reasoning');
  if (input.testConnectivity) {
    const t = await reasoningModel.testConnectivity();
    if (!t.success) {
      throw new Error(`Reasoning model connection failed: ${t.error}`);
    }
    log(`Reasoning model connected (${t.latency}ms)`);
  }

  let multimodalModel = input.multimodal ? buildClient(input.multimodal, 'multimodal') : undefined;
  if (multimodalModel && input.testConnectivity) {
    const t = await multimodalModel.testConnectivity();
    if (!t.success) {
      log(`Multimodal model unreachable, continuing without it: ${t.error}`);
      multimodalModel = undefined;
    }
  }

  let toolCallingModel = input.toolCalling ? buildClient(input.toolCalling, 'tool-calling') : undefined;
  if (toolCallingModel && input.testConnectivity) {
    const t = await toolCallingModel.testConnectivity();
    if (!t.success) {
      log(`Tool-calling model unreachable, continuing without it: ${t.error}`);
      toolCallingModel = undefined;
    }
  }

  const orchestrator = new ModelOrchestrator({ reasoningModel, multimodalModel, toolCallingModel });
  return { orchestrator, modelLabel: resolveModelId(input.reasoning) || 'unknown' };
}
