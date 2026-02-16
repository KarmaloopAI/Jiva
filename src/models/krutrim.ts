/**
 * Krutrim API Client
 *
 * Handles communication with Krutrim Cloud API for both gpt-oss-120b and Llama-4-Maverick-17B models.
 * Implements Harmony format for gpt-oss-120b and standard format for multimodal model.
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

export interface KrutrimConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  type: 'reasoning' | 'multimodal';
  useHarmonyFormat?: boolean; // Use Harmony format for tools (Krutrim-specific), defaults to false
}

export class KrutrimModel implements IModel {
  private config: KrutrimConfig;

  constructor(config: KrutrimConfig) {
    this.config = config;
  }

  supportsVision(): boolean {
    return this.config.type === 'multimodal';
  }

  supportsToolCalling(): boolean {
    // Only reasoning model (gpt-oss-120b) supports tool calling
    return this.config.type === 'reasoning';
  }

  async chat(options: ChatCompletionOptions): Promise<ModelResponse> {
    const isReasoningModel = this.config.type === 'reasoning';

    // Retry logic for transient errors (WAF/rate limiting/server errors)
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
        logger.warn(`Retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        return await this.attemptChat(options, isReasoningModel);
      } catch (error) {
        lastError = error as Error;

        // Retry on transient errors: 403 (WAF), 429 (rate limit), 500/502/503/504 (server errors)
        if (error instanceof ModelError) {
          const shouldRetry =
            error.message.includes('(403)') ||  // WAF blocking
            error.message.includes('(429)') ||  // Rate limiting
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
          else if (error.message.includes('(429)')) errorType = '429 Rate Limited';
          else if (error.message.includes('(500)')) errorType = '500 Internal Server Error';
          else if (error.message.includes('(502)')) errorType = '502 Bad Gateway';
          else if (error.message.includes('(503)')) errorType = '503 Service Unavailable';
          else if (error.message.includes('(504)')) errorType = '504 Gateway Timeout';

          logger.warn(`Got ${errorType}, will retry...`);
        } else {
          throw error;
        }
      }
    }

    throw lastError!;
  }

  private async attemptChat(options: ChatCompletionOptions, isReasoningModel: boolean): Promise<ModelResponse> {
    try {
      let messages: any[];
      let tools: HarmonyToolDefinition[] | undefined;
      const useHarmony = this.config.useHarmonyFormat ?? false;

      if (isReasoningModel && options.tools && options.tools.length > 0) {
        if (useHarmony) {
          // Convert to Harmony format (Krutrim-specific)
          // Tools are embedded in the developer message
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
          // Standard OpenAI format - tools sent separately
          messages = options.messages;
        }
      } else {
        messages = options.messages;
      }

      // All OpenAI-compatible APIs support standard roles: system, user, assistant, tool
      // Convert 'developer' role to 'system' for API compatibility
      const apiMessages = messages.map((msg: any) => {
        if (msg.role === 'developer') {
          return { ...msg, role: 'system' };
        }
        return msg;
      });

      const requestBody: any = {
        model: options.model || this.config.model,
        messages: apiMessages,
        temperature: options.temperature ?? 0.2, // Lower default to reduce hallucination
      };

      if (options.maxTokens) {
        requestBody.max_tokens = options.maxTokens;
      }

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

      // Parse response based on format used
      if (useHarmony && isReasoningModel && options.tools && options.tools.length > 0) {
        // Parse Harmony format response (Krutrim-specific)
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
        // Check for tool calls in standard format
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
   * Returns true if connection is successful, throws error otherwise
   */
  async testConnectivity(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const startTime = Date.now();

    try {
      logger.debug(`Testing connectivity to ${this.config.endpoint}...`);

      // Simple test request with minimal tokens
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
 * Factory function to create Krutrim model instances
 */
export function createKrutrimModel(config: KrutrimConfig): KrutrimModel {
  return new KrutrimModel(config);
}
