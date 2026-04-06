/**
 * OpenAI-Compatible Model Client
 *
 * Generic client for any OpenAI-compatible chat completion API.
 * Supports: Krutrim, Groq, Sarvam, OpenAI, and any other provider
 * that exposes a /v1/chat/completions endpoint.
 *
 * Provider-specific behaviour is controlled entirely through config flags:
 *   - useHarmonyFormat    → Krutrim gpt-oss-120b (Harmony tool format)
 *   - reasoningEffortStrategy → how reasoning effort is communicated
 *   - defaultMaxTokens   → required for reasoning models (e.g. Sarvam-105B)
 */

import { IModel, ChatCompletionOptions, ModelResponse, Message } from './base.js';
import {
  formatMessagesForHarmony,
  parseHarmonyResponse,
  HarmonyToolDefinition,
  HarmonyMessage
} from './harmony.js';
import { ModelError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface ModelClientConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  defaultModel?: string; // Alias used in config store; model takes precedence
  type: 'reasoning' | 'multimodal' | 'tool-calling';

  /**
   * Use Harmony format for tool calling.
   * Only needed for Krutrim's gpt-oss-120b model.
   * Default: false (standard OpenAI format)
   */
  useHarmonyFormat?: boolean;

  /**
   * Default reasoning effort for all calls made through this model instance.
   * Can be overridden per-call via ChatCompletionOptions.reasoningEffort.
   * Sensible defaults: 'high' for reasoning models, 'medium' for tool-calling models.
   */
  defaultReasoningEffort?: 'low' | 'medium' | 'high';

  /**
   * How to communicate reasoning effort to the model.
   *
   * 'api_param'     — send only as the `reasoning_effort` request body field.
   *                   Works natively on Groq and Sarvam.
   * 'system_prompt' — inject only as a leading system message: "Reasoning: <level>".
   *                   Required for gpt-oss-120b on Krutrim (strips unknown params).
   * 'both'          — do both (safe default for unknown providers).
   *
   * Provider recommendations:
   *   Krutrim  → 'system_prompt'
   *   Groq     → 'api_param'
   *   Sarvam   → 'api_param'
   *   Other    → 'both'
   *
   * Default: 'both'
   */
  reasoningEffortStrategy?: 'api_param' | 'system_prompt' | 'both';

  /**
   * Request reasoning tokens in the response body (Groq-specific: `include_reasoning`).
   * When true, the model's thinking tokens are logged at debug level.
   * Has no effect on providers that do not support the field.
   * Note: Sarvam always returns reasoning_content regardless of this flag.
   * Default: false
   */
  includeReasoning?: boolean;

  /**
   * Default max tokens for completion.
   *
   * REQUIRED for reasoning models like Sarvam-105B that spend completion tokens
   * on their thinking chain before producing output. Without a sufficient budget
   * the model exhausts the default limit (~2048) reasoning and returns empty content.
   *
   * Recommended: 8192 for Sarvam-105B, unset for Groq/Krutrim.
   */
  defaultMaxTokens?: number;
}

export class ModelClient implements IModel {
  private config: ModelClientConfig;

  constructor(config: ModelClientConfig) {
    this.config = config;
  }

  supportsVision(): boolean {
    return this.config.type === 'multimodal';
  }

  supportsToolCalling(): boolean {
    // Both the reasoning model and dedicated tool-calling model support tool calling
    return this.config.type === 'reasoning' || this.config.type === 'tool-calling';
  }

  async chat(options: ChatCompletionOptions): Promise<ModelResponse> {
    // 'tool-calling' models are treated as reasoning models for tool-call formatting purposes
    const isReasoningModel = this.config.type === 'reasoning' || this.config.type === 'tool-calling';

    // Retry logic for transient errors (WAF/rate limiting/server errors)
    const maxRetries = 4;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, this._lastRetryWait ?? 2000));
      }

      try {
        return await this.attemptChat(options, isReasoningModel);
      } catch (error) {
        lastError = error as Error;

        // Retry on transient errors: 403 (WAF), 429 (rate limit), 500/502/503/504 (server errors)
        if (error instanceof ModelError) {
          const is429 = error.message.includes('(429)');
          const shouldRetry =
            error.message.includes('(403)') ||  // WAF blocking
            is429 ||                            // Rate limiting
            error.message.includes('(500)') ||  // Internal server error
            error.message.includes('(502)') ||  // Bad gateway
            error.message.includes('(503)') ||  // Service unavailable
            error.message.includes('(504)');    // Gateway timeout

          if (!shouldRetry || attempt === maxRetries) {
            throw error;
          }

          // Log the error type for debugging
          let errorType = 'Unknown error';
          if (error.message.includes('(403)')) errorType = '403 Access Denied (WAF)';
          else if (is429) errorType = '429 Rate Limited';
          else if (error.message.includes('(500)')) errorType = '500 Internal Server Error';
          else if (error.message.includes('(502)')) errorType = '502 Bad Gateway';
          else if (error.message.includes('(503)')) errorType = '503 Service Unavailable';
          else if (error.message.includes('(504)')) errorType = '504 Gateway Timeout';

          // For 429s, parse the actual retry-after time from the error message.
          // Groq returns: "Please try again in 8.53s."
          if (is429) {
            const match = error.message.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
            const retryAfterMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : null;
            // Use parsed time, falling back to capped exponential backoff
            const exponential = Math.min(Math.pow(2, attempt) * 1000, 30_000);
            this._lastRetryWait = retryAfterMs ?? exponential;
            logger.warn(`Got ${errorType}, will retry in ${(this._lastRetryWait / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries + 1})...`);
          } else {
            const waitTime = Math.min(Math.pow(2, attempt) * 1000, 30_000);
            this._lastRetryWait = waitTime;
            logger.warn(`Got ${errorType}, will retry in ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})...`);
          }
        } else {
          throw error;
        }
      }
    }

    throw lastError!;
  }

  /** Retry wait time in ms, set dynamically based on API hint or exponential backoff. */
  private _lastRetryWait?: number;

  private async attemptChat(options: ChatCompletionOptions, isReasoningModel: boolean): Promise<ModelResponse> {
    try {
      let messages: any[];
      let tools: HarmonyToolDefinition[] | undefined;
      const useHarmony = this.config.useHarmonyFormat ?? false;

      if (isReasoningModel && options.tools && options.tools.length > 0) {
        if (useHarmony) {
          // Harmony format (Krutrim gpt-oss-120b only)
          // Tools are embedded in the developer message as XML/TypeScript signatures
          tools = options.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }));

          messages = formatMessagesForHarmony(
            options.messages as HarmonyMessage[],
            tools
          );
        } else {
          // Standard OpenAI format - tools sent as separate request field
          messages = options.messages;
        }
      } else {
        messages = options.messages;
      }

      // All OpenAI-compatible APIs support standard roles: system, user, assistant, tool
      // Convert 'developer' role to 'system' for API compatibility
      const apiMessages: any[] = messages.map((msg: any) => {
        if (msg.role === 'developer') {
          return { ...msg, role: 'system' };
        }
        return msg;
      });

      // ── Reasoning effort ────────────────────────────────────────────────────
      // Per-call value takes precedence over model-level default.
      const effort = options.reasoningEffort ?? this.config.defaultReasoningEffort;
      const strategy = this.config.reasoningEffortStrategy ?? 'both';

      // System-prompt injection: prepend "Reasoning: <level>" as the very first
      // system message. Required for gpt-oss-120b on Krutrim (it strips the API param).
      if (effort && isReasoningModel && (strategy === 'system_prompt' || strategy === 'both')) {
        apiMessages.unshift({ role: 'system', content: `Reasoning: ${effort}` });
      }

      const requestBody: any = {
        model: options.model || this.config.model,
        messages: apiMessages,
        temperature: options.temperature ?? 0.2, // Lower default to reduce hallucination
      };

      // max_tokens: explicit call option > config default
      // Config default is important for reasoning models (Sarvam-105B) that need
      // a large token budget to finish their thinking chain before producing output.
      const maxTokens = options.maxTokens ?? this.config.defaultMaxTokens;
      if (maxTokens) {
        requestBody.max_tokens = maxTokens;
      }

      // API param: supported natively by Groq and Sarvam; silently ignored elsewhere.
      if (effort && isReasoningModel && (strategy === 'api_param' || strategy === 'both')) {
        requestBody.reasoning_effort = effort;
      }

      // include_reasoning: request thinking tokens in the response (Groq-specific).
      // Sarvam always returns reasoning_content regardless of this flag.
      if (this.config.includeReasoning && isReasoningModel) {
        requestBody.include_reasoning = true;
      }
      // ────────────────────────────────────────────────────────────────────────

      // Send tools in standard OpenAI format if not using Harmony
      if (!useHarmony && isReasoningModel && options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
        requestBody.tool_choice = 'auto';
      }

      // Log full request for debugging
      logger.debug('API Request:', JSON.stringify(requestBody, null, 2));
      logger.debug('Request size:', JSON.stringify(requestBody).length, 'bytes');
      logger.debug('Message count:', requestBody.messages.length);

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'User-Agent': 'Jiva/0.1.0',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`API Error Response (${response.status}):`, errorText);
        logger.debug('Request that failed:', JSON.stringify(requestBody, null, 2));

        // Write failing request to file for debugging
        if (response.status === 403) {
          try {
            const fs = await import('fs');
            const debugPath = '/tmp/jiva_failed_request.json';
            await fs.promises.writeFile(
              debugPath,
              JSON.stringify(requestBody, null, 2)
            );
            logger.warn(`Failing request saved to: ${debugPath}`);
          } catch (e) {
            // Ignore file write errors
          }
        }

        throw new ModelError(
          `API error (${response.status}): ${errorText}`,
          this.config.model
        );
      }

      const data: any = await response.json();
      logger.debug('API Response:', JSON.stringify(data, null, 2));

      if (!data.choices || data.choices.length === 0) {
        throw new ModelError('No choices in response', this.config.model);
      }

      const choice = data.choices[0];
      const messageContent = choice.message?.content || '';

      // Log reasoning tokens at debug level.
      // Groq exposes them as choice.message.reasoning
      // Sarvam exposes them as choice.message.reasoning_content
      const reasoningTokens: string | undefined =
        choice.message?.reasoning_content ?? choice.message?.reasoning;
      if (reasoningTokens) {
        logger.debug(`[Model reasoning] ${reasoningTokens.substring(0, 2000)}${reasoningTokens.length > 2000 ? '…' : ''}`);
      }

      // Parse response based on format used.
      // Always run Harmony parsing when the model is a Harmony-format model, even
      // when no tools were requested — the model may still emit tool-call tokens
      // (e.g. <|call|>…<|return|> or <tool_call>…</tool_call>) regardless.
      if (useHarmony && isReasoningModel) {
        // Parse Harmony format response (Krutrim gpt-oss-120b only)
        const parsed = parseHarmonyResponse(messageContent);

        return {
          content: parsed.final || parsed.commentary || messageContent,
          toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          } : undefined,
          raw: {
            ...data,
            parsedHarmony: parsed,
          },
        };
      } else {
        // Standard OpenAI format response
        const toolCalls = choice.message?.tool_calls;

        return {
          content: messageContent,
          toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          } : undefined,
          raw: data,
        };
      }
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      throw new ModelError(
        `Failed to communicate with API: ${error instanceof Error ? error.message : String(error)}`,
        this.config.model
      );
    }
  }

  /**
   * Helper method for vision tasks using multimodal model
   */
  async describeImage(imageUrl: string, prompt?: string): Promise<string> {
    if (!this.supportsVision()) {
      throw new ModelError(
        'This model does not support vision tasks',
        this.config.model
      );
    }

    const response = await this.chat({
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt || 'Describe this image in detail.',
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });

    return response.content;
  }

  /**
   * Test connectivity to the API endpoint
   */
  async testConnectivity(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const startTime = Date.now();

    try {
      logger.debug(`Testing connectivity to ${this.config.endpoint}...`);

      const testResponse = await this.chat({
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0,
        maxTokens: 5,
      });

      const latency = Date.now() - startTime;
      logger.debug(`Connectivity test passed in ${latency}ms`);

      return { success: true, latency };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Connectivity test failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

/**
 * Factory function to create a model client instance
 */
export function createModelClient(config: ModelClientConfig): ModelClient {
  return new ModelClient(config);
}
