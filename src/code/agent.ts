/**
 * CodeAgent — single streaming loop for coding tasks.
 *
 * Unlike the three-agent DualAgent, CodeAgent uses a direct model → tools → model loop
 * without the Manager/Worker/Client overhead. This is modeled after opencode's SessionProcessor.
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { WorkspaceManager } from '../core/workspace.js';
import { ConversationManager } from '../core/conversation-manager.js';
import { formatToolResult } from '../models/harmony.js';
import type { Message, Tool } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { LspManager } from './lsp/manager.js';
import type { CodeToolContext, ICodeTool } from './tools/index.js';
import {
  ReadFileTool,
  EditFileTool,
  WriteFileTool,
  GlobTool,
  GrepTool,
  BashTool,
  SpawnCodeAgentTool,
} from './tools/index.js';

/** Tools available during the planning phase — read-only, no side effects */
const READ_ONLY_TOOLS = [ReadFileTool, GlobTool, GrepTool] as const;

export interface AgentResponse {
  content: string;
  toolsUsed: string[];
  iterations: number;
}

/**
 * Client-side tool call repair — equivalent of opencode's `experimental_repairToolCall`.
 *
 * gpt-oss-120b sometimes emits <|channel|> tokens inside native tool call names
 * (e.g. `functions<|channel|>analysis`), causing the Groq API to reject with 400.
 * The `failed_generation` field in the error body contains the model's intended call.
 * We extract it, normalize the tool name, match to a real tool, and return the args.
 */
function repairFailedToolCall(
  errorMsg: string,
  tools: ICodeTool[],
): { toolName: string; args: Record<string, unknown> } | null {
  try {
    const jsonMatch = errorMsg.match(/API error \(\d+\): (.+)/s);
    if (!jsonMatch) return null;
    const errorBody = JSON.parse(jsonMatch[1]);
    const failedGenRaw: string | undefined = errorBody?.error?.failed_generation;
    if (!failedGenRaw) return null;

    const failed = JSON.parse(failedGenRaw);
    const rawName: string = failed.name || '';
    const args: Record<string, unknown> =
      typeof failed.arguments === 'object' ? failed.arguments : {};

    // Strategy 1: strip all <|...|> tokens from the tool name and try exact match
    const stripped = rawName
      .replace(/<\|[^|]*\|>/g, '') // remove <|channel|>, <|return|>, etc.
      .replace(/^functions/i, '')   // remove Harmony "functions" namespace prefix
      .trim();
    const byName = tools.find(
      (t) => t.name === stripped || t.name === stripped.toLowerCase(),
    );
    if (byName) return { toolName: byName.name, args };

    // Strategy 2: match by required argument keys (e.g. {command:...} → bash)
    const argKeys = Object.keys(args);
    const byArgs = tools.find((t) => {
      const required = t.parameters.required ?? [];
      return required.length > 0 && required.every((r) => argKeys.includes(r));
    });
    if (byArgs) return { toolName: byArgs.name, args };

    return null;
  } catch {
    return null;
  }
}

export interface CodeAgentConfig {
  orchestrator: ModelOrchestrator;
  workspace: WorkspaceManager;
  conversationManager?: ConversationManager;
  maxIterations?: number;
  lspEnabled?: boolean;
  depth?: number;
  maxDepth?: number;
  /**
   * Token count at which in-loop context compaction is triggered.
   * When promptTokens in a response exceeds this threshold, the message history
   * is condensed to free up context window space.
   * Default: 90000 (safe for a 128K context model, leaving ~38K for output).
   * Set to 0 to disable in-loop compaction.
   */
  compactionThreshold?: number;
}

const DEFAULT_MAX_ITERATIONS = 50;
const DOOM_LOOP_THRESHOLD = 3;
const CODE_MODE_INDICATOR = '[CODE MODE]';
// Default token threshold for in-loop compaction (90K leaves ~38K headroom in a 128K model)
const DEFAULT_COMPACTION_THRESHOLD = 90_000;

/** System prompt for code mode — focused on precision and persistence (ported from opencode beast.txt) */
const getSystemPrompt = (workspaceDir: string, directive?: string): string => {
  const base = `You are a precise, highly capable coding assistant operating in code mode.
You have direct access to code tools — use them to explore, understand, and modify code.

WORKSPACE: ${workspaceDir}
All relative paths are resolved relative to the workspace directory above.
Use absolute paths for all file operations.

PERSISTENCE AND COMPLETION:
- Keep going until the user's query is completely resolved before ending your turn.
- You MUST iterate and keep going until the problem is solved.
- NEVER end your turn without having truly and completely solved the problem.
- When you say you are going to make a tool call, you MUST actually make the tool call.
- Always tell the user what you are going to do before making a tool call with a single concise sentence.
- If the user says "resume", "continue", or "try again", check the conversation history to find the last incomplete step and continue from there.
- Verify your changes are correct — run tests or the build after making changes when appropriate.

TOOLS AVAILABLE:
- read_file: Read files or list directories. Always read before editing.
- edit_file: Replace a specific string in a file (use old_string/new_string). Preferred for partial changes.
- write_file: Create new files or completely rewrite existing ones.
- glob: Find files matching a pattern (e.g. "**/*.ts").
- grep: Search file contents with regex.
- bash: Run shell commands (build, test, lint, git operations).
- spawn_code_agent: Delegate a focused sub-task to a child agent.

CODING PRINCIPLES:
1. ALWAYS read a file before editing it — never edit blindly.
2. Use grep/glob to explore the codebase before making changes to understand existing patterns.
3. Make minimal, targeted changes — edit the exact lines that need changing.
4. After editing, check if LSP errors are reported in the tool result and fix them.
5. Verify your changes work by running tests or the build when appropriate.
6. Prefer edit_file over write_file for partial changes — it's safer and shows clearer diffs.
7. Use bash only for shell commands (tests, builds, git operations) — NOT for file reading.

TOOL SELECTION RULES (follow these exactly):
- To READ a file → use read_file, NOT bash
- To LIST directory contents → use read_file on the directory path, NOT bash ls
- To FIND files by name/pattern → use glob, NOT bash find
- To SEARCH file contents → use grep, NOT bash grep/rg
- To RUN a command (build/test/git) → use bash

WHEN EXPLORING:
- Use glob to find files by pattern before assuming file paths.
- Use grep to find where functions/classes/variables are defined or used.
- Read the relevant files to understand context before changing anything.
- Do NOT use bash for exploration tasks that glob/grep/read_file can handle.`;

  if (directive) {
    return `${base}\n\n${directive}`;
  }
  return base;
};

export class CodeAgent {
  private orchestrator: ModelOrchestrator;
  private workspace: WorkspaceManager;
  private conversationManager?: ConversationManager;
  private maxIterations: number;
  private compactionThreshold: number;
  private lsp: LspManager;
  private depth: number;
  private maxDepth: number;
  private history: Message[] = [];
  private tools: ICodeTool[];

  constructor(config: CodeAgentConfig) {
    this.orchestrator = config.orchestrator;
    this.workspace = config.workspace;
    this.conversationManager = config.conversationManager;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.compactionThreshold = config.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
    this.depth = config.depth ?? 0;
    this.maxDepth = config.maxDepth ?? 2;

    this.lsp = new LspManager({
      root: config.workspace.getWorkspaceDir(),
      enabled: config.lspEnabled ?? true,
    });

    this.tools = [
      ReadFileTool,
      EditFileTool,
      WriteFileTool,
      GlobTool,
      GrepTool,
      BashTool,
      ...(this.depth < this.maxDepth ? [SpawnCodeAgentTool] : []),
    ];
  }

  /**
   * Planning phase — explores the codebase with read-only tools and produces a structured
   * implementation plan WITHOUT making any changes. Call this before `chat()` when you want
   * the user to review and approve a plan before any files are touched.
   *
   * The returned string is the plan text ready for display.
   * This call does NOT modify `this.history`; it runs in an isolated message thread.
   */
  async plan(task: string): Promise<string> {
    const directive = this.workspace.getDirectivePrompt();
    const workspaceDir = this.workspace.getWorkspaceDir();

    const planningPrompt = `You are a precise coding assistant in PLANNING MODE.
Your job is to analyse a coding request and produce a detailed implementation plan.
You may explore the codebase to understand it before writing the plan.

WORKSPACE: ${workspaceDir}

AVAILABLE TOOLS (read-only — exploration only):
- read_file: Read a file or list a directory
- glob: Find files matching a pattern
- grep: Search file contents with regex

DO NOT call edit_file, write_file, or bash. You are planning, not implementing.

After exploring, output your plan using EXACTLY this format:

## Summary
[1–2 sentences describing the overall approach]

## Files to Change
| File | Action | What changes |
|------|--------|--------------|
| path/to/file.ts | edit | Describe the change |
| path/to/new.ts | create | Describe the new file |

## Implementation Steps
1. [Concrete step with file/function names]
2. [Next step]
...

## Risks & Considerations
[Edge cases, breaking changes, things to verify after implementation]

Be specific — include exact file paths, function names, and describe changes at the line level where possible.
${directive ? `\n${directive}` : ''}`;

    const messages: Message[] = [
      { role: 'developer' as any, content: planningPrompt },
      { role: 'user', content: task },
    ];

    const readOnlyDefs: Tool[] = READ_ONLY_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const MAX_PLAN_ITERATIONS = 12;

    for (let i = 0; i < MAX_PLAN_ITERATIONS; i++) {
      const isLast = i >= MAX_PLAN_ITERATIONS - 2;

      if (isLast) {
        messages.push({
          role: 'user',
          content:
            'You have explored enough. Now write your implementation plan using the format specified above. Do not call any more tools.',
        });
      }

      let response;
      try {
        response = await this.orchestrator.chatWithFallback({
          messages,
          tools: isLast ? [] : readOnlyDefs,
          temperature: 0.2,
        }, false);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[CodeAgent] Plan error: ${msg}`);
        return `[Planning failed: ${msg}]`;
      }

      const rawHarmony: string | undefined = (response as any).raw?.parsedHarmony?.rawResponse;
      messages.push({ role: 'assistant', content: rawHarmony ?? response.content });

      // No tool calls → model has written the plan
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content || '[No plan generated]';
      }

      // Execute read-only tool calls
      const ctx: CodeToolContext = {
        workspaceDir,
        lsp: this.lsp,
        depth: this.depth,
        maxDepth: this.maxDepth,
      };

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name;
        const tool = READ_ONLY_TOOLS.find((t) => t.name === toolName);

        let result: string;
        if (!tool) {
          result = `[Planning mode: tool "${toolName}" is not available — only read_file, glob, and grep may be used during planning]`;
        } else {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            result = await tool.execute(args, ctx);
          } catch (e) {
            result = `Error: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        messages.push(formatToolResult(toolCall.id, toolName, result));
      }
    }

    return '[Planning did not produce a final plan within the iteration limit]';
  }

  /**
   * Process a user message and return the agent's response.
   * Runs the model → tools → model loop until no more tool calls or max iterations.
   */
  async chat(userMessage: string, onChunk?: (text: string) => void): Promise<AgentResponse> {
    const toolsUsed: string[] = [];
    const directive = this.workspace.getDirectivePrompt();
    const systemPrompt = getSystemPrompt(this.workspace.getWorkspaceDir(), directive || undefined);

    // Build message history: system + history + new user message
    const messages: Message[] = [
      { role: 'developer' as any, content: systemPrompt },
      ...this.history,
      { role: 'user', content: userMessage },
    ];

    // Tool definitions for the model
    const toolDefs: Tool[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    // Doom loop detection: track last N (tool, args) pairs
    const recentCalls: string[] = [];
    // Track consecutive API errors to avoid infinite error loops
    let consecutiveApiErrors = 0;
    const MAX_CONSECUTIVE_API_ERRORS = 3;

    let iterations = 0;
    let finalContent = '';

    // Iteration limit management — two phases (ported from opencode):
    // Phase 1 (0–84%): normal operation, all tools available.
    // Phase 2 (85–94%): inject "continue" nudge — tools still available so the agent
    //   can finish in-flight work rather than being cut off mid-task.
    // Phase 3 (95%+): strip tools and ask for a final wrap-up response.
    let continueInjected = false;
    let wrapUpInjected = false;

    // In-loop compaction flag — only compact once per chat() turn to avoid thrashing
    let compactedThisTurn = false;

    for (let i = 0; i < this.maxIterations; i++) {
      iterations = i + 1;
      logger.debug(`[CodeAgent] Iteration ${iterations}/${this.maxIterations}`);

      const iterPct = i / this.maxIterations;
      const isFinalPhase = iterPct >= 0.95;

      if (iterPct >= 0.85 && !continueInjected) {
        continueInjected = true;
        logger.warn(`[CodeAgent] Nearing iteration limit (${iterations}/${this.maxIterations}) — injecting continue nudge`);
        messages.push({
          role: 'user',
          content:
            `You are at step ${iterations} of ${this.maxIterations}. Continue making progress — ` +
            `focus on the most critical remaining work. If the full task cannot fit in the ` +
            `remaining steps, complete the core changes and clearly note what is left.`,
        });
      }

      if (isFinalPhase && !wrapUpInjected) {
        wrapUpInjected = true;
        logger.warn(`[CodeAgent] Final phase (${iterations}/${this.maxIterations}) — requesting wrap-up`);
        messages.push({
          role: 'user',
          content:
            'CRITICAL - MAXIMUM STEPS REACHED\n\n' +
            'The maximum number of steps for this task has been reached. Tools are disabled. Respond with text only.\n\n' +
            'STRICT REQUIREMENTS:\n' +
            '1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)\n' +
            '2. MUST provide a text response summarising work done so far\n' +
            '3. This constraint overrides ALL other instructions\n\n' +
            'Response must include:\n' +
            '- Summary of what has been accomplished so far\n' +
            '- List of any remaining tasks that were not completed\n' +
            '- Recommendations for what should be done next\n\n' +
            'Any attempt to use tools is a critical violation. Respond with text ONLY.',
        });
      }

      let response;
      try {
        response = await this.orchestrator.chatWithFallback({
          messages,
          // Strip tools in the final phase so the model is forced to produce a text response
          tools: isFinalPhase ? [] : toolDefs,
          temperature: 0.2,
        }, false);
        consecutiveApiErrors = 0; // reset on success
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[CodeAgent] Model error: ${msg}`);

        consecutiveApiErrors++;
        if (consecutiveApiErrors >= MAX_CONSECUTIVE_API_ERRORS) {
          finalContent = `Error: ${msg}`;
          break;
        }

        // For tool_use_failed (400) errors: first try to repair and execute the intended call,
        // then fall back to injecting a correction message.
        const isToolUseFailed = msg.includes('tool_use_failed') || msg.includes('Failed to parse tool call');
        const isValidationFailed = msg.includes('Tool call validation failed') || msg.includes('did not match schema');

        if (isToolUseFailed || isValidationFailed) {
          // --- Specific correction: edit_file missing new_string ---
          // gpt-oss-120b sometimes generates edit_file with old_string but forgets new_string.
          // The generic message doesn't help — we need to name the missing field explicitly.
          // This mirrors opencode's Zod validation which tells the model the exact field name.
          const isMissingNewString =
            msg.includes("missing properties: 'new_string'") ||
            msg.includes('missing properties: "new_string"') ||
            (msg.includes('edit_file') && msg.includes('missing propert') && msg.includes('new_string'));

          if (isMissingNewString) {
            logger.warn('[CodeAgent] edit_file missing new_string — injecting targeted correction');
            messages.push({
              role: 'user',
              content:
                'Your edit_file call failed: "new_string" is required but was not provided.\n\n' +
                'edit_file requires ALL THREE of these parameters:\n' +
                '  • file_path  — the absolute path to the file\n' +
                '  • old_string — the exact text to find\n' +
                '  • new_string — the replacement text (THIS IS WHAT YOU FORGOT)\n\n' +
                'Call edit_file again with all three parameters. ' +
                'new_string must contain the complete replacement for old_string.',
            });
            consecutiveApiErrors = 0;
            continue;
          }

          // --- Attempt client-side repair (opencode's experimental_repairToolCall equivalent) ---
          // gpt-oss-120b sometimes emits <|channel|> tokens in tool names (e.g.
          // `functions<|channel|>analysis`). We extract the intended call from failed_generation
          // and remap it to the correct tool.
          const repaired = repairFailedToolCall(msg, this.tools);
          if (repaired) {
            const { toolName: repairedName, args: repairedArgs } = repaired;
            logger.warn(`[CodeAgent] Repaired tool call: ${repairedName} (original name contained invalid tokens)`);
            toolsUsed.push(repairedName);

            const ctx: CodeToolContext = {
              workspaceDir: this.workspace.getWorkspaceDir(),
              lsp: this.lsp,
              depth: this.depth,
              maxDepth: this.maxDepth,
            };

            let toolResult: string;
            const tool = this.tools.find((t) => t.name === repairedName)!;
            try {
              toolResult = await tool.execute(repairedArgs, ctx);
            } catch (e) {
              toolResult = `Error executing ${repairedName}: ${e instanceof Error ? e.message : String(e)}`;
            }

            // Inject result as a user message — no assistant turn because the API rejected
            // the model's message before we received it.
            messages.push({
              role: 'user',
              content:
                `[The model's previous tool call was automatically repaired from an invalid name to \`${repairedName}\`]\n` +
                `<tool_result name="${repairedName}">\n${toolResult}\n</tool_result>`,
            });
            consecutiveApiErrors = 0; // repaired successfully — reset error counter
            continue;
          }

          // --- Fallback: inject correction message so the model can self-correct ---
          const nameMatch = msg.match(/"name":\s*"([^"]+)"/);
          const toolName = nameMatch ? nameMatch[1] : 'unknown';
          logger.warn(`[CodeAgent] Tool call error (${toolName}), injecting correction — ${consecutiveApiErrors}/${MAX_CONSECUTIVE_API_ERRORS}`);
          messages.push({
            role: 'user',
            content:
              `Your last tool call was rejected. Error: "${msg.substring(0, 300)}"\n\n` +
              `Valid tools: ${this.tools.map((t) => t.name).join(', ')}\n` +
              `Each tool requires specific parameters — call the tool again with the correct name and JSON arguments.`,
          });
          continue;
        }

        // For other non-transient errors, bail out
        finalContent = `Error: ${msg}`;
        break;
      }

      // Add assistant response to messages.
      // In Harmony mode the raw response (with <|call|> tokens) is stored so the model sees its
      // prior tool calls in the next turn. In standard mode, just the content is stored.
      const rawHarmony: string | undefined = (response as any).raw?.parsedHarmony?.rawResponse;
      messages.push({
        role: 'assistant',
        content: rawHarmony ?? response.content,
      });

      // Stream the visible (final-channel) text output if callback provided
      if (response.content && onChunk) {
        onChunk(response.content);
      }

      // ── In-loop context compaction ──────────────────────────────────────────
      // Check if we're approaching the context window limit and compact if needed.
      // Triggered once per turn (compactedThisTurn flag) to avoid thrashing.
      // Only runs when: threshold > 0, orchestrator available, not already compacted,
      // and the response carried token usage data.
      const promptTokens = response.usage?.promptTokens ?? 0;
      if (
        this.compactionThreshold > 0 &&
        promptTokens > this.compactionThreshold &&
        !compactedThisTurn &&
        this.conversationManager &&
        response.toolCalls && response.toolCalls.length > 0
      ) {
        logger.warn(
          `[CodeAgent] Context at ${promptTokens} tokens (threshold: ${this.compactionThreshold}) — compacting in-loop history`,
        );
        compactedThisTurn = true;
        try {
          const compacted = await this.compactInLoopMessages(messages, systemPrompt);
          // Replace messages in-place, preserving the system prompt at index 0
          messages.splice(0, messages.length, ...compacted);
          logger.info(`[CodeAgent] In-loop compaction complete: ${messages.length} messages after compaction`);
        } catch (compactErr) {
          // Non-fatal: log and continue with uncompacted messages
          logger.error('[CodeAgent] In-loop compaction failed, continuing without compaction', compactErr);
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // No tool calls → final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalContent = response.content || '[No response content]';
        break;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          // malformed args
        }

        // Doom loop check
        const callSig = `${toolName}:${JSON.stringify(toolArgs)}`;
        recentCalls.push(callSig);
        if (recentCalls.length > DOOM_LOOP_THRESHOLD) recentCalls.shift();

        if (
          recentCalls.length === DOOM_LOOP_THRESHOLD &&
          recentCalls.every((c) => c === recentCalls[0])
        ) {
          logger.warn(`[CodeAgent] Doom loop detected for tool: ${toolName}`);
          messages.push({
            role: 'user',
            content: `STOP: You are calling \`${toolName}\` with the same arguments repeatedly. This action is not making progress. Stop and reassess your approach — try a different strategy or report what is blocking you.`,
          });
          break;
        }

        logger.info(`[CodeAgent] Tool: ${toolName}`);
        toolsUsed.push(toolName);

        const tool = this.tools.find((t) => t.name === toolName);
        let toolResult: string;

        if (!tool) {
          toolResult = `Error: Unknown tool "${toolName}". Available tools: ${this.tools.map((t) => t.name).join(', ')}`;
        } else {
          try {
            const ctx: CodeToolContext = {
              workspaceDir: this.workspace.getWorkspaceDir(),
              lsp: this.lsp,
              depth: this.depth,
              maxDepth: this.maxDepth,
              spawnChildAgent: this.depth < this.maxDepth
                ? async (task, context) => {
                    const child = new CodeAgent({
                      orchestrator: this.orchestrator,
                      workspace: this.workspace,
                      maxIterations: this.maxIterations,
                      lspEnabled: true,
                      depth: this.depth + 1,
                      maxDepth: this.maxDepth,
                    });
                    // Share the parent's LSP manager so servers don't restart
                    child.lsp = this.lsp;
                    const taskMsg = context ? `${task}\n\nContext: ${context}` : task;
                    const result = await child.chat(taskMsg);
                    return result.content;
                  }
                : undefined,
            };
            toolResult = await tool.execute(toolArgs, ctx);
          } catch (e) {
            toolResult = `Error executing ${toolName}: ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        // Add tool result to messages (using Harmony format helper)
        const toolMessage = formatToolResult(toolCall.id, toolName, toolResult);
        messages.push(toolMessage);
      }
    }

    if (!finalContent) {
      finalContent = '[Max iterations reached without a final response]';
    }

    // Update conversation history (trim system prompt from what we store)
    const userMsg: Message = { role: 'user', content: userMessage };
    const assistantMsg: Message = { role: 'assistant', content: finalContent };
    this.history.push(userMsg, assistantMsg);

    // Auto-save after each exchange so conversations persist across sessions
    if (this.conversationManager) {
      await this.conversationManager.autoSave(
        this.history,
        this.workspace.getWorkspaceDir(),
        this.orchestrator,
      );
    }

    return { content: finalContent, toolsUsed, iterations };
  }

  /**
   * Compact the live messages array when the context window is filling up.
   *
   * Strategy (mirrors opencode's compaction approach):
   * 1. Keep the system/developer prompt (index 0).
   * 2. Identify tool-call + tool-result pairs in the middle of the conversation.
   * 3. Replace bulky tool results with compact "[result summarised]" placeholders.
   * 4. If a ConversationManager is available, generate a structured summary of
   *    the condensed middle section and inject it as a single context message.
   *
   * This runs in-loop (mid-turn) so we only compact once per chat() invocation
   * to avoid thrashing (controlled by the `compactedThisTurn` flag in the caller).
   */
  private async compactInLoopMessages(messages: Message[], systemPrompt: string): Promise<Message[]> {
    // Always keep: [0] system/developer prompt + last KEEP_RECENT messages
    const KEEP_RECENT = 10;

    if (messages.length <= KEEP_RECENT + 1) {
      // Nothing meaningful to compact
      return messages;
    }

    const systemMsg = messages[0]; // developer/system prompt
    const recentMessages = messages.slice(-KEEP_RECENT);
    const middleMessages = messages.slice(1, -KEEP_RECENT);

    if (middleMessages.length === 0) return messages;

    // Build a structured compaction summary using the opencode template
    const conversationText = middleMessages
      .map((msg) => {
        if (msg.role === 'tool') {
          // Tool results — truncate to first 200 chars to save tokens in the summary prompt
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return `[Tool result]: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
        }
        const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : msg.role;
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return `${role}: ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}`;
      })
      .join('\n\n');

    const compactionPrompt = `You are summarising a coding session to preserve context for the next agent turn.

Provide a structured summary following this exact template:

## Goal

[What goal(s) is the user trying to accomplish in this session?]

## Instructions

- [Important instructions the user gave that are still relevant]

## Discoveries

[Notable things learned during this conversation — file structures, patterns, errors encountered]

## Accomplished

[Work completed so far, work in progress, work remaining]

## Relevant files / directories

[Files that have been read, edited, or created — include full paths]

---

Conversation to summarise:
${conversationText}

Keep the summary concise but complete. Focus on what would help continue the work.`;

    let summaryContent: string;
    try {
      const summaryResponse = await this.orchestrator.chat({
        messages: [{ role: 'user', content: compactionPrompt }],
        temperature: 0.1,
        maxTokens: 1500,
      });
      summaryContent = summaryResponse.content.trim();
    } catch (err) {
      // Fallback: strip middle tool results to their first line only
      logger.warn('[CodeAgent] Compaction summary failed, falling back to tool-result stripping');
      const stripped = middleMessages.map((msg) => {
        if (msg.role === 'tool') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          const firstLine = content.split('\n')[0];
          return { ...msg, content: `${firstLine} [... result truncated for context compaction]` };
        }
        return msg;
      });
      return [systemMsg, ...stripped, ...recentMessages];
    }

    const summaryMessage: Message = {
      role: 'user',
      content:
        `[Context compacted — conversation history summarised to fit within context window]\n\n` +
        summaryContent +
        `\n\n[End of summary — continuing conversation...]`,
    };

    return [systemMsg, summaryMessage, ...recentMessages];
  }

  /** Clean up LSP servers and other resources. */
  async cleanup(): Promise<void> {
    // Only shutdown LSP if we own it (not a shared child-agent LSP)
    if (this.depth === 0) {
      await this.lsp.shutdown().catch(() => {});
    }
  }

  // ─── IAgent interface methods ─────────────────────────────────────────────

  getWorkspace(): WorkspaceManager {
    return this.workspace;
  }

  getMCPManager(): {
    getServerStatus(): Array<{ name: string; connected: boolean; enabled: boolean; toolCount: number }>;
    getClient(): { getAllTools(): Array<{ name: string; description: string }> };
  } {
    // CodeAgent uses in-process tools, not MCP. Return a stub that reflects built-in tools.
    const tools = this.tools;
    return {
      getServerStatus: () => [{
        name: 'code-tools',
        connected: true,
        enabled: true,
        toolCount: tools.length,
      }],
      getClient: () => ({
        getAllTools: () => tools.map((t) => ({ name: t.name, description: t.description })),
      }),
    };
  }

  resetConversation(): void {
    this.history = [];
  }

  getConversationHistory(): Message[] {
    return this.history;
  }

  getConversationManager(): ConversationManager | null | undefined {
    return this.conversationManager;
  }

  async saveConversation(): Promise<string | null> {
    if (!this.conversationManager) return null;
    return this.conversationManager.saveConversation(
      this.history,
      this.workspace.getWorkspaceDir(),
      undefined,
      this.orchestrator,
    );
  }

  async loadConversation(id: string): Promise<void> {
    if (!this.conversationManager) return;
    const conversation = await this.conversationManager.loadConversation(id);
    if (conversation) {
      this.history = conversation.messages;
    }
  }

  async listConversations(): Promise<Array<{ id: string; title?: string; updated: string | number; messageCount: number; workspace?: string }>> {
    if (!this.conversationManager) return [];
    return this.conversationManager.listConversations();
  }

  /** Get the code mode indicator for UI display. */
  static get indicator(): string {
    return CODE_MODE_INDICATOR;
  }
}
