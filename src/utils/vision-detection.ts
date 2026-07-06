/**
 * Best-effort detection of whether a model name belongs to a family known to
 * support native vision (image) input alongside reasoning/tool-calling.
 *
 * This only drives the DEFAULT answer to a y/n prompt during setup — it is
 * never authoritative. Users can always override it. Matching is
 * intentionally broad (family-name-level, not exact-model-level) since a
 * false positive just means the user answers "n" once, while a false
 * negative silently withholds a useful default.
 */

export interface VisionDetectionResult {
  supported: boolean;
  reason?: string;
}

const VISION_PATTERNS: Array<[RegExp, string]> = [
  // Llama 4 herd is natively multimodal; Maverick/Scout are the vision-capable variants.
  [/maverick/i, 'Llama 4 Maverick supports vision'],
  [/scout/i, 'Llama 4 Scout supports vision'],
  [/llama-?4/i, 'Llama 4 models support vision'],
  [/llama.*vision/i, 'Llama vision variants support vision'],

  // Qwen (VL variants and newer flagship models)
  [/qwen/i, 'Qwen models support vision'],

  // Moonshot AI's Kimi
  [/kimi/i, 'Kimi models support vision'],

  // Zhipu AI's GLM
  [/glm/i, 'GLM models support vision'],

  // Anthropic Claude — all Claude 3+ models support vision, no modern text-only variant
  [/claude/i, 'Claude models support vision'],

  // OpenAI GPT-4o/4.x/5.x and o-series reasoning models support vision.
  // gpt-oss is deliberately excluded — it's a text-only open-weight reasoning
  // model (see the Krutrim preset in setup-wizard.ts, which pairs it with a
  // separate Llama-4-Maverick multimodal model for exactly this reason).
  [/gpt-4/i, 'GPT-4 models support vision'],
  [/gpt-5/i, 'GPT-5 models support vision'],
  [/\bo[134]\b/i, 'OpenAI o-series reasoning models support vision'],

  // Google Gemini — all modern Gemini models are natively multimodal
  [/gemini/i, 'Gemini models support vision'],

  // Mistral's vision-specialised model
  [/pixtral/i, 'Pixtral supports vision'],

  // xAI Grok — modern Grok models support vision
  [/grok/i, 'Grok models support vision'],

  // Microsoft Phi multimodal variants
  [/phi.*(vision|multimodal)/i, 'Phi multimodal variants support vision'],
];

export function detectVisionCapability(modelName: string): VisionDetectionResult {
  if (!modelName) return { supported: false };

  for (const [pattern, reason] of VISION_PATTERNS) {
    if (pattern.test(modelName)) {
      return { supported: true, reason };
    }
  }

  return { supported: false };
}
