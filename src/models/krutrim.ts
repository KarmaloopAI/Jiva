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

    // Retry logic for WAF/rate limiting issues
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`Retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        return await this.attemptChat(options, isReasoningModel);
      } catch (error) {
        lastError = error as Error;

        // Only retry on 403 (WAF) or 429 (rate limit) errors
        if (error instanceof ModelError) {
          const is403or429 = error.message.includes('(403)') || error.message.includes('(429)');
          if (!is403or429 || attempt === maxRetries) {
            throw error;
          }
          logger.warn(`Got ${error.message.includes('(403)' ) ? '403 Access Denied' : '429 Rate Limited'}, will retry...`);
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

      if (isReasoningModel && options.tools && options.tools.length > 0) {
        // Convert to Harmony format for gpt-oss-120b
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
        messages = options.messages;
      }

      // Krutrim API only supports standard OpenAI roles: system, user, assistant, tool
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
        temperature: options.temperature ?? 0.7,
      };

      if (options.maxTokens) {
        requestBody.max_tokens = options.maxTokens;
      }

      // Note: We don't send tools in OpenAI format to Krutrim
      // Tools are embedded in the developer message via Harmony format

      logger.debug('Krutrim API Request:', JSON.stringify(requestBody, null, 2));

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

        throw new ModelError(
          `Krutrim API error (${response.status}): ${errorText}`,
          this.config.model
        );
      }

      const data: any = await response.json();
      logger.debug('Krutrim API Response:', JSON.stringify(data, null, 2));

      if (!data.choices || data.choices.length === 0) {
        throw new ModelError('No choices in response', this.config.model);
      }

      const choice = data.choices[0];
      const messageContent = choice.message?.content || '';

      // Parse response based on model type
      if (isReasoningModel && options.tools && options.tools.length > 0) {
        // Parse Harmony format response
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
        // Standard response
        return {
          content: messageContent,
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
        `Failed to communicate with Krutrim API: ${error instanceof Error ? error.message : String(error)}`,
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
}

/**
 * Factory function to create Krutrim model instances
 */
export function createKrutrimModel(config: KrutrimConfig): KrutrimModel {
  return new KrutrimModel(config);
}
