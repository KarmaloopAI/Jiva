/**
 * EvaluatorAgent — autonomous supervisor for Jiva tasks.
 *
 * Architecture mirrors CodeAgent's single tool-calling loop, but instead of
 * writing code the evaluator reads workspace files, validates completion against
 * the directive, and uses interact_with_agent to nudge the main agent when gaps
 * are found.
 *
 * The evaluator has completely isolated LLM state — its own ModelOrchestrator,
 * its own MCPServerManager, and its own message history. It never shares context
 * with the agent it supervises.
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from '../core/workspace.js';
import { formatToolResult } from '../models/harmony.js';
import type { Message, Tool } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { deriveEvaluatorDirective } from './directive-adapter.js';
import { EVALUATOR_VIRTUAL_TOOLS, type IEvaluatorTool } from './tools/agent-tools.js';
import type {
  EvaluatorConfig,
  EvaluationContext,
  EvaluationResult,
  EvaluatorToolContext,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_MAX_CYCLES = 5;
const DOOM_LOOP_THRESHOLD = 3;

// ─── Result parsing ───────────────────────────────────────────────────────────

/**
 * Extract a structured EvaluationResult from the evaluator's final LLM response.
 * Looks for a JSON code block; falls back to a best-effort parse.
 */
function parseEvaluationResult(
  text: string,
  nudgesSent: number,
  cyclesRan: number,
  evidence: string[],
): EvaluationResult {
  try {
    // Look for ```json ... ``` block
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/i);
    const raw = jsonMatch ? jsonMatch[1] : text;
    const parsed = JSON.parse(raw.trim());

    return {
      passed: Boolean(parsed.passed),
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      nudgesSent,
      cyclesRan,
      evidence,
      summary: typeof parsed.summary === 'string' ? parsed.summary : text.substring(0, 300),
    };
  } catch {
    // Free-form response — determine pass/fail from keywords
    const lower = text.toLowerCase();
    const passed =
      lower.includes('evaluation passed') ||
      lower.includes('all tasks complete') ||
      lower.includes('work is complete') ||
      lower.includes('"passed": true');

    return {
      passed,
      gaps: [],
      nudgesSent,
      cyclesRan,
      evidence,
      summary: text.substring(0, 300),
    };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(workspaceDir: string, evaluatorDirective: string): string {
  return `You are an autonomous evaluation agent operating in evaluation mode.
You DO NOT perform tasks — you VALIDATE whether tasks have been completed.

WORKSPACE: ${workspaceDir}
All relative paths are resolved relative to the workspace directory above.
Use absolute paths for all file operations.

YOUR EVALUATION APPROACH:
1. Read workspace files to understand what has been produced.
2. Compare the actual output against the requirements in your directive.
3. If gaps exist, send targeted instructions to the main agent using interact_with_agent.
4. Re-read files after each nudge to confirm corrections were applied.
5. When you are satisfied (or exhausted your options), output your final JSON assessment.

TOOL SELECTION:
- To READ files → use the filesystem MCP tools (filesystem__read_file, filesystem__search_files, etc.)
- To SEND instructions to the main agent → use interact_with_agent
- To LIST available conversations → use list_agent_conversations
- To INSPECT conversation history → use get_conversation_history

FINAL OUTPUT — when evaluation is complete, respond with ONLY this JSON (no other text):
\`\`\`json
{
  "passed": true | false,
  "gaps": ["specific gap 1", "specific gap 2"],
  "summary": "1-3 sentence assessment."
}
\`\`\`

${evaluatorDirective}`;
}

// ─── EvaluatorAgent ───────────────────────────────────────────────────────────

export class EvaluatorAgent {
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private workspace: WorkspaceManager;
  private targetAgent: import('../core/agent-interface.js').IAgent;
  private maxIterations: number;
  private maxCycles: number;
  private virtualTools: IEvaluatorTool[];

  constructor(config: EvaluatorConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.targetAgent = config.targetAgent;
    this.maxIterations = config.maxIterationsPerCycle ?? DEFAULT_MAX_ITERATIONS;
    this.maxCycles = config.maxEvaluationCycles ?? DEFAULT_MAX_CYCLES;
    this.virtualTools = EVALUATOR_VIRTUAL_TOOLS;
  }

  /**
   * Evaluate whether the main agent has completed the goal described in userMessage.
   *
   * The evaluator runs its own agentic loop: it reads files, assesses completion,
   * sends nudges to the main agent via interact_with_agent, and re-checks until
   * satisfied or the cycle limit is reached.
   */
  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    logger.info('[Evaluator] Starting evaluation');

    // Optionally load a specific conversation into the target agent
    if (ctx.targetConversationId) {
      logger.info(`[Evaluator] Loading conversation: ${ctx.targetConversationId}`);
      await this.targetAgent.loadConversation(ctx.targetConversationId);
    }

    let nudgesSent = 0;
    let cyclesRan = 0;
    const evidence: string[] = [];

    // The directive for the evaluator — wraps the workspace directive with evaluation framing
    const rawDirective = this.workspace.getDirectivePrompt() ?? '';
    const evaluatorDirective = deriveEvaluatorDirective(rawDirective);
    const workspaceDir = this.workspace.getWorkspaceDir();
    const systemPrompt = buildSystemPrompt(workspaceDir, evaluatorDirective);

    // Build the unified tool list: MCP tools + virtual tools
    const mcpToolDefs = this.mcpManager
      .getClient()
      .getAllTools()
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: (t as any).inputSchema ?? { type: 'object' as const, properties: {} },
      })) as Tool[];

    const virtualToolDefs: Tool[] = this.virtualTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const allToolDefs: Tool[] = [...mcpToolDefs, ...virtualToolDefs];

    // Evaluation loop — each cycle runs the full agentic loop once.
    // The evaluator terminates early if it produces a JSON result with "passed": true.
    let lastResult: EvaluationResult | null = null;

    for (let cycle = 0; cycle < this.maxCycles; cycle++) {
      cyclesRan = cycle + 1;
      logger.info(`[Evaluator] Cycle ${cyclesRan}/${this.maxCycles}`);

      const cycleResult = await this.runEvaluationCycle({
        systemPrompt,
        userMessage: ctx.userMessage,
        allToolDefs,
        workspaceDir,
        nudgesSentRef: { value: nudgesSent },
        evidence,
      });

      nudgesSent = cycleResult.nudgesSentAfter;
      lastResult = parseEvaluationResult(
        cycleResult.finalText,
        nudgesSent,
        cyclesRan,
        [...evidence],
      );

      logger.info(
        `[Evaluator] Cycle ${cyclesRan} complete — passed: ${lastResult.passed}, gaps: ${lastResult.gaps.length}`,
      );

      if (lastResult.passed) {
        break;
      }
    }

    if (!lastResult) {
      return {
        passed: false,
        gaps: ['Evaluation could not be completed — max cycles reached without a result'],
        nudgesSent,
        cyclesRan,
        evidence,
        summary: 'Evaluation did not produce a result within the allowed cycle budget.',
      };
    }

    return lastResult;
  }

  // ─── Private: single cycle ──────────────────────────────────────────────────

  private async runEvaluationCycle(params: {
    systemPrompt: string;
    userMessage: string;
    allToolDefs: Tool[];
    workspaceDir: string;
    nudgesSentRef: { value: number };
    evidence: string[];
  }): Promise<{ finalText: string; nudgesSentAfter: number }> {
    const { systemPrompt, userMessage, allToolDefs, workspaceDir, nudgesSentRef, evidence } =
      params;

    // Fresh isolated message history for each cycle
    const messages: Message[] = [
      { role: 'developer' as any, content: systemPrompt },
      {
        role: 'user',
        content:
          `Evaluate whether the following goal has been fully and correctly completed:\n\n` +
          `GOAL: ${userMessage}\n\n` +
          `Start by reading the relevant workspace files, then assess completion against the ` +
          `original directive. If gaps exist, use interact_with_agent to guide the main agent. ` +
          `When done, output your JSON assessment.`,
      },
    ];

    const toolContext: EvaluatorToolContext = {
      workspaceDir,
      targetAgent: this.targetAgent,
      onNudgeSent: () => {
        nudgesSentRef.value++;
      },
      onEvidenceFound: (path: string) => {
        if (!evidence.includes(path)) evidence.push(path);
      },
    };

    // Doom loop detection
    const recentCalls: string[] = [];
    let consecutiveApiErrors = 0;
    const MAX_API_ERRORS = 3;
    let finalText = '';
    let iterations = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      iterations = i + 1;
      const iterPct = i / this.maxIterations;
      const isFinalPhase = iterPct >= 0.90;

      // Near-limit nudge
      if (iterPct >= 0.80 && iterPct < 0.90 && i > 0) {
        const alreadyNudged = messages.some(
          (m) => typeof m.content === 'string' && m.content.includes('FINAL PHASE'),
        );
        if (!alreadyNudged) {
          messages.push({
            role: 'user',
            content:
              `You are approaching the iteration limit (${iterations}/${this.maxIterations}). ` +
              `Finish any remaining checks and produce your final JSON assessment.`,
          });
        }
      }

      if (isFinalPhase) {
        const alreadyStripped = messages.some(
          (m) => typeof m.content === 'string' && m.content.includes('FINAL PHASE'),
        );
        if (!alreadyStripped) {
          messages.push({
            role: 'user',
            content:
              'FINAL PHASE: Tools are disabled. You MUST respond with ONLY the JSON assessment block now.\n\n' +
              '```json\n{"passed": true|false, "gaps": [], "summary": "..."}\n```',
          });
        }
      }

      let response;
      try {
        response = await this.orchestrator.chatWithFallback(
          {
            messages,
            tools: isFinalPhase ? [] : allToolDefs,
            temperature: 0.1,
          },
          false,
        );
        consecutiveApiErrors = 0;
      } catch (error) {
        consecutiveApiErrors++;
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[Evaluator] Model error (${consecutiveApiErrors}/${MAX_API_ERRORS}): ${msg}`);

        if (consecutiveApiErrors >= MAX_API_ERRORS) {
          finalText = '[Evaluation aborted due to repeated model errors]';
          break;
        }

        // Add placeholder so conversation structure remains valid
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role !== 'assistant') {
          messages.push({ role: 'assistant', content: '' });
        }
        messages.push({
          role: 'user',
          content: 'The previous request failed. Please continue the evaluation and output your JSON assessment.',
        });
        continue;
      }

      // Record assistant message
      if (response.toolCalls && response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls,
        } as any);
      } else {
        messages.push({ role: 'assistant', content: response.content });
      }

      // No tool calls → evaluator is done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalText = response.content || '[No evaluation response]';
        break;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          // malformed args — continue with empty args
        }

        // Doom loop guard
        const callSig = `${toolName}:${JSON.stringify(toolArgs)}`;
        recentCalls.push(callSig);
        if (recentCalls.length > DOOM_LOOP_THRESHOLD) recentCalls.shift();

        if (
          recentCalls.length === DOOM_LOOP_THRESHOLD &&
          recentCalls.every((c) => c === recentCalls[0])
        ) {
          logger.warn(`[Evaluator] Doom loop detected for tool: ${toolName}`);
          messages.push({
            role: 'user',
            content: `STOP: You are calling \`${toolName}\` with the same arguments repeatedly. ` +
              `Move on and output your final JSON assessment based on what you have found so far.`,
          });
          break;
        }

        logger.info(`[Evaluator] Tool: ${toolName}`);

        let toolResult: string;

        // Check virtual tools first, then fall through to MCP
        const virtualTool = this.virtualTools.find((t) => t.name === toolName);

        if (virtualTool) {
          try {
            toolResult = await virtualTool.execute(toolArgs, toolContext);
          } catch (e) {
            toolResult = `Error executing ${toolName}: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else {
          // MCP tool
          try {
            const result = await this.mcpManager.getClient().executeTool(toolName, toolArgs);
            toolResult = typeof result === 'string' ? result : JSON.stringify(result);

            // Track filesystem reads as evidence
            if (
              toolName.includes('read') ||
              toolName.includes('search') ||
              toolName.includes('list')
            ) {
              const pathArg =
                (toolArgs.path as string) ||
                (toolArgs.query as string) ||
                (toolArgs.pattern as string);
              if (pathArg) toolContext.onEvidenceFound(pathArg);
            }
          } catch (e) {
            toolResult = `Error executing ${toolName}: ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        const toolMessage = formatToolResult(toolCall.id, toolName, toolResult);
        messages.push(toolMessage);
      }
    }

    if (!finalText) {
      finalText = `[Evaluator reached max iterations (${iterations}) without producing a final assessment]`;
    }

    return { finalText, nudgesSentAfter: nudgesSentRef.value };
  }
}
