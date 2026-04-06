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
  tokenUsage?: import('../models/token-tracker.js').TokenUsageSnapshot;
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
/** Max consecutive read_file calls before injecting an "act, don't just read" nudge. */
const MAX_CONSECUTIVE_READS = 15;
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
- read_file: Read an existing file or list a directory. Only needed before editing an existing file.
- edit_file: Replace a specific string in an existing file (old_string → new_string). For partial changes.
- write_file: Create a new file or fully overwrite an existing one. Use this to create files from scratch.
- glob: Find files matching a pattern (e.g. "**/*.ts"). Only when you need to locate existing files.
- grep: Search existing file contents with regex. Only when you need to find something in existing code.
- bash: Run shell commands (build, test, lint, git operations).
- spawn_code_agent: Delegate a focused sub-task to a child agent.

CODING PRINCIPLES — READ CAREFULLY:
1. CREATING A NEW FILE → use write_file immediately. Do NOT read or explore first.
2. EDITING AN EXISTING FILE → read it first with read_file, then edit_file for targeted changes.
3. Only use glob/grep when you genuinely need to locate or understand existing code.
4. Make minimal, targeted changes — edit the exact lines that need changing.
5. After editing, check LSP errors in the tool result and fix them.
6. Verify your changes work by running tests or the build when appropriate.
7. Use bash only for shell commands (tests, builds, git) — NOT for reading files.
8. LARGE FILES (100+ lines): write in stages — never try to generate a complete large file in one call.
   - Stage 1: write_file with the skeleton/structure only (HTML tags, empty <style>, empty <script>)
   - Stage 2: edit_file to add CSS content into the <style> block
   - Stage 3: edit_file to add JS content into the <script> block
   - Each individual call must be short enough to fit in one model response.

TOOL SELECTION RULES (follow exactly):
- To CREATE a new file → write_file immediately (no reads needed first)
- To READ an existing file → read_file (not bash)
- To LIST directory contents → read_file on the directory path (not bash ls)
- To FIND files by pattern → glob (not bash find)
- To SEARCH file contents → grep (not bash grep/rg)
- To RUN commands (build/test/git) → bash

WHEN TO EXPLORE (only when actually needed):
- You are modifying existing code and need to understand its structure first.
- You need to find where a function, class, or variable is defined.
- You are debugging or tracing code through multiple files.
- Do NOT explore before creating brand-new files — just write them directly.`;

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
  private _stopped = false;

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
    let consecutiveToolCallErrors = 0;
    const MAX_CONSECUTIVE_TOOL_CALL_ERRORS = 6;
    // Track empty responses (no tool calls, no content) so we can inject a recovery nudge.
    // Allow up to 4 retries — Krutrim/Groq can return blank responses transiently and the
    // model usually recovers within 2-3 nudges.
    let emptyResponseCount = 0;
    const MAX_EMPTY_RESPONSES = 4;
    // Track consecutive read_file calls — model can get stuck re-reading without making changes
    let consecutiveReadCount = 0;

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

    // Reset stop flag at the start of each chat() so the agent is immediately reusable
    this._stopped = false;

    for (let i = 0; i < this.maxIterations; i++) {
      // Cooperative stop: set by stop() (Ctrl+C or HTTP stop endpoint)
      if (this._stopped) {
        logger.info('[CodeAgent] Stop requested — exiting after current step');
        finalContent = '[Task stopped by user]';
        break;
      }
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
        consecutiveToolCallErrors = 0; // reset on success
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[CodeAgent] Model error: ${msg}`);

        const isToolUseFailed = msg.includes('tool_use_failed') || msg.includes('Failed to parse tool call');
        const isValidationFailed = msg.includes('Tool call validation failed') || msg.includes('did not match schema');

        if (isToolUseFailed || isValidationFailed) {
          // Tool-call errors are handled separately from generic API errors.
          // Reset the generic error counter — the tool correction loop has its own guard.
          consecutiveApiErrors = 0;
          consecutiveToolCallErrors++;

          if (consecutiveToolCallErrors >= MAX_CONSECUTIVE_TOOL_CALL_ERRORS) {
            logger.warn(`[CodeAgent] ${consecutiveToolCallErrors} consecutive tool-call failures — injecting strategy reset`);
            consecutiveToolCallErrors = 0;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role !== 'assistant') {
              messages.push({ role: 'assistant', content: '' });
            }
            messages.push({
              role: 'user',
              content:
                'You have had repeated tool call failures. Stop and think about a different approach.\n\n' +
                `Valid tools: ${this.tools.map((t) => t.name).join(', ')}\n\n` +
                'Use simpler arguments. Avoid heredocs or complex shell constructs in bash — write to a temp file first if needed.',
            });
            continue;
          }

          // Conversation turn guard: for API-rejected calls (e.g. 400 tool_use_failed), the
          // model's assistant turn was never recorded. Injecting a user correction directly
          // would create an invalid user→user sequence. Add an empty assistant placeholder
          // so the structure is user→assistant→user before the correction lands.
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role !== 'assistant') {
            messages.push({ role: 'assistant', content: '' });
          }

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
            consecutiveToolCallErrors = 0;
            emptyResponseCount = 0; // fresh recovery budget after targeted guidance
            continue;
          }

          // --- Specific correction: tool content too large (output token limit hit) ---
          // When the model generates a very large write_file or edit_file call, the API cuts off
          // the JSON mid-content because the response exceeds the output token limit. The resulting
          // JSON is unparseable. Detect by tool name appearing in the failed_generation field.
          // Note: failed_generation is a JSON-encoded string so quotes are escaped (\"tool_name\").
          const isContentTooLarge =
            (msg.includes('write_file') || msg.includes('edit_file')) &&
            (msg.includes('Failed to parse tool call') || msg.includes('tool_use_failed'));

          if (isContentTooLarge) {
            // Parse the actual tool name from failed_generation to distinguish write_file vs edit_file
            let failedToolName = msg.includes('edit_file') && !msg.includes('write_file') ? 'edit_file' : 'write_file';
            let targetFile = '';
            try {
              const jsonMatch = msg.match(/API error \(\d+\): (.+)/s);
              if (jsonMatch) {
                const errorBody = JSON.parse(jsonMatch[1]);
                const failedGen: string | undefined = errorBody?.error?.failed_generation;
                if (failedGen) {
                  const parsed = JSON.parse(failedGen);
                  if (parsed?.name) failedToolName = parsed.name; // authoritative source
                  const fp = parsed?.arguments?.file_path;
                  if (fp) targetFile = ` for \`${fp}\``;
                }
              }
            } catch { /* ignore extraction errors */ }
            const isEditFile = failedToolName === 'edit_file';

            logger.warn(`[CodeAgent] ${isEditFile ? 'edit_file' : 'write_file'}${targetFile} content truncated (exceeded output token limit) — asking model to write in stages`);
            const correctionContent = isEditFile
              ? `Your edit_file call${targetFile} failed: new_string was too large and the response was cut off mid-JSON.\n\n` +
                `MAXIMUM 20 LINES per edit_file call. Write one tiny chunk at a time:\n` +
                `  - For JavaScript: add just ONE or TWO functions per call\n` +
                `  - For HTML: add just one row of buttons per call\n\n` +
                `Call edit_file now with a new_string of at most 20 lines.`
              : `Your write_file call${targetFile} failed: the file content was too large and was cut off mid-JSON.\n\n` +
                `Write the file in stages — NEVER put CSS or JavaScript in the initial write_file:\n` +
                `  Stage 1: write_file — HTML skeleton ONLY (empty <style></style> and empty <script></script>) — MAX 20 lines\n` +
                `  Stage 2: edit_file — add CSS (max 20 lines at a time)\n` +
                `  Stage 3: edit_file — add JavaScript ONE function at a time\n\n` +
                `Start with Stage 1 NOW: write_file with just the bare HTML skeleton (20 lines max).`;

            messages.push({ role: 'user', content: correctionContent });
            consecutiveToolCallErrors = 0;
            emptyResponseCount = 0; // reset so model has fresh recovery budget for staged CSS/JS edits
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
            consecutiveToolCallErrors = 0; // repaired successfully — reset tool call error counter
            continue;
          }

          // --- Fallback: inject correction message so the model can self-correct ---
          const nameMatch = msg.match(/"name":\s*"([^"]+)"/);
          const toolName = nameMatch ? nameMatch[1] : 'unknown';
          logger.warn(`[CodeAgent] Tool call error (${toolName}), injecting correction — ${consecutiveToolCallErrors}/${MAX_CONSECUTIVE_TOOL_CALL_ERRORS}`);
          messages.push({
            role: 'user',
            content:
              `Your last tool call was rejected. Error: "${msg.substring(0, 300)}"\n\n` +
              `Valid tools: ${this.tools.map((t) => t.name).join(', ')}\n` +
              `Each tool requires specific parameters — call the tool again with the correct name and JSON arguments.\n\n` +
              `For bash commands with complex content (heredocs, multi-line scripts): write the script to a temp file first using write_file, then execute it with bash.`,
          });
          continue;
        }

        // For all other (non-tool-call) errors — genuine API/network failures
        consecutiveApiErrors++;
        if (consecutiveApiErrors >= MAX_CONSECUTIVE_API_ERRORS) {
          finalContent = `Error: ${msg}`;
          break;
        }
        // Non-fatal: log and let the next iteration try again
        logger.warn(`[CodeAgent] API error ${consecutiveApiErrors}/${MAX_CONSECUTIVE_API_ERRORS}: ${msg}`);
        continue;
      }

      // Add assistant response to messages, preserving the full structure needed for the next turn.
      //
      // Three cases:
      //   1. Harmony mode: store rawHarmony string (contains <|call|> tokens the model needs).
      //   2. Standard tool-calling with tool calls: store content + tool_calls so subsequent
      //      role:'tool' results can be matched by tool_call_id (required by OpenAI-compatible APIs).
      //   3. Text-only response: store content as-is.
      const rawHarmony: string | undefined = (response as any).raw?.parsedHarmony?.rawResponse;
      if (rawHarmony) {
        messages.push({ role: 'assistant', content: rawHarmony });
      } else if (response.toolCalls && response.toolCalls.length > 0) {
        // Preserve tool_calls so tool results are properly matched in the next turn
        messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls,
        });
      } else {
        messages.push({ role: 'assistant', content: response.content });
      }

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

      // No tool calls → model is done (or gave up)
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (!response.content && emptyResponseCount < MAX_EMPTY_RESPONSES) {
          // Model returned empty content with no tool calls — it got stuck or confused.
          // Inject an escalating recovery nudge and let it try again.
          emptyResponseCount++;
          logger.warn(
            `[CodeAgent] Empty response with no tool calls (${emptyResponseCount}/${MAX_EMPTY_RESPONSES}) — injecting recovery nudge`,
          );

          // Escalate urgency with each retry so the model doesn't keep ignoring it
          let nudgeContent: string;
          if (emptyResponseCount <= 2) {
            nudgeContent =
              'Your last response was empty. Please continue working on the task.\n\n' +
              '- If you need to CREATE a file → call write_file now.\n' +
              '- If you need to EDIT a file → call read_file then edit_file.\n' +
              '- If the task is already complete → provide a brief summary of what was done.';
          } else {
            nudgeContent =
              `IMPORTANT (attempt ${emptyResponseCount}/${MAX_EMPTY_RESPONSES}): Your response is empty again — you have not called any tools.\n\n` +
              `You MUST call a tool NOW. Do not output plain text without a tool call.\n` +
              `  • To CREATE a new file → call write_file immediately with the file content.\n` +
              `  • To EDIT an existing file → call edit_file with old_string and new_string.\n` +
              `  • To LIST files → call read_file on the directory.\n\n` +
              `Make a tool call in your very next response. Do not explain — just call the tool.`;
          }
          messages.push({ role: 'user', content: nudgeContent });
          continue;
        }
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

        // Consecutive reads tracker — any non-read tool resets the streak
        if (toolName === 'read_file') {
          consecutiveReadCount++;
        } else {
          consecutiveReadCount = 0;
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

        // Reset empty response budget after any productive (mutating) tool call.
        // This gives the model a fresh set of recovery nudges for each new work phase
        // (e.g., after writing the skeleton, it gets 4 more chances to add CSS/JS).
        if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'bash') {
          emptyResponseCount = 0;
        }

        // Excessive reads nudge — model is re-reading without making any changes.
        // Fires after MAX_CONSECUTIVE_READS consecutive read_file calls; resets the count
        // so the model gets a fresh budget after each nudge (prevents spamming).
        if (consecutiveReadCount >= MAX_CONSECUTIVE_READS) {
          logger.warn(`[CodeAgent] ${consecutiveReadCount} consecutive read_file calls without edits — nudging model to act`);
          consecutiveReadCount = 0;
          messages.push({
            role: 'user',
            content:
              `You have called read_file ${MAX_CONSECUTIVE_READS}+ times in a row without making any changes.\n\n` +
              `STOP READING — you have enough context. Make a concrete change NOW:\n` +
              `  • To ADD or CHANGE content in an existing file → call edit_file with old_string and new_string\n` +
              `  • To CREATE a new file → call write_file\n` +
              `  • If the task is fully complete → provide a final summary (no more tool calls needed)\n\n` +
              `Do NOT call read_file again until you have made at least one edit_file or write_file call.`,
          });
          break; // exit inner tool loop — model sees the nudge on the next outer iteration
        }
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
        'code',
        this.orchestrator.getTokenUsage(),
      );
    }

    return { content: finalContent, toolsUsed, iterations, tokenUsage: this.orchestrator.getTokenUsage() };
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

    const directiveText = this.workspace.getDirectivePrompt();
    const directiveBlock = directiveText
      ? `WORKSPACE DIRECTIVE (prioritise retaining context aligned with this):\n${directiveText}\n\nWhen summarising, prioritise information that directly supports the directive above.\n\n---\n\n`
      : '';

    const compactionPrompt = `${directiveBlock}You are summarising a coding session to preserve context for the next agent turn.

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

  /** Signal the agent to stop after the current iteration. */
  stop(): void {
    this._stopped = true;
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
      'code',
    );
  }

  async loadConversation(id: string): Promise<void> {
    if (!this.conversationManager) return;
    const conversation = await this.conversationManager.loadConversation(id);
    if (conversation) {
      this.history = conversation.messages;
      // Restore the workspace this conversation was created in
      const savedWorkspace = conversation.metadata?.workspace;
      if (savedWorkspace && savedWorkspace !== this.workspace.getWorkspaceDir()) {
        try {
          await this.workspace.switchWorkspace(savedWorkspace);
          // Restart LSP for the new workspace root
          await this.lsp.shutdown().catch(() => {});
          this.lsp = new LspManager({
            root: savedWorkspace,
            enabled: true,
          });
          logger.info(`[CodeAgent] Workspace restored to: ${savedWorkspace}`);
        } catch (err) {
          logger.warn(`[CodeAgent] Could not restore workspace '${savedWorkspace}': ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  async listConversations(): Promise<Array<{ id: string; title?: string; updated: string | number; messageCount: number; workspace?: string; type?: string }>> {
    if (!this.conversationManager) return [];
    return this.conversationManager.listConversations('code');
  }

  getTokenUsage() {
    return this.orchestrator.getTokenUsage();
  }

  /** Get the code mode indicator for UI display. */
  static get indicator(): string {
    return CODE_MODE_INDICATOR;
  }
}
