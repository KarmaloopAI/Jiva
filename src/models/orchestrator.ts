/**
 * Multi-Model Orchestrator
 *
 * Coordinates between reasoning model (gpt-oss-120b) and multimodal model (Llama-4-Maverick)
 */

import { KrutrimModel } from './krutrim.js';
import { Message, MessageContent, ChatCompletionOptions, ModelResponse, Tool } from './base.js';
import { logger } from '../utils/logger.js';
import { ModelError } from '../utils/errors.js';

export interface OrchestratorConfig {
  reasoningModel: KrutrimModel;
  multimodalModel?: KrutrimModel;
  /**
   * Optional dedicated tool-calling LLM.
   * When configured this model is used as the *primary* model for all tool
   * calls (it reliably serialises tool arguments as standard OpenAI JSON).
   * The reasoning model then serves as the secondary fallback.
   * If not configured the reasoning model is the only model used for tool calls.
   */
  toolCallingModel?: KrutrimModel;
}

export class ModelOrchestrator {
  private reasoningModel: KrutrimModel;
  private multimodalModel?: KrutrimModel;
  private toolCallingModel?: KrutrimModel;

  constructor(config: OrchestratorConfig) {
    this.reasoningModel = config.reasoningModel;
    this.multimodalModel = config.multimodalModel;
    this.toolCallingModel = config.toolCallingModel;
  }

  /**
   * Process a chat completion with automatic model selection
   */
  async chat(options: ChatCompletionOptions): Promise<ModelResponse> {
    return this.chatWithFallback(options, false);
  }

  /**
   * Process a chat completion, selecting the model based on `useFallback`.
   *   useFallback=true  → use tool-calling model (primary when configured)
   *   useFallback=false → use reasoning model (primary when no tool-calling model configured)
   * Images are always pre-processed by the multimodal model prior to routing.
   */
  async chatWithFallback(options: ChatCompletionOptions, useFallback: boolean): Promise<ModelResponse> {
    // Check if request contains images
    const hasImages = this.hasImageContent(options.messages);

    if (hasImages && this.multimodalModel) {
      // Use multimodal model to process images first, then primary/fallback model
      return await this.handleMultimodalRequest(options, useFallback);
    }

    // Use tool-calling model when requested and available
    if (useFallback && this.toolCallingModel) {
      logger.info('  [Orchestrator] Using tool-calling model');
      return await this.toolCallingModel.chat(options);
    }

    // Default: use reasoning model
    return await this.reasoningModel.chat(options);
  }

  /**
   * Check if a dedicated tool-calling model is configured.
   */
  hasToolCallingModel(): boolean {
    return !!this.toolCallingModel;
  }

  /**
   * Handle requests with image content
   */
  private async handleMultimodalRequest(
    options: ChatCompletionOptions,
    useFallback: boolean = false
  ): Promise<ModelResponse> {
    if (!this.multimodalModel) {
      throw new ModelError(
        'Multimodal model not configured, but request contains images'
      );
    }

    logger.info('Processing multimodal request...');

    // Extract messages with images
    const imageMessages = this.extractImageMessages(options.messages);

    // Process each image with multimodal model
    const imageDescriptions: Map<number, string> = new Map();

    for (const [index, msg] of imageMessages) {
      logger.debug(`Processing image in message ${index}`);

      try {
        const response = await this.multimodalModel.chat({
          messages: [msg],
          temperature: options.temperature,
        });

        imageDescriptions.set(index, response.content);
        logger.debug(`Image description: ${response.content.substring(0, 100)}...`);
      } catch (error) {
        logger.error(`Failed to process image in message ${index}`, error);
        throw error;
      }
    }

    // Replace images with descriptions for reasoning model
    const messagesWithDescriptions = this.replaceImagesWithDescriptions(
      options.messages,
      imageDescriptions
    );

    // Now use primary/fallback model with text-only messages
    if (useFallback && this.toolCallingModel) {
      logger.info('  [Orchestrator] Forwarding to tool-calling model (fallback mode)...');
      return await this.toolCallingModel.chat({
        ...options,
        messages: messagesWithDescriptions,
      });
    }

    // Now use reasoning model with text-only messages
    logger.info('Forwarding to reasoning model...');
    return await this.reasoningModel.chat({
      ...options,
      messages: messagesWithDescriptions,
    });
  }

  /**
   * Check if messages contain image content
   */
  private hasImageContent(messages: Message[]): boolean {
    return messages.some(msg => {
      if (Array.isArray(msg.content)) {
        return msg.content.some(c => c.type === 'image_url');
      }
      return false;
    });
  }

  /**
   * Extract messages that contain images
   */
  private extractImageMessages(messages: Message[]): Array<[number, Message]> {
    const imageMessages: Array<[number, Message]> = [];

    messages.forEach((msg, index) => {
      if (Array.isArray(msg.content)) {
        const hasImage = msg.content.some(c => c.type === 'image_url');
        if (hasImage) {
          imageMessages.push([index, msg]);
        }
      }
    });

    return imageMessages;
  }

  /**
   * Replace image content with text descriptions
   */
  private replaceImagesWithDescriptions(
    messages: Message[],
    descriptions: Map<number, string>
  ): Message[] {
    return messages.map((msg, index) => {
      if (!descriptions.has(index)) {
        return msg;
      }

      const description = descriptions.get(index)!;

      if (Array.isArray(msg.content)) {
        // Replace image_url content with text description
        const newContent: MessageContent[] = msg.content.map(c => {
          if (c.type === 'image_url') {
            return {
              type: 'text',
              text: `[Image description: ${description}]`,
            };
          }
          return c;
        });

        return {
          ...msg,
          content: newContent,
        };
      }

      return msg;
    });
  }

  /**
   * Get reasoning model instance
   */
  getReasoningModel(): KrutrimModel {
    return this.reasoningModel;
  }

  /**
   * Get multimodal model instance if configured
   */
  getMultimodalModel(): KrutrimModel | undefined {
    return this.multimodalModel;
  }

  /**
   * Get tool-calling model instance if configured
   */
  getToolCallingModel(): KrutrimModel | undefined {
    return this.toolCallingModel;
  }

  /**
   * Check if multimodal support is available
   */
  hasMultimodalSupport(): boolean {
    return !!this.multimodalModel;
  }
}
