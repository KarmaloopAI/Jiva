/**
 * Conversation Manager
 *
 * Handles conversation persistence, condensing, and restoration.
 */

import { Message } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { ModelOrchestrator } from '../models/orchestrator.js';

export interface ConversationMetadata {
  id: string;
  title?: string; // Human-readable title
  created: string;
  updated: string;
  messageCount: number;
  workspace?: string;
  summary?: string;
}

export interface SavedConversation {
  metadata: ConversationMetadata;
  messages: Message[];
}

export class ConversationManager {
  private conversationsDir: string;
  private currentConversationId: string | null = null;

  constructor() {
    this.conversationsDir = join(homedir(), '.jiva', 'conversations');
  }

  /**
   * Initialize conversations directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.conversationsDir, { recursive: true });
      logger.debug(`Conversations directory: ${this.conversationsDir}`);
    } catch (error) {
      logger.error('Failed to create conversations directory', error);
      throw error;
    }
  }

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `conv-${timestamp}-${random}`;
  }

  /**
   * Get path for a conversation file
   */
  private getConversationPath(id: string): string {
    return join(this.conversationsDir, `${id}.json`);
  }

  /**
   * Save conversation to disk
   */
  async saveConversation(
    messages: Message[],
    workspace?: string,
    conversationId?: string,
    orchestrator?: ModelOrchestrator
  ): Promise<string> {
    const finalId = conversationId || this.currentConversationId || this.generateConversationId();

    // Load existing metadata if updating an existing conversation
    let existingMetadata: ConversationMetadata | undefined;
    if (this.currentConversationId && finalId === this.currentConversationId) {
      try {
        const existing = await this.loadConversation(finalId);
        existingMetadata = existing.metadata;
      } catch (error) {
        // Ignore, will create new metadata
      }
    }

    // Generate title if this is a new conversation and we have at least one user message
    let title = existingMetadata?.title;
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!title && hasUserMessage && orchestrator) {
      logger.info('Generating conversation title...');
      title = await this.generateTitle(messages, orchestrator);
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
      created: existingMetadata?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      messageCount: messages.length,
      workspace,
      summary: existingMetadata?.summary,
    };

    const conversation: SavedConversation = {
      metadata,
      messages,
    };

    const path = this.getConversationPath(finalId);
    await fs.writeFile(path, JSON.stringify(conversation, null, 2), 'utf-8');

    this.currentConversationId = finalId;
    logger.debug(`Conversation saved: ${finalId}`);

    return finalId;
  }

  /**
   * Load conversation from disk
   */
  async loadConversation(id: string): Promise<SavedConversation> {
    const path = this.getConversationPath(id);

    try {
      const data = await fs.readFile(path, 'utf-8');
      const conversation = JSON.parse(data) as SavedConversation;

      this.currentConversationId = id;
      logger.debug(`Conversation loaded: ${id}`);

      return conversation;
    } catch (error) {
      logger.error(`Failed to load conversation ${id}`, error);
      throw new Error(`Conversation not found: ${id}`);
    }
  }

  /**
   * List all saved conversations
   */
  async listConversations(): Promise<ConversationMetadata[]> {
    try {
      const files = await fs.readdir(this.conversationsDir);
      const conversations: ConversationMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = await fs.readFile(
              join(this.conversationsDir, file),
              'utf-8'
            );
            const conversation = JSON.parse(data) as SavedConversation;
            conversations.push(conversation.metadata);
          } catch (error) {
            logger.warn(`Failed to read conversation file: ${file}`);
          }
        }
      }

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
   * Delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
    const path = this.getConversationPath(id);

    try {
      await fs.unlink(path);
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
   * Strategy: Keep system/developer messages, condense middle messages, keep recent messages.
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

    // Keep system and developer messages (first 2)
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
        model: 'gpt-oss-120b',
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
      // Get first few user messages to understand the conversation topic
      const userMessages = messages
        .filter(msg => msg.role === 'user')
        .map(msg => typeof msg.content === 'string' ? msg.content : '[multimodal content]')
        .slice(0, 3) // First 3 user messages
        .join('\n');

      const titlePrompt = `Generate a concise, descriptive title (3-6 words) for this conversation. The title should capture the main topic or task. Do not use quotes or punctuation at the end.

Conversation:
${userMessages}

Title:`;

      const response = await orchestrator.chat({
        model: 'gpt-oss-120b',
        messages: [{ role: 'user', content: titlePrompt }],
        temperature: 0.3,
        maxTokens: 50,
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

      return title || 'Untitled Conversation';
    } catch (error) {
      logger.error('Failed to generate title', error);
      return 'Untitled Conversation';
    }
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
        model: 'gpt-oss-120b',
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
