/**
 * Single place that turns a stored `ModelConfig` (config.json) into a
 * `ModelClientConfig`. Entry points (CLI chat/run, benchmark, HTTP) used to
 * copy these fields by hand and drifted — e.g. a new field added to one site
 * (like the OpenRouter routing block) silently never reached the others.
 */

import type { ModelConfig } from '../core/config.js';
import type { ModelClientConfig } from './model-client.js';

export type ModelRole = 'reasoning' | 'multimodal' | 'tool-calling';

/** Structural subset of ModelConfig so callers with looser types (benchmark, HTTP) can use it too. */
export type StoredModelConfig = Pick<ModelConfig, 'endpoint'> &
  Partial<Omit<ModelConfig, 'endpoint'>>;

export function modelClientConfigFromStored(
  cfg: StoredModelConfig,
  role: ModelRole,
  overrides: Partial<ModelClientConfig> = {},
): ModelClientConfig {
  const base: ModelClientConfig = {
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey ?? '',
    model: cfg.model || cfg.defaultModel || '',
    type: role,
    useGoogleADC: cfg.useGoogleADC,
    hasVision: cfg.hasVision,
    maxRequestsPerMinute: cfg.maxRequestsPerMinute,
    headers: cfg.headers,
    openrouter: cfg.openrouter,
  };

  // Multimodal (image captioning) models intentionally don't get reasoning
  // effort, harmony tool formatting or the completion-token default.
  if (role !== 'multimodal') {
    base.useHarmonyFormat = cfg.useHarmonyFormat;
    base.reasoningEffortStrategy = cfg.reasoningEffortStrategy;
    base.defaultReasoningEffort = cfg.defaultReasoningEffort;
    base.includeReasoning = cfg.includeReasoning;
    base.defaultMaxTokens = cfg.defaultMaxTokens;
  }

  return { ...base, ...overrides };
}
