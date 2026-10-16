/**
 * Conversation Manager
 *
 * Handles conversation persistence, condensing, and restoration.
 * Now uses StorageProvider abstraction for cloud-native support.
 */

import { randomUUID } from 'node:crypto';
import { Message } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { ModelOrchestrator } from '../models/orchestrator.js';
import { StorageProvider } from '../storage/provider.js';
import { SavedConversation } from '../storage/types.js';

// Re-exported for backward compatibility — the canonical definitions now
// live in storage/types.ts (SavedConversation.metadata is typed against
// them, so keeping a second, separately-maintained copy here risked exactly
// the kind of drift that motivated unifying them).
export type { ConversationMetadata, CodeConversationMeta } from '../storage/types.js';
import type { ConversationMetadata, CodeConversationMeta } from '../storage/types.js';

export class ConversationManager {
  private storageProvider: StorageProvider;
  private currentConversationId: string | null = null;
  private defaultConversationId: string | null = null;

  constructor(storageProvider: StorageProvider, orchestrator?: ModelOrchestrator, defaultConversationId?: string) {
    this.storageProvider = storageProvider;
    this.orchestrator = orchestrator;
    this.defaultConversationId = defaultConversationId || null;
  }

  private orchestrator?: ModelOrchestrator;

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(): string {
    return `conv-${randomUUID()}`;
  }

  /**
   * Save conversation using StorageProvider
   */
  async saveConversation(
    messages: Message[],
    workspace?: string,
    conversationId?: string,
    orchestrator?: ModelOrchestrator,
    type?: 'chat' | 'code',
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    codeMeta?: CodeConversationMeta
  ): Promise<string> {
    // Saves (and background title patches) are serialized so a late title
    // patch can never overwrite a newer save of the same conversation.
    return this.serializeWrite(() =>
      this.saveConversationNow(messages, workspace, conversationId, orchestrator, type, tokenUsage, codeMeta),
    );
  }

  private writeChain: Promise<unknown> = Promise.resolve();
  private pendingTitles = new Set<Promise<void>>();

  private serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  /** Heuristic title used until (or instead of) an LLM-generated one. */
  private fallbackTitle(messages: Message[]): string | undefined {
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (!firstUserMsg || typeof firstUserMsg.content !== 'string') return undefined;
    const text = firstUserMsg.content.trim();
    if (text.length <= 40) return this.capitalizeFirst(text);
    return text.substring(0, 50).trim() + '...';
  }

  /**
   * Generate an LLM title off the response path, then patch it into the stored
   * conversation — only if the stored title is still the fallback (the user or
   * a later save may have changed it meanwhile).
   */
  private generateTitleInBackground(
    id: string,
    messages: Message[],
    orchestrator: ModelOrchestrator,
    fallback: string,
  ): void {
    const job = (async () => {
      const generated = await this.generateTitle(messages, orchestrator);
      if (!generated || generated === fallback) return;
      await this.serializeWrite(async () => {
        const stored = await this.storageProvider.loadConversation(id);
        if (!stored || stored.metadata.title !== fallback) return;
        stored.metadata.title = generated;
        await this.storageProvider.saveConversation(stored);
        logger.debug(`Conversation title generated: ${generated}`);
      });
    })()
      .catch((error) => logger.debug('Background title generation failed', error))
      .finally(() => this.pendingTitles.delete(job));
    this.pendingTitles.add(job);
  }

  /** Resolve once all in-flight background title generations have finished (tests, graceful shutdown). */
  async flushPendingTitles(): Promise<void> {
    await Promise.all([...this.pendingTitles]);
  }

  private async saveConversationNow(
    messages: Message[],
    workspace?: string,
    conversationId?: string,
    orchestrator?: ModelOrchestrator,
    type?: 'chat' | 'code',
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    codeMeta?: CodeConversationMeta
  ): Promise<string> {
    const finalId = conversationId || this.currentConversationId || this.defaultConversationId || this.generateConversationId();

    // Use provided orchestrator or fallback to constructor orchestrator
    const modelOrchestrator = orchestrator || this.orchestrator;

    // Load existing conversation if updating
    let existingData: SavedConversation | null = null;
    // The default ID counts too: after a session restore the stored conversation
    // already exists under it, and skipping the load would reset its title,
    // created timestamp and token totals on the first save.
    if (
      finalId === this.currentConversationId ||
      (this.defaultConversationId !== null && finalId === this.defaultConversationId)
    ) {
      try {
        existingData = await this.storageProvider.loadConversation(finalId);
      } catch (error) {
        // Ignore, will create new
      }
    }

    // Title: never block the save (and so the agent's reply) on an LLM call.
    // A new conversation is saved with a heuristic title right away; when an
    // orchestrator is available a better title is generated in the background
    // and patched in afterwards (see generateTitleInBackground).
    let title = existingData?.metadata?.title;
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!title && hasUserMessage) {
      title = this.fallbackTitle(messages);
      if (modelOrchestrator && title) {
        this.generateTitleInBackground(finalId, messages, modelOrchestrator, title);
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
      type: type ?? existingData?.metadata?.type,
      totalPromptTokens: (existingData?.metadata?.totalPromptTokens ?? 0) + (tokenUsage?.promptTokens ?? 0),
      totalCompletionTokens: (existingData?.metadata?.totalCompletionTokens ?? 0) + (tokenUsage?.completionTokens ?? 0),
      totalTokens: (existingData?.metadata?.totalTokens ?? 0) + (tokenUsage?.totalTokens ?? 0),
      mcpServers: codeMeta?.mcpServers ?? existingData?.metadata?.mcpServers,
      maxIterations: codeMeta?.maxIterations ?? existingData?.metadata?.maxIterations,
      harness: codeMeta?.harness ?? existingData?.metadata?.harness,
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
  async listConversations(type?: 'chat' | 'code'): Promise<ConversationMetadata[]> {
    try {
      let conversations = await this.storageProvider.listConversations();

      // Filter by type if specified
      if (type) {
        conversations = conversations.filter(c => {
          // If no type stored, treat as 'chat' for backward compatibility
          const convType = c.type ?? 'chat';
          return convType === type;
        });
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
   * Condense conversation history using the model.
   *
   * This reduces token usage while preserving important context.
   * Uses a structured opencode-style template (Goal / Instructions / Discoveries /
   * Accomplished / Relevant files) that makes the summary actionable for the next agent turn.
   *
   * Strategy: Keep system/developer messages (WITHOUT directive - agent will add fresh directive),
   * condense middle messages, keep recent messages.
   *
   * Note: The directive is NOT included in condensed history because the agent
   * will always fetch and prepend the latest directive dynamically.
   */
  async condenseConversation(
    messages: Message[],
    orchestrator: ModelOrchestrator,
    targetMessageCount: number = 20,
    compactionContext?: { directive?: string; currentGoal?: string }
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
      // Create a summary of the middle section using opencode's structured template
      const conversationText = middleMessages
        .map(msg => {
          if (msg.role === 'tool') {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return `[Tool result]: ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}`;
          }
          const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : msg.role;
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return `${role}: ${content}`;
        })
        .join('\n\n');

      // Build optional context block so the LLM can prioritise what to keep
      const contextParts: string[] = [];
      if (compactionContext?.directive) {
        contextParts.push(`WORKSPACE DIRECTIVE (prioritise retaining context aligned with this):\n${compactionContext.directive}`);
      }
      if (compactionContext?.currentGoal) {
        contextParts.push(`CURRENT GOAL:\n${compactionContext.currentGoal}`);
      }
      const contextBlock = contextParts.length > 0
        ? contextParts.join('\n\n') + '\n\nWhen summarising, prioritise information that directly supports the directive and current goal above.\n\n---\n\n'
        : '';

      // Structured compaction prompt (ported from opencode's compaction.ts)
      const summaryPrompt = `${contextBlock}Provide a detailed summary for continuing our conversation. The summary will be used so another agent can read it and continue the work.

When constructing the summary, follow this template:

## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give that are still relevant]
- [If there is a plan or spec, include information about it so the next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]

---

Conversation to summarise:
${conversationText}

Keep the summary focused and complete — include file paths, function names, and specific changes made.`;

      const response = await orchestrator.chat({
        messages: [
          { role: 'user', content: summaryPrompt }
        ],
        temperature: 0.1, // Low temperature for deterministic summarisation
        maxTokens: 1500,
      });

      // Create condensed message (role: 'user' so it's valid in all API formats)
      const condensedMessage: Message = {
        role: 'user',
        content: `[Context compacted — previous conversation history summarised]\n\n${response.content}\n\n[Continuing conversation...]`,
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
        temperature: 0.1, // Low temperature for deterministic title generation
        // Reasoning models can exhaust max_tokens on thinking, returning empty
        // content. disableThinking (GLM/Qwen3) + reasoningEffort:'low' (gpt-oss,
        // Sarvam) prevent this; max_tokens is left unset so each model uses its
        // configured defaultMaxTokens.
        reasoningEffort: 'low',
        disableThinking: true,
      });

      // Clean up the title: strip inline thinking blocks (GLM-5.2, DeepSeek),
      // then take the last non-empty line (models sometimes emit preamble first).
      let title = this.stripThinkingContent(response.content).trim();
      const lines = title.split('\n').map(l => l.trim()).filter(Boolean);
      title = lines.length > 0 ? lines[lines.length - 1] : '';
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
   * Remove reasoning/thinking blocks that some models (e.g. GLM-5.2,
   * DeepSeek-R1) emit inline in the response content. Handles both
   * properly-closed blocks and truncated/unclosed ones (where the model
   * ran out of token budget mid-thought and never emitted the closing tag).
   * \x3c is the '<' character, used here so the literal tag markers don't
   * appear in the regex source.
   */
  private stripThinkingContent(content: string): string {
    return content
      .replace(/\x3cthink[\s\S]*?\x3c\/think>/g, '') // closed thinking blocks
      .replace(/\x3cthink[\s\S]*$/g, ''); // unclosed (truncated) thinking
  }

  /**
   * Capitalize first letter of string
   */
  private capitalizeFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Auto-save conversation periodically
   */
  async autoSave(
    messages: Message[],
    workspace?: string,
    orchestrator?: ModelOrchestrator,
    type?: 'chat' | 'code',
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    codeMeta?: CodeConversationMeta
  ): Promise<void> {
    try {
      await this.saveConversation(messages, workspace, this.currentConversationId || undefined, orchestrator, type, tokenUsage, codeMeta);
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
    // Explicitly clearing the current conversation means "start a new one" —
    // the default (session) ID must not silently take over and overwrite the
    // previous conversation.
    if (!id) {
      this.defaultConversationId = null;
    }
  }
}
