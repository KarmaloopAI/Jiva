/**
 * Worker Agent - Tool execution and information gathering
 *
 * Responsibilities:
 * - Receive specific subtask from Manager
 * - Use tools to gather information or perform actions
 * - Return results to Manager
 * - No high-level planning or user interaction
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { Message, ModelResponse } from '../models/base.js';
import { formatToolResult } from '../models/harmony.js';
import { logger } from '../utils/logger.js';

export interface WorkerSubtask {
  instruction: string;
  context?: string;
}

export interface WorkerResult {
  success: boolean;
  result: string;
  toolsUsed: string[];
  reasoning: string;
}

export class WorkerAgent {
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private workspace: WorkspaceManager;
  private maxIterations: number = 5; // Worker is focused, shouldn't need many iterations

  constructor(orchestrator: ModelOrchestrator, mcpManager: MCPServerManager, workspace: WorkspaceManager) {
    this.orchestrator = orchestrator;
    this.mcpManager = mcpManager;
    this.workspace = workspace;
  }

  /**
   * Execute a subtask assigned by Manager
   */
  async executeSubtask(subtask: WorkerSubtask): Promise<WorkerResult> {
    logger.info(`[Worker] Starting: "${subtask.instruction}"`);

    const conversationHistory: Message[] = [];
    const toolsUsed: string[] = [];

    // System prompt for Worker
    conversationHistory.push({
      role: 'system',
      content: `You are the Worker Agent in a two-agent system.

ROLE:
You execute specific subtasks using available tools. You do NOT plan or make high-level decisions.

WORKSPACE:
Current working directory: ${this.workspace.getWorkspaceDir()}
When users refer to "current directory", "workspace", "current workspace", or "here", they mean: ${this.workspace.getWorkspaceDir()}

CRITICAL - File Paths:
- DEFAULT to workspace paths: When user mentions relative paths like "src/core" or "./src/core", they mean ${this.workspace.getWorkspaceDir()}/src/core
- ALWAYS use full absolute paths for file/directory operations
- If user explicitly provides an absolute path (e.g., /Users/someone/other/path), use that path as-is
- If user provides a relative path, interpret it relative to: ${this.workspace.getWorkspaceDir()}
- Examples:
  * "src/core" → ${this.workspace.getWorkspaceDir()}/src/core
  * "./config.json" → ${this.workspace.getWorkspaceDir()}/config.json
  * "/Users/abidev/Documents/file.txt" → /Users/abidev/Documents/file.txt (use as-is)

YOUR JOB:
1. Understand the specific subtask you've been assigned
2. Use available tools to gather information or perform actions
3. Report back with clear, factual results
4. Explain your reasoning and what you found

IMPORTANT:
- Focus ONLY on the assigned subtask
- Use FULL ABSOLUTE PATHS for all file/directory operations
- Be thorough but concise
- Explain what you did and what you found
- If you can't complete the task, explain why clearly

Available tools: ${this.mcpManager.getClient().getAllTools().map(t => t.name).join(', ')}`,
    });

    // Add subtask instruction
    conversationHistory.push({
      role: 'user',
      content: `Subtask: ${subtask.instruction}
${subtask.context ? `\nContext: ${subtask.context}` : ''}

Please complete this subtask and report your findings.`,
    });

    let finalResult = '';
    let reasoning = '';

    // Worker execution loop
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      logger.debug(`  [Worker] Iteration ${iteration + 1}/${this.maxIterations}`);

      const tools = this.mcpManager.getClient().getAllTools();
      let response: ModelResponse;

      try {
        response = await this.orchestrator.chat({
          messages: conversationHistory,
          tools: tools.length > 0 ? tools : undefined,
          temperature: 0.3,
        });
      } catch (error) {
        // API error (e.g., invalid tool call parameters)
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`  [Worker] API error - ${errorMsg.substring(0, 100)}...`);

        // Check if we've used up our retries
        if (iteration >= this.maxIterations - 1) {
          logger.error(`  [Worker] Max retries reached after API errors`);
          finalResult = `Failed to complete subtask due to repeated errors: ${errorMsg}`;
          break;
        }

        // Add error feedback to conversation so Worker can correct itself
        logger.info(`  [Worker] Retrying with error feedback (attempt ${iteration + 2}/${this.maxIterations})`);
        conversationHistory.push({
          role: 'user',
          content: `ERROR: The previous action failed with this error:\n${errorMsg}\n\nPlease analyze the error and try again with correct parameters. Make sure you're using the right tool with the right arguments.`,
        });

        continue; // Retry with error feedback
      }

      conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        logger.info(`  [Worker] Using ${response.toolCalls.length} tool(s)`);

        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          logger.info(`  [Worker] Tool: ${toolName}`);

          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await this.mcpManager.getClient().executeTool(toolName, args);

            toolsUsed.push(toolName);

            const toolMessage = formatToolResult(toolCall.id, toolName, result);
            conversationHistory.push(toolMessage);

            logger.debug(`  ✓ [Worker] Tool ${toolName} completed`);
          } catch (error) {
            logger.error(`  ✗ [Worker] Tool ${toolName} failed:`, error);

            conversationHistory.push({
              role: 'tool',
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        // Continue to process tool results
        continue;
      }

      // No tool calls - Worker has finished
      finalResult = response.content;
      reasoning = this.extractReasoning(response.content);

      logger.info(`[Worker] Reasoning: ${reasoning || '(implicit)'}`);
      logger.info(`[Worker] Complete`);

      break;
    }

    if (!finalResult) {
      finalResult = 'Subtask could not be completed within iteration limit.';
      logger.warn(`[Worker] Max iterations reached`);
    }

    return {
      success: !!finalResult && !finalResult.includes('could not be completed'),
      result: finalResult,
      toolsUsed,
      reasoning: reasoning || 'Task executed',
    };
  }

  private extractReasoning(content: string): string {
    // Try to extract reasoning if Worker provides it
    const reasoningMatch = content.match(/(?:Reasoning|Analysis|Approach):?\s*([^\n]+)/i);
    return reasoningMatch ? reasoningMatch[1].trim() : '';
  }
}
