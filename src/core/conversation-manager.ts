/**
 * Conversation Manager
 *
 * Handles conversation persistence, condensing, and restoration.
 * Now uses StorageProvider abstraction for cloud-native support.
 */

import { Message } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { ModelOrchestrator } from '../models/orchestrator.js';
import { StorageProvider } from '../storage/provider.js';
import { SavedConversation } from '../storage/types.js';

export interface ConversationMetadata {
  id: string;
  title?: string; // Human-readable title
  created: string;
  updated: string;
  messageCount: number;
  workspace?: string;
  summary?: string;
}

export class ConversationManager {
  private storageProvider: StorageProvider;
  private currentConversationId: string | null = null;

  constructor(storageProvider: StorageProvider, orchestrator?: ModelOrchestrator) {
    this.storageProvider = storageProvider;
    this.orchestrator = orchestrator;
  }

  private orchestrator?: ModelOrchestrator;

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `conv-${timestamp}-${random}`;
  }

  /**
   * Save conversation using StorageProvider
   */
  async saveConversation(
    messages: Message[],
    workspace?: string,
    conversationId?: string,
    orchestrator?: ModelOrchestrator
  ): Promise<string> {
    const finalId = conversationId || this.currentConversationId || this.generateConversationId();

    // Use provided orchestrator or fallback to constructor orchestrator
    const modelOrchestrator = orchestrator || this.orchestrator;

    // Load existing conversation if updating
    let existingData: SavedConversation | null = null;
    if (this.currentConversationId && finalId === this.currentConversationId) {
      try {
        existingData = await this.storageProvider.loadConversation(finalId);
      } catch (error) {
        // Ignore, will create new
      }
    }

    // Generate title if this is a new conversation and we have at least one user message
    let title = existingData?.metadata?.title;
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!title && hasUserMessage && modelOrchestrator) {
      logger.info('Generating conversation title...');
      title = await this.generateTitle(messages, modelOrchestrator);
      logger.info(`Title generated: ${title}`);
    } else if (!title && hasUserMessage) {
      // Fallback: use first user message as title if no orchestrator
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        title = firstUserMsg.content.substring(0, 50).trim();
        if (firstUserMsg.content.length > 50) {
          title += '...';
        }
      }
    }

    const metadata: ConversationMetadata = {
      id: finalId,
      title,
      created: existingData?.metadata?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      messageCount: messages.length,
      workspace,
      summary: existingData?.metadata?.summary,
    };

    const conversation: SavedConversation = {
      metadata,
      messages,
    };

    await this.storageProvider.saveConversation(conversation);

    this.currentConversationId = finalId;
    logger.debug(`Conversation saved: ${finalId}`);

    return finalId;
  }

  /**
   * Load conversation using StorageProvider
   */
  async loadConversation(id: string): Promise<SavedConversation> {
    try {
      const conversation = await this.storageProvider.loadConversation(id);

      if (!conversation) {
        throw new Error(`Conversation not found: ${id}`);
      }

      this.currentConversationId = id;
      logger.debug(`Conversation loaded: ${id}`);

      return conversation;
    } catch (error) {
      logger.error(`Failed to load conversation ${id}`, error);
      throw new Error(`Conversation not found: ${id}`);
    }
  }

  /**
   * List all saved conversations using StorageProvider
   */
  async listConversations(): Promise<ConversationMetadata[]> {
    try {
      const conversations = await this.storageProvider.listConversations();

      // Sort by updated date (most recent first)
      conversations.sort((a, b) =>
        new Date(b.updated).getTime() - new Date(a.updated).getTime()
      );

      return conversations;
    } catch (error) {
      logger.error('Failed to list conversations', error);
      return [];
    }
  }

  /**
   * Delete a conversation using StorageProvider
   */
  async deleteConversation(id: string): Promise<void> {
    try {
      await this.storageProvider.deleteConversation(id);
      logger.debug(`Conversation deleted: ${id}`);

      if (this.currentConversationId === id) {
        this.currentConversationId = null;
      }
    } catch (error) {
      logger.error(`Failed to delete conversation ${id}`, error);
      throw error;
    }
  }

  /**
   * Condense conversation history using the model
   *
   * This reduces token usage while preserving important context.
   * Strategy: Keep system/developer messages (WITHOUT directive - agent will add fresh directive),
   * condense middle messages, keep recent messages.
   *
   * Note: The directive is NOT included in condensed history because the agent
   * will always fetch and prepend the latest directive dynamically.
   */
  async condenseConversation(
    messages: Message[],
    orchestrator: ModelOrchestrator,
    targetMessageCount: number = 20
  ): Promise<Message[]> {
    if (messages.length <= targetMessageCount) {
      return messages;
    }

    logger.info(`Condensing conversation: ${messages.length} → ${targetMessageCount} messages`);

    // Keep system and developer messages (first 2) - these are the base messages WITHOUT directive
    // The agent will dynamically add the directive when constructing messages for the API
    const systemMessage = messages[0];
    const developerMessage = messages[1];

    // Keep recent messages (last 10)
    const recentCount = 10;
    const recentMessages = messages.slice(-recentCount);

    // Messages to condense (middle section)
    const middleMessages = messages.slice(2, -recentCount);

    if (middleMessages.length === 0) {
      return messages;
    }

    try {
      // Create a summary of the middle section
      const conversationText = middleMessages
        .map(msg => {
          const role = msg.role === 'assistant' ? 'Assistant' : 'User';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n');

      const summaryPrompt = `Please provide a concise summary of this conversation that preserves:
1. Key decisions and actions taken
2. Important information discovered
3. Tools used and their results
4. Any unresolved issues or pending tasks

Keep the summary focused and under 500 words.

Conversation to summarize:
${conversationText}`;

      const response = await orchestrator.chat({
        messages: [
          { role: 'user', content: summaryPrompt }
        ],
        temperature: 0.3,
        maxTokens: 1000,
      });

      // Create condensed message
      const condensedMessage: Message = {
        role: 'system',
        content: `[Previous conversation summary]\n\n${response.content}\n\n[Continuing conversation...]`,
      };

      // Return: system + developer + condensed summary + recent messages
      // Note: directive is NOT included here - agent adds it dynamically
      const result = [
        systemMessage,
        developerMessage,
        condensedMessage,
        ...recentMessages,
      ];

      logger.success(`Conversation condensed: ${messages.length} → ${result.length} messages`);

      return result;
    } catch (error) {
      logger.error('Failed to condense conversation', error);
      // Fall back to simple trimming
      return [
        systemMessage,
        developerMessage,
        ...messages.slice(-targetMessageCount + 2),
      ];
    }
  }

  /**
   * Generate a human-readable title for a conversation
   */
  async generateTitle(
    messages: Message[],
    orchestrator: ModelOrchestrator
  ): Promise<string> {
    try {
      // Get first user message
      const firstUserMsg = messages.find(msg => msg.role === 'user');
      if (!firstUserMsg || typeof firstUserMsg.content !== 'string') {
        return 'Untitled Conversation';
      }

      const userMessage = firstUserMsg.content;

      // For very short messages (greetings, etc.), use them directly as title
      if (userMessage.length <= 40) {
        return this.capitalizeFirst(userMessage.trim());
      }

      // For longer messages, try to generate a title
      const titlePrompt = `Create a short 3-5 word title for this message. Just output the title, nothing else:\n\n${userMessage.substring(0, 200)}`;

      const response = await orchestrator.chat({
        messages: [{ role: 'user', content: titlePrompt }],
        temperature: 0.3,
        maxTokens: 20,
      });

      // Clean up the title
      let title = response.content.trim();
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '');
      // Remove trailing punctuation
      title = title.replace(/[.!?]+$/, '');
      // Limit length
      if (title.length > 60) {
        title = title.substring(0, 57) + '...';
      }

      // If title generation failed or produced garbage, use first message
      if (!title || title.length < 3 || title.toLowerCase().includes('untitled')) {
        title = userMessage.substring(0, 40).trim();
        if (userMessage.length > 40) title += '...';
      }

      return title || 'Untitled Conversation';
    } catch (error) {
      logger.error('Failed to generate title', error);
      // Fallback: use first user message
      const firstUserMsg = messages.find(msg => msg.role === 'user');
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        let fallback = firstUserMsg.content.substring(0, 40).trim();
        if (firstUserMsg.content.length > 40) fallback += '...';
        return fallback;
      }
      return 'Untitled Conversation';
    }
  }

  /**
   * Capitalize first letter of string
   */
  private capitalizeFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Generate a summary for a conversation (for metadata)
   */
  async generateSummary(
    messages: Message[],
    orchestrator: ModelOrchestrator
  ): Promise<string> {
    try {
      // Get user messages to understand the conversation topic
      const userMessages = messages
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content)
        .slice(0, 5) // First 5 user messages
        .join('\n');

      const summaryPrompt = `Generate a brief 1-2 sentence summary of this conversation topic:

${userMessages}

Summary:`;

      const response = await orchestrator.chat({
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.3,
        maxTokens: 100,
      });

      return response.content.trim();
    } catch (error) {
      logger.error('Failed to generate summary', error);
      return 'Conversation';
    }
  }

  /**
   * Auto-save conversation periodically
   */
  async autoSave(
    messages: Message[],
    workspace?: string,
    orchestrator?: ModelOrchestrator
  ): Promise<void> {
    try {
      await this.saveConversation(messages, workspace, this.currentConversationId || undefined, orchestrator);
    } catch (error) {
      logger.error('Auto-save failed', error);
    }
  }

  /**
   * Get current conversation ID
   */
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  /**
   * Set current conversation ID
   */
  setCurrentConversationId(id: string | null | undefined): void {
    this.currentConversationId = id || null;
  }
}
