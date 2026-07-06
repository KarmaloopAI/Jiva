/**
 * OpenAI-Compatible Model Client
 *
 * Generic client for any OpenAI-compatible chat completion API.
 * Supports: Krutrim, Groq, Sarvam, OpenAI, Vertex AI MaaS, and any other
 * provider that exposes a /v1/chat/completions endpoint.
 *
 * Provider-specific behaviour is controlled entirely through config flags:
 *   - useHarmonyFormat    → Krutrim gpt-oss-120b (Harmony tool format)
 *   - reasoningEffortStrategy → how reasoning effort is communicated
 *   - defaultMaxTokens   → required for reasoning models (e.g. Sarvam-105B)
 *   - useGoogleADC       → Vertex AI MaaS: fetch short-lived GCP OAuth2 tokens
 *                          instead of using a static apiKey
 */

import { IModel, ChatCompletionOptions, ModelResponse, Message } from './base.js';
import {
  formatMessagesForHarmony,
  parseHarmonyResponse,
  extractAssistantMessage,
  HarmonyToolDefinition,
  HarmonyMessage
} from './harmony.js';
import { ModelError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getGoogleADCToken } from './google-adc.js';

export interface ModelClientConfig {
  endpoint: string;
  /** Static API key. Not required when useGoogleADC is true. */
  apiKey: string;
  model: string;
  defaultModel?: string; // Alias used in config store; model takes precedence
  type: 'reasoning' | 'multimodal' | 'tool-calling';

  /**
   * Use Google Application Default Credentials (ADC) for authentication.
   *
   * When true, a short-lived GCP OAuth2 bearer token is fetched automatically
   * before each request (cached and refreshed every ~55 minutes). Use this for
   * Vertex AI MaaS endpoints (aiplatform.googleapis.com) where no static API
   * key exists — auth is handled by the Cloud Run service account.
   *
   * Token source: GCP metadata server IP 169.254.169.254 (Cloud Run/GCE),
   * with fallback to google-auth-library for local development.
   *
   * Default: false
   */
  useGoogleADC?: boolean;

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
   * Sarvam-105B caps completion output at 4096 tokens (requesting more is rejected),
   * so use 4096 there. Leave unset for Groq/Krutrim.
   */
  defaultMaxTokens?: number;

  /**
   * Client-side proactive rate limit — max requests this model instance will
   * send in any trailing 60s window. When set, `chat()` waits BEFORE sending
   * a request that would exceed the limit, rather than only reacting to 429s
   * after the fact. Model-agnostic: set this for any provider with a known
   * hard rate ceiling (e.g. Sarvam's free tier: 40 req/min).
   * Default: unset (no proactive throttling, only reactive 429 retry).
   */
  maxRequestsPerMinute?: number;

  /**
   * True when this model instance itself has native vision/multimodal
   * capability, regardless of `type`. Lets a `reasoning`- (or `tool-calling`-)
   * typed model accept image content directly (see `supportsVision()`),
   * without needing a separate dedicated `multimodal` model configured.
   * Default: false
   */
  hasVision?: boolean;
}

export class ModelClient implements IModel {
  private config: ModelClientConfig;
  /** Timestamps (ms) of requests sent in the trailing rate-limit window. */
  private requestTimestamps: number[] = [];

  constructor(config: ModelClientConfig) {
    this.config = config;
  }

  supportsVision(): boolean {
    return this.config.type === 'multimodal' || !!this.config.hasVision;
  }

  supportsToolCalling(): boolean {
    // Both the reasoning model and dedicated tool-calling model support tool calling
    return this.config.type === 'reasoning' || this.config.type === 'tool-calling';
  }

  /** The configured max output tokens for this model instance, if any. */
  getDefaultMaxTokens(): number | undefined {
    return this.config.defaultMaxTokens;
  }

  /**
   * Proactively wait if sending a request right now would exceed
   * `maxRequestsPerMinute`. No-op when the config doesn't set a limit.
   * Called before every attempt (including retries) so a burst of calls in
   * quick succession — tool-result turns, title generation, compaction
   * summaries — can never collectively exceed the ceiling.
   */
  private async throttleIfNeeded(): Promise<void> {
    const limit = this.config.maxRequestsPerMinute;
    if (!limit || limit <= 0) return;

    const windowMs = 60_000;
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < windowMs);

    if (this.requestTimestamps.length >= limit) {
      const oldest = this.requestTimestamps[0];
      const waitMs = windowMs - (now - oldest) + 100; // small buffer past the window edge
      logger.warn(
        `[RateLimiter] ${this.config.model}: at the ${limit} req/min limit, waiting ${(waitMs / 1000).toFixed(1)}s`,
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
      const afterWait = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter(t => afterWait - t < windowMs);
    }

    this.requestTimestamps.push(Date.now());
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
        await this.throttleIfNeeded();
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

          // For 429s, prefer the standard Retry-After header (captured on the
          // error as retryAfterMs — provider-agnostic, RFC 6585) over parsing
          // provider-specific wording out of the message body. Groq returns
          // "Please try again in 8.53s." in the body; other providers (e.g.
          // Sarvam) may only set the header with no matching text, so the
          // header must be checked first rather than only as a fallback.
          if (is429) {
            const textMatch = error.message.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
            const textParsedMs = textMatch ? Math.ceil(parseFloat(textMatch[1]) * 1000) + 500 : null;
            const retryAfterMs = error.retryAfterMs ?? textParsedMs;
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

      // Resolve auth token — static key or dynamic GCP OAuth2 token
      const authToken = this.config.useGoogleADC
        ? await getGoogleADCToken()
        : this.config.apiKey;

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
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

        // Standard RFC 6585 header — either delay-seconds ("30") or an HTTP-date.
        // Captured here (not just parsed out of the message text later) so the
        // retry logic works uniformly across providers regardless of whether
        // they also include human-readable wording in the error body.
        let retryAfterMs: number | undefined;
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            const asSeconds = Number(retryAfterHeader);
            if (!Number.isNaN(asSeconds)) {
              retryAfterMs = asSeconds * 1000;
            } else {
              const asDate = Date.parse(retryAfterHeader);
              if (!Number.isNaN(asDate)) {
                retryAfterMs = Math.max(0, asDate - Date.now());
              }
            }
          }
        }

        throw new ModelError(
          `API error (${response.status}): ${errorText}`,
          this.config.model,
          retryAfterMs,
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
        // Parse Harmony format response (Krutrim gpt-oss-120b / Vertex AI MaaS)
        const parsed = parseHarmonyResponse(messageContent);

        // Determine the clean display content.
        // Prefer the model's explicit channel outputs (final > commentary > analysis), then
        // fall back to extractAssistantMessage() which strips all Harmony control tokens.
        // Always run extractAssistantMessage() to clean residual Harmony tokens from
        // channel content (e.g. <|message|> tokens that appear as channel body).
        // Never expose raw messageContent — it would leak Harmony tokens to the user.
        const channelContent = parsed.final || parsed.commentary || parsed.analysis || '';
        const cleanContent = extractAssistantMessage(channelContent || messageContent);

        return {
          // Cleaned display content (no Harmony tokens) — shown to the user
          content: cleanContent,
          // Raw Harmony response — must be stored in conversation history as the
          // assistant message content so the model can continue the tool-call
          // sequence on the next turn. Harmony providers (Vertex AI, Krutrim) need
          // to see their own token markers in history.
          rawHarmonyContent: messageContent,
          toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          } : undefined,
          finishReason: choice.finish_reason,
          raw: {
            ...data,
            parsedHarmony: parsed,
          },
        };
      } else {
        // Standard OpenAI format response
        const nativeToolCalls = choice.message?.tool_calls;

        // Some models emit tool calls in message.content instead of (or in addition to)
        // the native tool_calls field. Two known content-embedded formats:
        //   1. XML: <tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>
        //   2. Harmony tokens: <|call|>fn(args)<|return|>  or  <|channel|>commentary to=fn ...
        //      gpt-oss-120b-maas on Vertex AI leaks Harmony tokens even in standard mode.
        let contentText = messageContent;
        let embeddedToolCalls: any[] | undefined;

        const hasHarmonyTokens = messageContent && (
          messageContent.includes('<|call|>') ||
          messageContent.includes('<|channel|>') ||
          messageContent.includes('<tool_call>')
        );

        if (hasHarmonyTokens) {
          const parsed = parseHarmonyResponse(messageContent);
          if (parsed.toolCalls.length > 0) {
            embeddedToolCalls = parsed.toolCalls;
            // Clean Harmony/XML tokens from the visible content
            contentText = extractAssistantMessage(messageContent);
          } else {
            // Tokens present but no tool calls parsed — still clean them from content
            contentText = extractAssistantMessage(messageContent);
          }
        }

        // Prefer native tool_calls (standard format); fall back to content-embedded calls
        const allToolCalls = nativeToolCalls && nativeToolCalls.length > 0
          ? nativeToolCalls
          : (embeddedToolCalls ?? []);

        return {
          content: contentText,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          } : undefined,
          finishReason: choice.finish_reason,
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
