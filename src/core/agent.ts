/**
 * Jiva Agent - Main Orchestrator
 *
 * Coordinates between models, MCP servers, and workspace to provide
 * autonomous agent capabilities.
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { Message, ModelResponse } from '../models/base.js';
import { formatToolResult } from '../models/harmony.js';
import { logger } from '../utils/logger.js';
import { JivaError } from '../utils/errors.js';

export interface AgentConfig {
  orchestrator: ModelOrchestrator;
  mcpManager: MCPServerManager;
  workspace: WorkspaceManager;
  maxIterations?: number;
  temperature?: number;
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
  private maxIterations: number;
  private temperature: number;
  private conversationHistory: Message[] = [];

  constructor(config: AgentConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.maxIterations = config.maxIterations || 10;
    this.temperature = config.temperature || 0.7;

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
    ];

    const directivePrompt = this.workspace.getDirectivePrompt();
    if (directivePrompt) {
      developerParts.push(directivePrompt);
      developerParts.push('');
    }

    this.conversationHistory.push({
      role: 'developer',
      content: developerParts.join('\n'),
    });
  }

  /**
   * Trim conversation history to prevent WAF blocking and reduce token usage
   * Keeps system + developer messages + last N message pairs
   */
  private trimConversationHistory(maxMessages: number = 10): Message[] {
    // Always keep system and developer messages (first 2 messages)
    const systemMessage = this.conversationHistory[0]; // system
    const developerMessage = this.conversationHistory[1]; // developer

    if (this.conversationHistory.length <= maxMessages + 2) {
      return this.conversationHistory;
    }

    // Keep only the last N messages (after system and developer)
    const recentMessages = this.conversationHistory.slice(-maxMessages);

    return [systemMessage, developerMessage, ...recentMessages];
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

      // Call model
      let response: ModelResponse;
      try {
        response = await this.orchestrator.chat({
          model: 'gpt-oss-120b',
          messages: messagesToSend,
          tools: tools.length > 0 ? tools : undefined,
          temperature: this.temperature,
          maxTokens: 4096,
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

      // No tool calls, this is the final response
      finalResponse = response.content;
      break;
    }

    if (iterations >= this.maxIterations) {
      logger.warn('Max iterations reached');
      finalResponse = finalResponse || 'Maximum iterations reached. Task may be incomplete.';
    }

    return {
      content: finalResponse,
      iterations,
      toolsUsed,
    };
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
   * Cleanup resources
   */
  async cleanup() {
    logger.info('Cleaning up agent resources...');
    await this.mcpManager.cleanup();
  }
}
