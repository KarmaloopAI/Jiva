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

/** Max consecutive empty responses before breaking out */
const MAX_EMPTY_RESPONSES = 4;
/** Consecutive identical calls that triggers doom-loop break */
const DOOM_LOOP_THRESHOLD = 3;

/**
 * Attempt to repair a failed tool call by extracting the intended call from
 * failed_generation and remapping to a known tool. Handles <|channel|> tokens
 * and Harmony "functions" namespace prefix. Ported from CodeAgent.
 */
function repairFailedToolCall(
  errorMsg: string,
  tools: Tool[],
): { toolName: string; args: Record<string, any> } | null {
  try {
    const jsonMatch = errorMsg.match(/API error \(\d+\): (.+)/s);
    if (!jsonMatch) return null;
    const errorBody = JSON.parse(jsonMatch[1]);
    const failedGen: string | undefined = errorBody?.error?.failed_generation;
    if (!failedGen) return null;
    const parsed = JSON.parse(failedGen);
    const rawName: string = parsed?.name ?? '';
    const args: Record<string, any> = parsed?.arguments ?? {};
    const stripped = rawName.replace(/<\|[^|]*\|>/g, '').replace(/^functions/i, '').trim();
    const byName = tools.find((t) => t.name === stripped || t.name === stripped.toLowerCase());
    if (byName) return { toolName: byName.name, args };
    const argKeys = Object.keys(args);
    const byArgs = tools.find((t) => {
      const required = (t.parameters as any).required ?? [];
      return required.length > 0 && required.every((r: string) => argKeys.includes(r));
    });
    if (byArgs) return { toolName: byArgs.name, args };
    return null;
  } catch {
    return null;
  }
}

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
3. Keep going until the subtask is completely resolved — do NOT stop early
4. Report back with clear, factual results

PERSISTENCE — READ CAREFULLY:
- Keep going until the subtask is completely resolved before ending your turn.
- You MUST iterate and keep going until the problem is fully solved.
- NEVER end your turn without having truly and completely solved the subtask.
- When you say you are going to make a tool call, you MUST actually make the tool call.
- If a tool call fails or returns an error, DO NOT STOP. Analyse the error, try a different approach or arguments, and keep going. Errors are expected — your job is to recover and complete the task.
- Use FULL ABSOLUTE PATHS for all file/directory operations.

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
    /** Sliding window of recent (toolName:args) signatures for doom-loop detection */
    const recentCalls: string[] = [];
    /** Consecutive iterations with empty content and no tool calls */
    let emptyResponseCount = 0;
    /** Ensure each phase nudge fires only once */
    let continueNudgeInjected = false;
    let wrapUpNudgeInjected = false;

    // Worker execution loop
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      iterationCount = iteration + 1;
      logger.debug(`  [Worker] Iteration ${iteration + 1}/${this.maxIterations}`);
      orchestrationLogger.logWorkerIteration(iteration + 1, this.maxIterations);

      // Two-phase nudges: keep-going at 70%, wrap-up at 90%
      const iterPct = iteration / this.maxIterations;
      if (iterPct >= 0.7 && !continueNudgeInjected) {
        continueNudgeInjected = true;
        logger.warn(`  [Worker] Nearing iteration limit (${iteration + 1}/${this.maxIterations}) — injecting continue nudge`);
        conversationHistory.push({
          role: 'user',
          content:
            `You are at step ${iteration + 1} of ${this.maxIterations}. Continue making progress — ` +
            `focus on the most critical remaining work. Complete the core work and note what is left.`,
        });
      }
      if (iterPct >= 0.9 && !wrapUpNudgeInjected) {
        wrapUpNudgeInjected = true;
        logger.warn(`  [Worker] Final phase (${iteration + 1}/${this.maxIterations}) — requesting wrap-up`);
        conversationHistory.push({
          role: 'user',
          content:
            'You are approaching the maximum number of steps. Wrap up the current work, ' +
            'complete any in-progress actions, and provide a comprehensive summary of everything accomplished.',
        });
      }

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

        // ── Handler: missing required properties on any MCP tool ─────────────
        // Fires for schema validation errors like "missing properties: 'ref'"
        // on any tool — gives the model targeted guidance instead of phase switch.
        const missingPropsMatch = errorMsg.match(
          /parameters for tool ([\w]+) did not match schema.*missing properties: '([^']+)'/s,
        );
        if (missingPropsMatch) {
          const failedTool = missingPropsMatch[1];
          const missingProp = missingPropsMatch[2];
          logger.warn(`  [Worker] Schema validation: ${failedTool} missing required property '${missingProp}'`);
          conversationHistory.push({ role: 'assistant', content: '' });
          conversationHistory.push({
            role: 'user',
            content:
              `Your call to \`${failedTool}\` failed: required property \`${missingProp}\` was missing.\n\n` +
              `Before calling \`${failedTool}\` again, take a snapshot with the browser snapshot tool ` +
              `to get current element references (the \`ref\` values from the snapshot), ` +
              `then re-call \`${failedTool}\` with all required properties including \`ref\`.`,
          });
          continue;
        }

        // ── Handler: edit_file missing new_string ─────────────────────────────
        const isMissingNewString =
          errorMsg.includes("missing properties: 'new_string'") ||
          errorMsg.includes('missing properties: "new_string"') ||
          (errorMsg.includes('edit_file') && errorMsg.includes('missing propert') && errorMsg.includes('new_string'));

        if (isMissingNewString) {
          logger.warn('  [Worker] edit_file missing new_string — injecting targeted correction');
          conversationHistory.push({ role: 'assistant', content: '' });
          conversationHistory.push({
            role: 'user',
            content:
              'Your edit_file call failed: "new_string" is required but was not provided.\n\n' +
              'edit_file requires ALL THREE parameters: file_path, old_string, and new_string.\n' +
              'Call edit_file again with all three parameters.',
          });
          continue;
        }

        // ── Handler: tool content too large ───────────────────────────────────
        const isContentTooLarge =
          (errorMsg.includes('write_file') || errorMsg.includes('edit_file')) &&
          (errorMsg.includes('Failed to parse tool call') || errorMsg.includes('tool_use_failed'));

        if (isContentTooLarge) {
          let failedToolName = errorMsg.includes('edit_file') && !errorMsg.includes('write_file') ? 'edit_file' : 'write_file';
          let targetFile = '';
          try {
            const jm = errorMsg.match(/API error \(\d+\): (.+)/s);
            if (jm) {
              const eb = JSON.parse(jm[1]);
              const fg: string | undefined = eb?.error?.failed_generation;
              if (fg) {
                const p2 = JSON.parse(fg);
                if (p2?.name) failedToolName = p2.name;
                const fp = p2?.arguments?.file_path;
                if (fp) targetFile = ` for \`${fp}\``;
              }
            }
          } catch { /* ignore */ }
          const isEdit = failedToolName === 'edit_file';
          logger.warn(`  [Worker] ${isEdit ? 'edit_file' : 'write_file'}${targetFile} content truncated — asking model to write in stages`);
          conversationHistory.push({ role: 'assistant', content: '' });
          conversationHistory.push({
            role: 'user',
            content: isEdit
              ? `Your edit_file call${targetFile} failed: new_string was too large (cut off mid-JSON).\n\nMAXIMUM 20 LINES per edit_file call. Split into smaller pieces and call edit_file once per piece.`
              : `Your write_file call${targetFile} failed: content too large (cut off mid-JSON).\n\nStage 1: write_file — skeleton ONLY (stubs, TODO placeholders) — MAX 20 lines\nStage 2+: edit_file — implement one section at a time (max 20 lines per call)`,
          });
          continue;
        }

        // ── Handler: client-side tool name repair ─────────────────────────────
        {
          const mcpToolList = this.mcpManager.getClient().getAllTools();
          const repaired = repairFailedToolCall(errorMsg, mcpToolList);
          if (repaired) {
            const { toolName: repairedName, args: repairedArgs } = repaired;
            logger.warn(`  [Worker] Repaired tool call: ${repairedName} (invalid token in name)`);
            try {
              const repResult = await this.mcpManager.getClient().executeTool(repairedName, repairedArgs);
              toolsUsed.push(repairedName);
              const repText = typeof repResult === 'string' ? repResult : JSON.stringify(repResult);
              conversationHistory.push({ role: 'assistant', content: '' });
              conversationHistory.push({
                role: 'user',
                content: `[Tool call repaired to \`${repairedName}\`]\n<tool_result name="${repairedName}">\n${repText}\n</tool_result>`,
              });
              continue;
            } catch (repErr) {
              logger.warn(`  [Worker] Repaired call failed: ${repErr instanceof Error ? repErr.message : String(repErr)}`);
            }
          }
        }

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

      let _postApiError = false;
      try {

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

          // Parse args outside the try block so the catch block can reference
          // them for the failure signature (circuit breaker key).
          let args: Record<string, any> = {};
          try { args = JSON.parse(toolCall.function.arguments); } catch { /* use empty */ }
          const failureSig = `${toolName}:${JSON.stringify(args)}`;

          // Sliding-window doom-loop: only triggers on CONSECUTIVE identical calls
          const callSig = `${toolName}:${JSON.stringify(args)}`;
          recentCalls.push(callSig);
          if (recentCalls.length > DOOM_LOOP_THRESHOLD) recentCalls.shift();
          if (
            recentCalls.length === DOOM_LOOP_THRESHOLD &&
            recentCalls.every((c) => c === recentCalls[0])
          ) {
            logger.warn(`  [Worker] Doom loop detected for tool: ${toolName} — same call ${DOOM_LOOP_THRESHOLD} times in a row`);
            conversationHistory.push({
              role: 'user',
              content: `STOP: You are calling \`${toolName}\` with the same arguments ${DOOM_LOOP_THRESHOLD} times in a row. This is not making progress. Try a different approach, different arguments, or a different tool to achieve the same goal.`,
            });
            break;
          }

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

        // Continue to process tool results
        continue;
      }

      } catch (unexpectedError) {
        _postApiError = true;
        const errMsg = unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);
        logger.error(`  [Worker] Unexpected error during tool processing: ${errMsg}`);
        conversationHistory.push({
          role: 'user',
          content: `An unexpected internal error occurred: "${errMsg}". Please try a different approach.`,
        });
      }
      if (_postApiError) continue;

      // Detect truncated XML tool call: model started <tool_call> but response was cut off
      // before </tool_call> (token limit hit mid-content). Same fix as CodeAgent.
      const truncatedXml =
        response.content &&
        response.content.includes('<tool_call>') &&
        !response.content.includes('</tool_call>');

      if (truncatedXml) {
        const contentStr = response.content!;
        const isEditFile =
          (contentStr.includes('edit_file') || contentStr.includes('filesystem__edit_file')) &&
          !contentStr.includes('write_file') &&
          !contentStr.includes('filesystem__write_file');
        const fpMatch = contentStr.match(/<arg_key>file_path<\/arg_key>\s*<arg_value>([^<]+)<\/arg_value>/);
        const targetFile = fpMatch ? ` for \`${fpMatch[1]}\`` : '';
        logger.warn(`  [Worker] Truncated XML tool call${targetFile} — injecting staged-writing correction`);

        const correctionContent = isEditFile
          ? `Your edit_file call${targetFile} failed: the response was cut off before the tool call completed.\n\n` +
            `MAXIMUM 20 LINES per edit_file call. Implement one function or section at a time:\n` +
            `  - Split the change into smaller pieces and call edit_file once per piece.\n` +
            `  - Never pass more than 20 lines as new_string.\n\n` +
            `Call edit_file now with a new_string of at most 20 lines.`
          : `Your write_file call${targetFile} failed: the file content was too large and was cut off mid-response.\n\n` +
            `Use the skeleton-first approach — write the file in stages:\n` +
            `  Stage 1: write_file — skeleton/scaffold ONLY (stubs, empty function bodies, TODO placeholders) — MAX 20 lines\n` +
            `  Stage 2+: edit_file — implement one function or section at a time (max 20 lines per call)\n` +
            `  Never implement more than one major section per call.\n\n` +
            `Start with Stage 1 NOW: write_file with just the bare skeleton (20 lines max).`;

        conversationHistory.push({ role: 'user', content: correctionContent });
        emptyResponseCount = 0;
        continue;
      }

      // No tool calls — check for empty response before treating as completion
      if (!response.content && emptyResponseCount < MAX_EMPTY_RESPONSES) {
        emptyResponseCount++;
        logger.warn(`  [Worker] Empty response with no tool calls (${emptyResponseCount}/${MAX_EMPTY_RESPONSES}) — nudging`);
        conversationHistory.push({
          role: 'user',
          content: emptyResponseCount <= 2
            ? 'Your last response was empty. Continue working on the subtask — call a tool or provide a final summary.'
            : `IMPORTANT (attempt ${emptyResponseCount}/${MAX_EMPTY_RESPONSES}): Response is empty again. You MUST call a tool or provide a final summary now.`,
        });
        continue;
      }

      // Worker has a conclusive response
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

}

