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
import { PersonaManager } from '../personas/persona-manager.js';
import { AgentSpawner } from './agent-spawner.js';
import { Message, MessageContent, ModelResponse, Tool } from '../models/base.js';
import { formatToolResult } from '../models/harmony.js';
import { logger } from '../utils/logger.js';
import { orchestrationLogger } from '../utils/orchestration-logger.js';

interface ToolResultWithImages {
  text: string;
  images?: Array<{
    base64: string;
    mimeType: string;
  }>;
}

interface WorkerContextMemory {
  lastDirectoryPath?: string;
  lastDirectoryListing?: string[];
  lastDirectoryTime?: number;
  recentFileReads: Map<string, { content: string; timestamp: number }>;
  filesJustModified: Set<string>;
}

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
  private personaManager?: PersonaManager;
  private agentSpawner?: AgentSpawner;
  private maxIterations: number;
  private contextMemory: WorkerContextMemory;

  constructor(
    orchestrator: ModelOrchestrator,
    mcpManager: MCPServerManager,
    workspace: WorkspaceManager,
    maxIterations: number = 5,
    personaManager?: PersonaManager
  ) {
    this.orchestrator = orchestrator;
    this.mcpManager = mcpManager;
    this.workspace = workspace;
    this.personaManager = personaManager;
    this.maxIterations = maxIterations;
    this.contextMemory = {
      recentFileReads: new Map(),
      filesJustModified: new Set(),
    };
  }

  /**
   * Set agent spawner (enables sub-agent spawning)
   */
  setAgentSpawner(spawner: AgentSpawner): void {
    this.agentSpawner = spawner;
  }

  /**
   * Execute a subtask assigned by Manager
   */
  async executeSubtask(subtask: WorkerSubtask): Promise<WorkerResult> {
    logger.info(`[Worker] Starting: "${subtask.instruction}"`);
    orchestrationLogger.logWorkerStart(subtask.instruction, subtask.context || '');

    // Reset context memory for new subtask
    this.contextMemory = {
      recentFileReads: new Map(),
      filesJustModified: new Set(),
    };

    const conversationHistory: Message[] = [];
    const toolsUsed: string[] = [];
    let iterationCount = 0;

    // Build system prompt for Worker
    const personaPrompt = this.personaManager?.getSystemPromptAddition() || '';
    let systemContent = `You are the Worker Agent in a two-agent system.

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

CRITICAL - Avoid Repetitive Actions:
- NEVER call the same tool with the same arguments more than once
- If a tool succeeds, move on to the next step - do NOT repeat it
- For browser tasks: open tab ONCE, then navigate ONCE to the URL
- If you've already created/opened something, don't create/open it again

BROWSER TASKS:
- To open a URL: First use playwright__browser_tabs to create a new tab, THEN use playwright__browser_navigate to go to the URL
- Both steps are required - creating a tab alone does NOT navigate to a URL
- After navigation succeeds, the task is COMPLETE - stop and report success

Available tools: ${this.mcpManager.getClient().getAllTools().map(t => t.name).join(', ')}${this.agentSpawner && this.agentSpawner.canSpawnMore() ? ', spawn_agent' : ''}`;

    // Add spawn_agent documentation only if depth allows spawning
    if (this.agentSpawner && this.agentSpawner.canSpawnMore()) {
      const availablePersonas = this.agentSpawner.getAvailablePersonas();
      systemContent += `\n\nAGENT SPAWNING:
- You can spawn sub-agents with specific personas to delegate complex tasks
- Use spawn_agent tool when you need specialized expertise or parallel work
- Tool: spawn_agent
- Parameters:
  * persona (required): Persona name - ${availablePersonas.join(', ')}
  * task (required): Specific task for the sub-agent
  * context (optional): Additional context or background info
- Example: spawn_agent({ persona: "code-reviewer", task: "Review the authentication code in src/auth/", context: "Focus on security issues" })
- The sub-agent will complete the task and return results to you`;
    }

    if (personaPrompt) {
      systemContent += `\n\n${personaPrompt}`;
    }

    // System prompt for Worker
    // Use 'developer' role for Harmony format compatibility (will be converted to 'system' by model)
    conversationHistory.push({
      role: 'developer' as any,  // Harmony format requires 'developer' for tool injection
      content: systemContent,
    });

    logger.debug(`  [Worker] System prompt includes: Available tools: ${this.mcpManager.getClient().getAllTools().map(t => t.name).join(', ')}`);

    // Add subtask instruction
    conversationHistory.push({
      role: 'user',
      content: `Subtask: ${subtask.instruction}
${subtask.context ? `\nContext: ${subtask.context}` : ''}

Please complete this subtask and report your findings.`,
    });

    let finalResult = '';
    let reasoning = '';
    let pendingImages: Array<{ base64: string; mimeType: string }> = [];

    // Worker execution loop
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      iterationCount = iteration + 1;
      logger.debug(`  [Worker] Iteration ${iteration + 1}/${this.maxIterations}`);
      orchestrationLogger.logWorkerIteration(iteration + 1, this.maxIterations);

      const mcpTools = this.mcpManager.getClient().getAllTools();
      
      // Add spawn_agent tool only if depth limit allows spawning
      const tools = [...mcpTools];
      
      if (this.agentSpawner && this.agentSpawner.canSpawnMore()) {
        const spawnAgentTool: Tool = {
          name: 'spawn_agent',
          description: 'Spawn a sub-agent with a specific persona to delegate complex tasks',
          parameters: {
            type: 'object',
            properties: {
              persona: {
                type: 'string',
                description: 'The persona name for the sub-agent (e.g., "code-reviewer", "developer", "tester")',
              },
              task: {
                type: 'string',
                description: 'Specific task for the sub-agent to complete',
              },
              context: {
                type: 'string',
                description: 'Optional additional context or background information',
              },
              maxIterations: {
                type: 'number',
                description: 'Optional maximum iterations for the sub-agent (default: 10)',
              },
            },
            required: ['persona', 'task'],
          },
        };
        tools.push(spawnAgentTool);
      }
      
      logger.info(`  [Worker] Tools available: ${tools.length}`);
      if (tools.length > 0) {
        logger.debug(`  [Worker] Tool names: ${tools.map(t => t.name).join(', ')}`);
      } else {
        logger.warn(`  [Worker] WARNING: No tools available! MCP servers may not be connected.`);
      }
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

        // Detect repetitive tool calls BEFORE executing
        const proposedTools = response.toolCalls.map(tc => {
          const args = JSON.parse(tc.function.arguments);
          return `${tc.function.name}:${JSON.stringify(args)}`;
        });
        
        // Check if we're about to repeat the same tool call
        const lastToolCalls = toolsUsed.slice(-2);
        const isRepetitive = proposedTools.some(proposed => {
          const toolName = proposed.split(':')[0];
          return lastToolCalls.filter(t => t === toolName).length >= 2;
        });

        if (isRepetitive && iteration >= 2) {
          logger.warn(`  [Worker] Detected repetitive tool usage - interrupting loop`);
          conversationHistory.push({
            role: 'user',
            content: `STOP: You are repeating the same action multiple times. This tool has already succeeded. 

For browser tasks:
1. You already created a new tab - do NOT create another one
2. Now use playwright__browser_navigate to go to the actual URL
3. If navigation is already done, the task is COMPLETE - just provide your summary

Do NOT call the same tool again. Either move to the NEXT required step, or if the task is complete, provide your final summary WITHOUT any tool calls.`,
          });
          continue; // Skip executing the repetitive tools, let model reconsider
        }

        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          logger.info(`  [Worker] Tool: ${toolName}`);

          try {
            const args = JSON.parse(toolCall.function.arguments);
            orchestrationLogger.logWorkerToolCall(toolName, args);

            // Handle spawn_agent specially
            if (toolName === 'spawn_agent') {
              if (!this.agentSpawner) {
                throw new Error('Agent spawning is not enabled');
              }

              logger.info(`  [Worker] Spawning sub-agent with persona: ${args.persona}`);
              const spawnResult = await this.agentSpawner.spawnAgent({
                persona: args.persona,
                task: args.task,
                context: args.context,
                maxIterations: args.maxIterations,
              });

              toolsUsed.push(toolName);

              const resultText = `Sub-agent spawned with persona '${spawnResult.persona}' completed the task.

RESULT:
${spawnResult.result}

Iterations: ${spawnResult.iterations}
Tools used: ${spawnResult.toolsUsed.join(', ')}`;

              orchestrationLogger.logWorkerToolResult(toolName, true, false);

              const toolMessage = formatToolResult(toolCall.id, toolName, resultText);
              conversationHistory.push(toolMessage);

              logger.success(`  ✓ [Worker] Sub-agent completed task`);
              continue;
            }

            // Regular MCP tool execution
            const result = await this.mcpManager.getClient().executeTool(toolName, args);

            toolsUsed.push(toolName);

            // Check if tool returned images (multimodal support)
            let toolResultText: string;
            let hasImages = false;
            if (typeof result === 'object' && result !== null && 'images' in result) {
              const typedResult = result as ToolResultWithImages;
              toolResultText = typedResult.text;

              if (typedResult.images && typedResult.images.length > 0) {
                hasImages = true;
                logger.info(`  [Worker] Tool returned ${typedResult.images.length} image(s), will attach to next model call`);
                pendingImages.push(...typedResult.images);
              }
            } else {
              toolResultText = typeof result === 'string' ? result : JSON.stringify(result);
            }

            orchestrationLogger.logWorkerToolResult(toolName, true, hasImages);

            const toolMessage = formatToolResult(toolCall.id, toolName, toolResultText);
            conversationHistory.push(toolMessage);

            logger.debug(`  ✓ [Worker] Tool ${toolName} completed`);
          } catch (error) {
            logger.error(`  ✗ [Worker] Tool ${toolName} failed:`, error);
            orchestrationLogger.logWorkerToolResult(toolName, false, false);

            conversationHistory.push({
              role: 'tool',
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        // If images are pending, attach them to next model call
        if (pendingImages.length > 0) {
          logger.info(`  [Worker] Attaching ${pendingImages.length} image(s) to next model call for analysis`);

          // Build message with images
          const imageMessage: Message = {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'I have executed the tools. Please analyze the results (including any images) and continue with the task.',
              },
              ...pendingImages.map(img => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${img.mimeType};base64,${img.base64}`,
                },
              })),
            ],
          };

          conversationHistory.push(imageMessage);
          pendingImages = []; // Clear for next iteration
        }

        // After processing tool calls, check if we should prompt for completion
        // This helps Worker recognize when task is done instead of over-iterating
        const shouldPromptCompletion = this.shouldPromptForCompletion(
          subtask.instruction,
          toolsUsed,
          iteration
        );

        if (shouldPromptCompletion) {
          logger.debug(`  [Worker] Prompting for task completion check`);
          conversationHistory.push({
            role: 'user',
            content: `You have successfully executed the required tools. Please confirm if the subtask is now complete and provide a summary of what was accomplished. If complete, do not call any more tools - just respond with your summary.`,
          });
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
      // Max iterations reached - but check if work was actually done successfully
      const hasSuccessfulTools = toolsUsed.length > 0;
      const hasToolFailures = conversationHistory.some(msg => {
        if (msg.role === 'tool' && msg.content) {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return content.includes('Error:');
        }
        return false;
      });

      if (hasSuccessfulTools && !hasToolFailures) {
        // Tools executed successfully, just model didn't stop naturally
        finalResult = `Task work completed (${toolsUsed.length} operations performed). Max iterations reached but all tool operations succeeded.`;
        logger.info(`[Worker] Max iterations reached, but ${toolsUsed.length} tools executed successfully`);
      } else if (hasToolFailures) {
        finalResult = 'Subtask encountered errors and could not be completed within iteration limit.';
        logger.warn(`[Worker] Max iterations reached with tool failures`);
      } else {
        finalResult = 'Subtask could not be completed within iteration limit.';
        logger.warn(`[Worker] Max iterations reached with no work done`);
      }
    }

    // Determine success: true if we got a result and it doesn't indicate failure
    const success = !!finalResult &&
                   !finalResult.includes('could not be completed') &&
                   !finalResult.includes('encountered errors');
    orchestrationLogger.logWorkerComplete(success, toolsUsed, iterationCount);

    return {
      success,
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

  /**
   * Determine if we should prompt Worker to check for completion
   * This helps prevent over-iteration by asking Worker to confirm task is done
   */
  private shouldPromptForCompletion(
    instruction: string,
    toolsUsed: string[],
    currentIteration: number
  ): boolean {
    // Don't prompt on first iteration - let Worker do initial work
    if (currentIteration === 0) {
      return false;
    }

    // Immediate prompt after browser navigation - that's usually the end of the task
    const hasBrowserNavigation = toolsUsed.some(tool => tool.includes('browser_navigate'));
    if (hasBrowserNavigation) {
      return true;
    }

    // Detect repetitive tool usage - sign of stuck loop
    const lastThreeTools = toolsUsed.slice(-3);
    if (lastThreeTools.length === 3 && 
        lastThreeTools[0] === lastThreeTools[1] && 
        lastThreeTools[1] === lastThreeTools[2]) {
      return true; // Same tool called 3 times in a row - prompt for completion
    }

    // Don't prompt too frequently - only every 2 iterations after first
    if (currentIteration % 2 !== 0) {
      return false;
    }

    // Check if this looks like a completion-oriented task
    const completionIndicators = [
      'create', 'write', 'generate', 'build', 'make',
      'read', 'list', 'find', 'search', 'get',
      'update', 'modify', 'edit', 'change',
      'delete', 'remove', 'open', 'navigate', 'browse',
    ];

    const instructionLower = instruction.toLowerCase();
    const hasCompletionIndicator = completionIndicators.some(indicator =>
      instructionLower.includes(indicator)
    );

    // Prompt if we've seen successful file/content or browser operations
    const hasSignificantOperations = toolsUsed.some(tool =>
      tool.includes('write') ||
      tool.includes('create') ||
      tool.includes('edit') ||
      tool.includes('read') ||
      tool.includes('browser') ||
      tool.includes('navigate')
    );

    // Prompt if we have completion indicators and significant operations
    return hasCompletionIndicator && hasSignificantOperations && toolsUsed.length >= 2;
  }
}
