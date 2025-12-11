/**
 * Jiva Agent - Main Orchestrator
 *
 * Coordinates between models, MCP servers, and workspace to provide
 * autonomous agent capabilities.
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { ConversationManager } from './conversation-manager.js';
import { Message, ModelResponse } from '../models/base.js';
import { formatToolResult } from '../models/harmony.js';
import { logger } from '../utils/logger.js';
import { JivaError } from '../utils/errors.js';

export interface AgentConfig {
  orchestrator: ModelOrchestrator;
  mcpManager: MCPServerManager;
  workspace: WorkspaceManager;
  conversationManager?: ConversationManager;
  maxIterations?: number;
  temperature?: number;
  autoSave?: boolean;
  condensingThreshold?: number;
}

export interface AgentResponse {
  content: string;
  iterations: number;
  toolsUsed: string[];
}

export class JivaAgent {
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private workspace: WorkspaceManager;
  private conversationManager: ConversationManager | null;
  private maxIterations: number;
  private temperature: number;
  private conversationHistory: Message[] = [];
  private autoSave: boolean;
  private condensingThreshold: number;
  private baseDeveloperMessage: string = ''; // Store base developer content without directive

  constructor(config: AgentConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.conversationManager = config.conversationManager || null;
    this.maxIterations = config.maxIterations || 10;
    this.temperature = config.temperature || 0.7;
    this.autoSave = config.autoSave !== false; // Default true
    this.condensingThreshold = config.condensingThreshold || 30;

    this.initializeSystemPrompt();
  }

  /**
   * Initialize system prompt with directive if available
   */
  private initializeSystemPrompt() {
    // System message - high-level behavior
    const systemParts: string[] = [
      'You are Jiva, an autonomous AI agent designed to help users accomplish tasks efficiently.',
      '',
      `Default workspace directory: ${this.workspace.getWorkspaceDir()}`,
      '',
      'You have broad filesystem access to user directories (subject to OS permissions).',
      'The workspace is your default working area, but you can access files in other user directories as requested.',
    ];

    this.conversationHistory.push({
      role: 'system',
      content: systemParts.join('\n'),
    });

    // Developer message - tool usage instructions and constraints
    // Note: directive is added dynamically via getSystemMessages()
    const developerParts: string[] = [
      'CRITICAL INSTRUCTIONS:',
      '',
      '1. When you need to perform file operations or system tasks, you MUST use the available tools',
      '2. Use tools by outputting: <|call|>tool_name({"param": "value"})<|return|>',
      '3. Do NOT output markdown code blocks or JSON - use the exact format above',
      '4. Tool names are prefixed with the server name (e.g., filesystem__read_file)',
      '5. After calling a tool, wait for the result before responding to the user',
      '6. You can access ANY files/directories - not just the workspace (use absolute paths when needed)',
      '',
      'Guidelines:',
      '- Break down complex tasks into smaller steps',
      '- Use available tools to gather information and perform actions',
      '- Use absolute paths when accessing files outside the workspace',
      '- Provide clear explanations of your reasoning',
      '- Ask for clarification when requirements are ambiguous',
      '',
      'MISSION-DRIVEN COMPLETION:',
      '- You are mission-driven: complete tasks thoroughly before stopping',
      '- Before ending, review: Have I fully accomplished what was asked?',
      '- If blocked or uncertain, explain the issue and ask for guidance',
      '- Only stop when the task is complete OR you need user clarification',
      '- If you encounter errors, try alternative approaches before giving up',
      '',
    ];

    // Store base developer message WITHOUT directive
    this.baseDeveloperMessage = developerParts.join('\n');

    // Add to history (without directive initially)
    this.conversationHistory.push({
      role: 'developer',
      content: this.baseDeveloperMessage,
    });
  }

  /**
   * Get system messages with fresh directive content
   * This ensures the directive is always up-to-date, even if the file changes
   */
  private getSystemMessages(): Message[] {
    const systemMessage = this.conversationHistory[0];

    // Get fresh directive
    const directivePrompt = this.workspace.getDirectivePrompt();

    // Build developer message with fresh directive
    let developerContent = this.baseDeveloperMessage;
    if (directivePrompt) {
      developerContent = `${this.baseDeveloperMessage}\n${directivePrompt}\n`;
      logger.debug('✓ Directive included in system messages');
    }
    // No warning needed - directives are optional for general use

    return [
      systemMessage,
      {
        role: 'developer',
        content: developerContent,
      },
    ];
  }

  /**
   * Trim conversation history to prevent WAF blocking and reduce token usage
   * Keeps system + developer messages (with fresh directive) + last N message pairs
   */
  private trimConversationHistory(maxMessages: number = 10): Message[] {
    // Get fresh system messages with current directive
    const systemMessages = this.getSystemMessages();

    if (this.conversationHistory.length <= maxMessages + 2) {
      // Return system messages + conversation (excluding old system/developer)
      return [...systemMessages, ...this.conversationHistory.slice(2)];
    }

    // Keep only the last N messages (after system and developer)
    const recentMessages = this.conversationHistory.slice(-maxMessages);

    return [...systemMessages, ...recentMessages];
  }

  /**
   * Detect if message is a simple greeting/conversation vs a task request
   */
  private isSimpleConversation(message: string): boolean {
    const greetings = ['hello', 'hi', 'hey', 'howdy', 'greetings', 'good morning', 'good afternoon', 'good evening'];
    const casual = ['how are you', 'how\'s it going', 'what\'s up', 'sup', 'thanks', 'thank you', 'bye', 'goodbye'];
    const lowerMessage = message.toLowerCase().trim();

    // Check if message is very short and matches greeting patterns
    if (message.length < 50) {
      const matches = [...greetings, ...casual].some(pattern =>
        lowerMessage === pattern ||
        lowerMessage.startsWith(pattern + ' ') ||
        lowerMessage.startsWith(pattern + '?') ||
        lowerMessage.startsWith(pattern + '!')
      );
      if (matches) return true;
    }

    return false;
  }

  /**
   * Process a user message and return agent response
   */
  async chat(userMessage: string): Promise<AgentResponse> {
    logger.info('Processing user message...');

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const toolsUsed: string[] = [];
    let iterations = 0;
    let finalResponse = '';

    // Detect if this is simple conversation vs a task
    const isSimple = this.isSimpleConversation(userMessage);
    const hasDirective = !!this.workspace.getDirectivePrompt();

    // Agent loop: iterate until completion or max iterations
    while (iterations < this.maxIterations) {
      iterations++;
      logger.debug(`Agent iteration ${iterations}/${this.maxIterations}`);

      // Get available tools from MCP servers
      const tools = this.mcpManager.getClient().getAllTools();

      // Trim conversation history to prevent WAF blocking
      const messagesToSend = this.trimConversationHistory(20);

      if (messagesToSend.length < this.conversationHistory.length) {
        logger.debug(`Trimmed conversation: ${this.conversationHistory.length} → ${messagesToSend.length} messages`);
      }

      // Call model - let orchestrator determine which model to use
      let response: ModelResponse;
      try {
        response = await this.orchestrator.chat({
          messages: messagesToSend,
          tools: tools.length > 0 ? tools : undefined,
          temperature: this.temperature,
          // Don't set maxTokens - let the API determine based on available context
          // Setting it too high can cause "max_tokens must be at least 1" errors
        });
      } catch (error) {
        logger.error('Model call failed', error);
        throw new JivaError(
          `Failed to get response from model: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Check if there are tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        logger.info(`Model requested ${response.toolCalls.length} tool call(s)`);

        // Execute tool calls
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          logger.info(`Executing tool: ${toolName}`);

          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await this.mcpManager.getClient().executeTool(toolName, args);

            toolsUsed.push(toolName);

            // Add tool result to history
            const toolMessage = formatToolResult(
              toolCall.id,
              toolName,
              result
            );

            this.conversationHistory.push(toolMessage);

            logger.success(`Tool ${toolName} executed successfully`);
          } catch (error) {
            logger.error(`Tool ${toolName} execution failed`, error);

            // Add error as tool result
            this.conversationHistory.push({
              role: 'tool',
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        // Continue loop to process tool results
        continue;
      }

      // No tool calls, check if mission is complete
      finalResponse = response.content;

      // Mission-driven completion check (skip for simple conversations)
      if (!isSimple && iterations < this.maxIterations - 2 && !this.isMissionComplete(response.content)) {
        logger.debug('Mission completion check: task may be incomplete, prompting agent to review');

        // Add a system message to prompt the agent to review completion
        this.conversationHistory.push({
          role: 'system',
          content: 'Before finishing, please review: Have you fully completed the user\'s request? If there are any remaining steps, errors to resolve, or aspects of the task left unfinished, please continue. Only respond "TASK_COMPLETE" if everything is truly done.',
        });

        // Give the agent one more chance to continue
        continue;
      }

      // For simple conversations, stop after first response
      break;
    }

    if (iterations >= this.maxIterations) {
      logger.warn('Max iterations reached');
      finalResponse = finalResponse || 'Maximum iterations reached. Task may be incomplete.';
    }

    // Auto-save conversation if enabled
    if (this.autoSave && this.conversationManager) {
      await this.conversationManager.autoSave(
        this.conversationHistory,
        this.workspace.getWorkspaceDir(),
        this.orchestrator
      );
    }

    // Check if conversation needs condensing
    if (this.conversationHistory.length > this.condensingThreshold && this.conversationManager) {
      logger.info('Conversation threshold reached, condensing...');
      this.conversationHistory = await this.conversationManager.condenseConversation(
        this.conversationHistory,
        this.orchestrator,
        Math.floor(this.condensingThreshold * 0.7)
      );
    }

    return {
      content: finalResponse,
      iterations,
      toolsUsed,
    };
  }

  /**
   * Check if the response indicates mission completion
   */
  private isMissionComplete(response: string): boolean {
    // Simple heuristic: check for completion indicators
    const completionIndicators = [
      'task_complete',
      'completed successfully',
      'finished',
      'done',
      'all set',
      'everything is ready',
    ];

    const lowerResponse = response.toLowerCase();

    // If response is very short, it might be premature
    if (response.length < 50) {
      return false;
    }

    // Check for error indicators
    const errorIndicators = [
      'error',
      'failed',
      'could not',
      'unable to',
      'cannot',
    ];

    if (errorIndicators.some(indicator => lowerResponse.includes(indicator))) {
      return false; // Not complete if there are errors
    }

    // Check for completion indicators
    return completionIndicators.some(indicator => lowerResponse.includes(indicator));
  }

  /**
   * Reset conversation history
   */
  resetConversation() {
    this.conversationHistory = [];
    this.initializeSystemPrompt();
    logger.info('Conversation history reset');
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Set conversation history (for restoring conversations)
   */
  setConversationHistory(messages: Message[]): void {
    this.conversationHistory = messages;
  }

  /**
   * Save current conversation
   */
  async saveConversation(): Promise<string | null> {
    if (!this.conversationManager) {
      logger.warn('Conversation manager not initialized');
      return null;
    }

    const id = await this.conversationManager.saveConversation(
      this.conversationHistory,
      this.workspace.getWorkspaceDir(),
      undefined,
      this.orchestrator
    );

    logger.success(`Conversation saved: ${id}`);
    return id;
  }

  /**
   * Load a conversation
   */
  async loadConversation(id: string): Promise<void> {
    if (!this.conversationManager) {
      throw new JivaError('Conversation manager not initialized');
    }

    const conversation = await this.conversationManager.loadConversation(id);
    this.conversationHistory = conversation.messages;

    logger.success(`Conversation loaded: ${id}`);
  }

  /**
   * List saved conversations
   */
  async listConversations() {
    if (!this.conversationManager) {
      throw new JivaError('Conversation manager not initialized');
    }

    return await this.conversationManager.listConversations();
  }

  /**
   * Get workspace manager
   */
  getWorkspace(): WorkspaceManager {
    return this.workspace;
  }

  /**
   * Get MCP server manager
   */
  getMCPManager(): MCPServerManager {
    return this.mcpManager;
  }

  /**
   * Get model orchestrator
   */
  getOrchestrator(): ModelOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get conversation manager
   */
  getConversationManager(): ConversationManager | null {
    return this.conversationManager;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    logger.info('Cleaning up agent resources...');

    // Final auto-save before cleanup
    if (this.autoSave && this.conversationManager && this.conversationHistory.length > 2) {
      await this.conversationManager.autoSave(
        this.conversationHistory,
        this.workspace.getWorkspaceDir(),
        this.orchestrator
      );
    }

    await this.mcpManager.cleanup();
  }
}
