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
import { AgentContext } from './types/agent-context.js';
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

export interface ToolFailure {
  toolName: string;
  args: Record<string, any>;
  lastError: string;
  attempts: number;
}

export interface WorkerResult {
  success: boolean;
  result: string;
  toolsUsed: string[];
  failedTools: ToolFailure[];
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
    maxIterations: number = 20,
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
    
    // Set persona context for logging
    if (personaManager) {
      const activePersona = personaManager.getActivePersona();
      if (activePersona) {
        logger.setPersonaContext(activePersona.manifest.name);
      }
    }
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
  async executeSubtask(subtask: WorkerSubtask, agentContext?: AgentContext): Promise<WorkerResult> {
    logger.info(`[Worker] Starting: "${subtask.instruction}"`);
    orchestrationLogger.logWorkerStart(subtask.instruction, subtask.context || '');

    // Reset context memory for new subtask
    this.contextMemory = {
      recentFileReads: new Map(),
      filesJustModified: new Set(),
    };

    const conversationHistory: Message[] = [];
    const toolsUsed: string[] = [];
    // Tracks every exact tool-call signature (toolName + serialized args) executed
    // during this subtask. Used to prevent the same call from being repeated in a
    // later iteration — e.g. reading the same file twice in consecutive turns.
    const executedToolSignatures = new Set<string>();
    // Tracks consecutive failures per (toolName:args) signature.
    // Drives the per-tool circuit breaker: warn at 2, hard-stop at 3.
    const toolFailureCounts = new Map<string, { count: number; lastError: string }>();
    let iterationCount = 0;

    // ── 2+2 API-level JSON parse failure strategy ─────────────────────────────
    // Priority: if a dedicated tool-calling LLM is configured, use it from the
    // very first iteration (it reliably serialises tool args as standard JSON).
    // The reasoning model then serves as the phase-2 fallback.
    // If no tool-calling model is configured the roles are reversed: reasoning
    // model is phase 1 and there is no phase-2 fallback.
    //
    // Flow when tool-calling model IS configured:
    //   Phase 1 – tool-calling model  (up to API_PARSE_FAIL_THRESHOLD=2 failures)
    //   Phase 2 – reasoning model     (up to SECONDARY_MODEL_ATTEMPTS=2 failures)
    //   → hard-stop after 4 total failures; failedTools is non-empty so the
    //     Client's data-driven CompletionSignal fires (prevents infinite retries)
    //
    // Flow when NO tool-calling model is configured:
    //   Phase 1 – reasoning model     (up to API_PARSE_FAIL_THRESHOLD=2 failures)
    //   → hard-stop immediately (no secondary model available)
    const API_PARSE_FAIL_THRESHOLD = 2;      // phase-1 failures before switching phases
    const SECONDARY_MODEL_ATTEMPTS = 2;      // extra attempts on the phase-2 model
    let apiJsonParseFailures = 0;            // total JSON-parse failures so far
    // toolCallingIsMain: true when the tool-calling model is the primary model for this run
    const toolCallingIsMain = this.orchestrator.hasToolCallingModel();
    // useToolCallingFallback: flag passed to orchestrator.chatWithFallback()
    //   true  → use the tool-calling model
    //   false → use the reasoning model
    let useToolCallingFallback = toolCallingIsMain; // start with tool-calling model if available
    let phaseSwitched = false;               // true once we have swapped phases
    const API_JSON_PARSE_FAILURE_SIG = 'api_json_parse:{}'; // key in toolFailureCounts

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
- Sub-agents automatically receive the current workspace path (${this.workspace.getWorkspaceDir()})
- Tool: spawn_agent
- Parameters:
  * persona (required): Persona name - ${availablePersonas.join(', ')}
  * task (required): Specific task for the sub-agent
  * context (optional): Additional domain-specific context (workspace path is automatically included)
- IMPORTANT: When spawning a sub-agent, include relevant directive constraints and a brief conversation summary in the context parameter so the sub-agent has sufficient background.
- Example: spawn_agent({ persona: "code-reviewer", task: "Review the authentication code in src/auth/", context: "Focus on security vulnerabilities and best practices" })
- The sub-agent will complete the task and return results to you`;
    }

    if (personaPrompt) {
      systemContent += `\n\n${personaPrompt}`;
    }

    // Inject directive into Worker prompt (fixes bug: Worker previously had no directive)
    const directivePrompt = agentContext?.directive || this.workspace.getDirectivePrompt() || '';
    if (directivePrompt) {
      systemContent += `\n\n${directivePrompt}`;
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
    // Tracks how many consecutive iterations have been short-circuited by the
    // exact-duplicate dedup guard (same tool + args already executed).  If the
    // model keeps proposing the same call despite repeated warnings we break out
    // and fall through to the forced-synthesis path rather than burning the
    // entire remaining iteration budget on no-op `continue` statements.
    let consecutiveDedupCount = 0;
    const MAX_CONSECUTIVE_DEDUP = 3;

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
        response = await this.orchestrator.chatWithFallback({
          messages: conversationHistory,
          tools: tools.length > 0 ? tools : undefined,
          temperature: 0.1, // Low temperature for deterministic tool execution
        }, useToolCallingFallback);
      } catch (error) {
        // API error (e.g., invalid tool call parameters)
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`  [Worker] API error - ${errorMsg.substring(0, 100)}...`);

        // Detect the specific "Failed to parse tool call arguments as JSON" pattern.
        // These 400 errors originate from the model generating malformed JSON for
        // tool call arguments (e.g. large content with special Unicode characters).
        // A generic "retry with error feedback" loop cannot fix this — the same model
        // will keep producing the same malformed output. We need a different approach.
        const isJsonParseError =
          errorMsg.includes('Failed to parse tool call arguments as JSON') ||
          errorMsg.includes('tool_use_failed');

        if (isJsonParseError) {
          apiJsonParseFailures++;
          // Record in toolFailureCounts so failedTools is always non-empty on exit.
          // This ensures the Client's data-driven CompletionSignal fires (strategy=escalate)
          // rather than the LLM-based path that would return strategy=retry, causing an
          // infinite correction-subtask loop.
          toolFailureCounts.set(API_JSON_PARSE_FAILURE_SIG, {
            count: apiJsonParseFailures,
            lastError: errorMsg,
          });

          const totalBudget = API_PARSE_FAIL_THRESHOLD + SECONDARY_MODEL_ATTEMPTS;

          if (!phaseSwitched && apiJsonParseFailures >= API_PARSE_FAIL_THRESHOLD) {
            // Phase 1 exhausted — attempt a phase switch
            phaseSwitched = true;

            if (toolCallingIsMain) {
              // Tool-calling model (primary) failed → fall back to reasoning model
              useToolCallingFallback = false;
              logger.warn(
                `  [Worker] Tool-calling model failed JSON tool-call serialisation ` +
                `${apiJsonParseFailures} time(s) — switching to reasoning model for ` +
                `up to ${SECONDARY_MODEL_ATTEMPTS} more attempt(s)`
              );
              conversationHistory.push({
                role: 'user',
                content:
                  `NOTE: The previous model had trouble formatting its tool call as valid JSON. ` +
                  `A different model is now being used. Please re-attempt the task — ` +
                  `use the same tools but ensure all argument values are valid JSON ` +
                  `(avoid raw special characters inside string values; escape them if needed).`,
              });
              continue; // retry with reasoning model
            } else if (this.orchestrator.hasToolCallingModel()) {
              // Reasoning model (primary) failed → switch to tool-calling model
              useToolCallingFallback = true;
              logger.warn(
                `  [Worker] Reasoning model failed JSON tool-call serialisation ` +
                `${apiJsonParseFailures} time(s) — switching to tool-calling LLM for ` +
                `up to ${SECONDARY_MODEL_ATTEMPTS} more attempt(s)`
              );
              conversationHistory.push({
                role: 'user',
                content:
                  `NOTE: The previous model had trouble formatting its tool call as valid JSON. ` +
                  `A different model is now being used. Please re-attempt the task — ` +
                  `use the same tools but ensure all argument values are valid JSON ` +
                  `(avoid raw special characters inside string values; escape them if needed).`,
              });
              continue; // retry with fallback model active
            } else {
              // No secondary model configured — hard-stop immediately
              logger.error(
                `  [Worker] JSON serialisation failure — no secondary model configured. ` +
                `Hard-stopping after ${apiJsonParseFailures} attempt(s).`
              );
              finalResult =
                `Task failed: The reasoning model could not generate valid tool-call JSON ` +
                `after ${apiJsonParseFailures} attempt(s). ` +
                `Error: ${errorMsg}. ` +
                `Tip: configure a tool-calling LLM in Jiva settings to enable automatic fallback.`;
              break;
            }
          } else if (apiJsonParseFailures >= totalBudget) {
            // Phase 2 also exhausted — hard-stop
            const primaryLabel = toolCallingIsMain ? 'tool-calling' : 'reasoning';
            const secondaryLabel = toolCallingIsMain ? 'reasoning' : 'tool-calling';
            logger.error(
              `  [Worker] Both ${primaryLabel} and ${secondaryLabel} models failed JSON serialisation. ` +
              `Hard-stopping after ${apiJsonParseFailures} total attempt(s).`
            );
            finalResult =
              `Task failed: Both the ${primaryLabel} model and the ${secondaryLabel} fallback model ` +
              `could not generate valid tool-call JSON after ${apiJsonParseFailures} total attempt(s). ` +
              `Error: ${errorMsg}.`;
            break;
          }

          // Still within budget — add informative error and let the (possibly switched) model retry
          logger.info(
            `  [Worker] JSON parse failure ${apiJsonParseFailures}/${totalBudget} — ` +
            `retrying with ${useToolCallingFallback ? 'tool-calling model' : 'reasoning model'} ` +
            `(attempt ${iteration + 2}/${this.maxIterations})`
          );
          conversationHistory.push({
            role: 'user',
            content:
              `ERROR: The model produced a tool call with invalid JSON arguments.\n` +
              `Specific error: ${errorMsg}\n\n` +
              `This usually happens with large file content containing special characters. ` +
              `To fix this:\n` +
              `1. Escape all special characters in string values (\\n, \\t, \\\\, etc.)\n` +
              `2. Wrap Unicode symbols as plain ASCII equivalents (e.g. use [ ] instead of ☐)\n` +
              `3. If the content is very long, write it to the file in smaller chunks\n` +
              `Please retry the tool call with corrected arguments.`,
          });
          continue;
        }

        // Context-overflow error — retrying with more feedback makes it worse
        // (each appended message grows the context further). Hard-stop immediately.
        const isContextOverflow =
          errorMsg.includes('reduce the length') ||
          errorMsg.includes('context_length_exceeded') ||
          errorMsg.includes('maximum context length') ||
          errorMsg.includes('token limit') ||
          errorMsg.includes('too long');

        if (isContextOverflow) {
          logger.error(`  [Worker] Context overflow — stopping retry loop to avoid death spiral`);
          const hasWork = toolsUsed.length > 0;
          if (hasWork) {
            // Attempt synthesis from what was gathered before overflow
            try {
              const synthHistory = conversationHistory.slice(0, 3); // system + user task only
              synthHistory.push({
                role: 'user',
                content:
                  `The conversation history grew too large for the model to continue. ` +
                  `Tools used so far: ${toolsUsed.join(', ')}. ` +
                  `Please write a concise summary of the work completed based on the subtask instruction.`,
              });
              const synthResponse = await this.orchestrator.chatWithFallback(
                { messages: synthHistory },
                useToolCallingFallback,
              );
              finalResult = synthResponse.content || `Partial completion: context overflow after ${toolsUsed.length} tool(s). Tools used: ${toolsUsed.join(', ')}.`;
            } catch {
              finalResult = `Partial completion: context overflow after ${toolsUsed.length} tool(s). Tools used: ${toolsUsed.join(', ')}.`;
            }
          } else {
            finalResult = `Task could not be completed: context overflow on first API call. The system prompt or subtask context may be too large.`;
          }
          break;
        }

        // Non-JSON-parse API error — regular retry with error feedback
        if (iteration >= this.maxIterations - 1) {
          logger.error(`  [Worker] Max retries reached after API errors`);
          finalResult = `Failed to complete subtask due to repeated errors: ${errorMsg}`;
          break;
        }

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

        // Detect repetitive tool calls BEFORE executing.
        // Only block exact-same (tool + args) duplicates — calling the same tool
        // with DIFFERENT arguments (e.g. yfinance_get_ticker_info for MSFT then NVDA)
        // is intentional and must NOT be blocked.
        const proposedTools = response.toolCalls.map(tc => {
          const args = JSON.parse(tc.function.arguments);
          return `${tc.function.name}:${JSON.stringify(args)}`;
        });

        const exactDuplicate = proposedTools.some(sig => executedToolSignatures.has(sig));

        if (exactDuplicate) {
          const dupSig = proposedTools.find(sig => executedToolSignatures.has(sig)) || '';
          const dupToolName = dupSig.split(':')[0];
          consecutiveDedupCount++;
          logger.warn(`  [Worker] Detected repetitive tool usage (${consecutiveDedupCount}/${MAX_CONSECUTIVE_DEDUP}) - interrupting loop`);

          if (consecutiveDedupCount >= MAX_CONSECUTIVE_DEDUP) {
            // Model is stuck in a dedup loop — it has ignored repeated warnings.
            // Break out now so the post-loop forced-synthesis path can still
            // produce a useful result from the tools that DID succeed.
            logger.warn(`  [Worker] Dedup threshold reached (${MAX_CONSECUTIVE_DEDUP} consecutive) — breaking out to synthesis`);
            conversationHistory.push({
              role: 'user',
              content: `FINAL STOP: You have attempted to call \`${dupToolName}\` with the same arguments ${consecutiveDedupCount} times in a row. This call is permanently blocked. You MUST now write your final summary using only the data already collected — do NOT call any more tools.`,
            });
            break; // Exit loop → falls through to forced-synthesis path
          }

          conversationHistory.push({
            role: 'user',
            content: `STOP: You already called \`${dupToolName}\` with these exact arguments in a previous step. Do NOT repeat the same call.

You have two choices:
1. If more work remains (e.g. other symbols, other queries), call the tool with DIFFERENT arguments now.
2. If all required work is genuinely complete, respond with a thorough description of everything accomplished — do NOT call any more tools.`,
          });
          continue; // Skip executing the repetitive tools, let model reconsider
        }

        // Successful tool path — reset consecutive dedup counter
        consecutiveDedupCount = 0;

        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          logger.info(`  [Worker] Tool: ${toolName}`);

          // Parse args outside the try block so the catch block can reference
          // them for the failure signature (circuit breaker key).
          let args: Record<string, any> = {};
          try { args = JSON.parse(toolCall.function.arguments); } catch { /* use empty */ }
          const failureSig = `${toolName}:${JSON.stringify(args)}`;

          try {
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
              executedToolSignatures.add(`${toolName}:${JSON.stringify(args)}`);

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

            // Catch dry-run file edits before they execute.
            // Some MCP filesystem tools (e.g. filesystem__edit_file) accept a
            // `dryRun: true` flag that previews the edit without writing it.
            // Models occasionally use this as a "safety check" and then forget
            // to make the real call, leaving files unchanged.
            // We let the dry-run through so the model sees the preview, then
            // immediately remind it that the file was NOT actually modified.
            const isDryRun =
              args.dryRun === true &&
              (toolName.includes('edit_file') || toolName.includes('write_file') || toolName.includes('create_file'));

            // Regular MCP tool execution
            const result = await this.mcpManager.getClient().executeTool(toolName, args);

            toolsUsed.push(toolName);
            executedToolSignatures.add(`${toolName}:${JSON.stringify(args)}`);

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

            // If the model used dryRun=true the file was NOT modified.
            // Inject a reminder so the model makes the real call next.
            if (isDryRun) {
              logger.warn(`  [Worker] ${toolName} executed with dryRun=true — file NOT modified; injecting reminder`);
              conversationHistory.push({
                role: 'user',
                content: `Note: You called \`${toolName}\` with \`dryRun: true\`. This was a preview only — the file was NOT actually modified. You MUST call \`${toolName}\` again WITHOUT \`dryRun: true\` to actually apply the change.`,
              });
            }

            logger.debug(`  ✓ [Worker] Tool ${toolName} completed`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`  ✗ [Worker] Tool ${toolName} failed:`, error);
            orchestrationLogger.logWorkerToolResult(toolName, false, false);

            // Always push the raw tool error so the LLM sees what happened
            conversationHistory.push({
              role: 'tool',
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: ${errorMsg}`,
            });

            // Per-tool circuit breaker: track failure count by exact (tool, args) signature
            const prev = toolFailureCounts.get(failureSig) || { count: 0, lastError: '' };
            const newCount = prev.count + 1;
            toolFailureCounts.set(failureSig, { count: newCount, lastError: errorMsg });

            if (newCount === 2) {
              // Second failure: explicit warning to the LLM to change approach
              conversationHistory.push({
                role: 'user',
                content: `WARNING: Tool \`${toolName}\` has now failed twice with the same arguments.\nError: ${errorMsg}\n\nDo NOT call this tool with the same arguments again. Try a different approach, different arguments, or a completely different tool to achieve the same goal.`,
              });
              logger.warn(`  [Worker] Tool ${toolName} has failed twice — warning injected`);
            } else if (newCount >= 3) {
              // Third failure: hard stop — block the tool and force honest exit
              // Add to executedToolSignatures so the exact-dedup guard prevents further calls
              executedToolSignatures.add(failureSig);
              conversationHistory.push({
                role: 'user',
                content: `HARD STOP: Tool \`${toolName}\` has failed ${newCount} times and will NOT succeed with these arguments.\nFinal error: ${errorMsg}\n\nYou MUST stop attempting this tool. Respond now with an honest report of what you tried and why it failed. Do not call any more tools — just describe the failure clearly so the user can be informed.`,
              });
              logger.warn(`  [Worker] Tool ${toolName} circuit breaker triggered after ${newCount} failures`);
            }
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
          toolsUsed,
          iteration
        );

        if (shouldPromptCompletion) {
          logger.debug(`  [Worker] Prompting for task completion check`);
          conversationHistory.push({
            role: 'user',
            content: `Your most recent tools have run. Review the subtask instruction and the tool results above.

Is the subtask fully complete?

- If YES (all required work is done): respond with a thorough, detailed account of exactly what was accomplished — include file paths, content written, commands run, outputs observed, and any other relevant facts. Do NOT call any more tools.
- If NO (more work remains): continue immediately with the next required tool call. Do not stop early.

IMPORTANT: Do not claim completion unless the core deliverable (e.g. the file written, the data fetched, the action performed) is confirmed done. A directory being created is NOT the same as the file inside it being written.`,
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
        // Tools ran successfully but the model never produced a conclusive text
        // response.  All the gathered data is in conversationHistory — make one
        // final LLM call with NO tools so the model is forced to synthesise a
        // text answer from what it already has rather than calling more tools.
        logger.warn(`[Worker] Max iterations reached after ${toolsUsed.length} tool(s) — forcing synthesis response`);
        try {
          // Use a TRIMMED history (system prompt + original task only) so the
          // model is not exposed to 100s of iterations of prior tool-call context.
          // Sending the full conversationHistory risks the reasoning model
          // "seeing" all the previous tool calls and attempting another one —
          // which Groq rejects with HTTP 400 ("tool_choice is none but model
          // called a tool") because we intentionally omit the `tools` array here.
          // Mirrors the approach already used by the context-overflow recovery path.
          const synthHistory = conversationHistory.slice(0, 3); // system prompt + initial user task
          synthHistory.push({
            role: 'user',
            content:
              `You have completed data gathering. ` +
              `Tools used (${toolsUsed.length}): ${toolsUsed.join(', ')}. ` +
              `Based on the original subtask, write a comprehensive final summary of everything ` +
              `that was accomplished and discovered. Respond with text only — do NOT call any tools.`,
          });
          const synthResponse = await this.orchestrator.chatWithFallback(
            { messages: synthHistory }, // trimmed history + no `tools` field → forces text-only reply
            useToolCallingFallback,
          );
          finalResult =
            synthResponse.content ||
            `Max iterations reached. Tools executed (${toolsUsed.length}): ${toolsUsed.join(', ')}.`;
          logger.info(`[Worker] Forced synthesis produced ${finalResult.length} chars`);
        } catch (synthError) {
          const errMsg = synthError instanceof Error ? synthError.message : String(synthError);
          logger.warn(`[Worker] Forced synthesis failed: ${errMsg}`);
          finalResult = `Max iterations reached. Tools executed (${toolsUsed.length}): ${toolsUsed.join(', ')}.`;
        }
      } else if (hasToolFailures) {
        // Build a specific failure summary from the circuit breaker data
        const failureSummary = [...toolFailureCounts.entries()]
          .filter(([, v]) => v.count > 0)
          .map(([sig, v]) => {
            const name = sig.split(':')[0];
            return `${name} (${v.count} attempt${v.count > 1 ? 's' : ''}) — ${v.lastError}`;
          })
          .join('; ');
        finalResult = `Subtask could not be completed. Tool failures: ${failureSummary || 'see errors above'}.`;
        logger.warn(`[Worker] Max iterations reached with tool failures: ${failureSummary}`);
      } else {
        finalResult = 'Subtask could not be completed within iteration limit.';
        logger.warn(`[Worker] Max iterations reached with no work done`);
      }
    }

    // Build structured failedTools list from the circuit breaker map.
    // Include all failures (count >= 1) so even a single failed attempt is
    // visible to Client and synthesis — not just those that hit the 3-attempt cap.
    const failedTools: ToolFailure[] = [...toolFailureCounts.entries()].map(([sig, v]) => {
      const colonIdx = sig.indexOf(':');
      const tName = sig.substring(0, colonIdx);
      let tArgs: Record<string, any> = {};
      try { tArgs = JSON.parse(sig.substring(colonIdx + 1)); } catch { /* ignore */ }
      return { toolName: tName, args: tArgs, lastError: v.lastError, attempts: v.count };
    });

    // Determine success: only true when the model produced a natural conclusive
    // response (broke out of the loop normally). The max-iterations fallback
    // paths are all treated as non-success so the Client validates properly.
    const success = !!finalResult &&
                   !finalResult.includes('could not be completed') &&
                   !finalResult.includes('encountered errors') &&
                   !finalResult.includes('Max iterations reached') &&
                   !finalResult.includes('Validation required');
    orchestrationLogger.logWorkerComplete(success, toolsUsed, iterationCount);

    return {
      success,
      result: finalResult,
      toolsUsed,
      failedTools,
      reasoning: reasoning || 'Task executed',
    };
  }

  private extractReasoning(content: string): string {
    // Try to extract reasoning if Worker provides it
    const reasoningMatch = content.match(/(?:Reasoning|Analysis|Approach):?\s*([^\n]+)/i);
    return reasoningMatch ? reasoningMatch[1].trim() : '';
  }

  /**
   * Determine if we should prompt Worker to check for completion.
   * Fires every 3 successful tool calls (regardless of tool type) so research
   * tasks (yfinance, brave-search, etc.) get a "are you done?" nudge just like
   * file-operation tasks do.  Also fires when we are approaching the iteration
   * cap so the model has a chance to synthesise before hitting the hard limit.
   */
  private shouldPromptForCompletion(
    toolsUsed: string[],
    currentIteration: number
  ): boolean {
    // Don't prompt on the very first iteration — let Worker do initial work first.
    if (currentIteration === 0) {
      return false;
    }

    // Approaching the iteration limit — give the model one last chance to wrap up.
    const nearIterationLimit =
      this.maxIterations > 0 &&
      currentIteration >= Math.floor(this.maxIterations * 0.7);
    if (nearIterationLimit) {
      return true;
    }

    // Fire every 8 successful tool calls for any tool type
    // (at 8, 16, 24 … tools accumulated).
    // Using 8 instead of 3 to give the Worker enough space to complete
    // multi-step data-gathering workflows before being prompted to stop.
    return toolsUsed.length >= 8 && toolsUsed.length % 8 === 0;
  }
}
