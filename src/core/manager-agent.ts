/**
 * Manager Agent - High-level planning and coordination
 *
 * Responsibilities:
 * - Understand user request
 * - Break down into subtasks
 * - Delegate to Worker agent
 * - Review results
 * - Decide when complete
 * - Format final response
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { WorkspaceManager } from './workspace.js';
import { PersonaManager } from '../personas/persona-manager.js';
import { AgentContext } from './types/agent-context.js';
import { WorkerResult } from './worker-agent.js';
import { Message } from '../models/base.js';
import { logger } from '../utils/logger.js';
import { orchestrationLogger } from '../utils/orchestration-logger.js';

export interface ManagerTask {
  userRequest: string;
  context?: string;
}

export interface ManagerPlan {
  subtasks: string[];
  reasoning: string;
  /** True when the user's message is purely conversational — no task execution needed. */
  conversational?: boolean;
}

export interface ManagerDecision {
  isComplete: boolean;
  reasoning: string;
  nextAction?: string;
}

export class ManagerAgent {
  private orchestrator: ModelOrchestrator;
  private workspace: WorkspaceManager;
  private personaManager?: PersonaManager;
  private conversationHistory: Message[] = [];

  constructor(orchestrator: ModelOrchestrator, workspace: WorkspaceManager, personaManager?: PersonaManager) {
    this.orchestrator = orchestrator;
    this.workspace = workspace;
    this.personaManager = personaManager;
    
    // Set persona context for logging
    if (personaManager) {
      const activePersona = personaManager.getActivePersona();
      if (activePersona) {
        logger.setPersonaContext(activePersona.manifest.name);
      }
    }
    
    this.initializeSystemPrompt();
  }

  private initializeSystemPrompt() {
    // Store base system prompt WITHOUT directive — directive is injected fresh per-call
    const personaPrompt = this.personaManager?.getSystemPromptAddition() || '';

    let systemContent = `You are the Manager Agent in a two-agent system.

ROLE:
You plan and coordinate at a HIGH LEVEL. You do NOT execute tools or create detailed implementation plans.

WORKFLOW:
1. Understand the user's request
2. Create a MINIMAL, high-level plan (typically 1-3 subtasks)
3. Delegate subtasks to the capable Worker agent
4. Review Worker's final results
5. Decide if task is complete or more work needed
6. Format final response for user

CRITICAL PRINCIPLES:
- LESS IS MORE: Fewer, broader subtasks are better than many micro-tasks
- TRUST THE WORKER: Worker is highly capable and handles implementation details
- AVOID MICRO-MANAGEMENT: Don't break down tasks into tiny steps
- CODE TASKS = 1-2 SUBTASKS: File creation, editing, generation should be single subtasks
- INFO TASKS = 1-2 SUBTASKS: Reading, analyzing, listing should be single subtasks
- DATA GATHER + FILE WRITE = 1 SUBTASK: If a task requires gathering/collecting data AND then writing that data to a file, create exactly ONE subtask that does both. The Worker does NOT share memory between subtasks — data collected in one subtask is gone when the next subtask starts.

IMPORTANT:
- Think strategically, not tactically
- Be specific but high-level in your subtask instructions
- Review Worker results critically
- Only mark complete when user's request is fully satisfied
`;

    if (personaPrompt) {
      systemContent += `\n${personaPrompt}\n`;
    }

    // NOTE: Directive is NOT baked in here; it's injected fresh each call via getSystemMessages()
    this.conversationHistory.push({
      role: 'system',
      content: systemContent,
    });
  }

  /**
   * Get system messages with fresh directive + optional AgentContext.
   * Follows the per-call directive injection pattern from JivaAgent.getSystemMessages().
   */
  private getSystemMessages(agentContext?: AgentContext): Message[] {
    const systemMessage = this.conversationHistory[0];

    // Inject fresh directive per-call
    const freshDirective = agentContext?.directive || this.workspace.getDirectivePrompt() || '';

    const parts: string[] = [];
    if (freshDirective) {
      parts.push(freshDirective);
    }

    if (parts.length === 0) {
      return [systemMessage];
    }

    return [
      systemMessage,
      {
        role: 'developer' as any,
        content: parts.join('\n'),
      },
    ];
  }

  /**
   * Create a plan for handling the user's request
   */
  async createPlan(task: ManagerTask, agentContext?: AgentContext): Promise<ManagerPlan> {
    logger.info('[Manager] Creating plan...');
    orchestrationLogger.logManagerCreatePlan(task.userRequest, task.context || '');

    const planPrompt = `User Request: ${task.userRequest}
${task.context ? `\nContext: ${task.context}` : ''}

Create a HIGH-LEVEL plan with MINIMAL subtasks. Follow these guidelines:

CRITICAL - Subtask Granularity:
- Keep subtasks at a HIGH LEVEL - let Worker handle implementation details
- For code generation/file operations: 1-3 subtasks maximum
- For information gathering: 1-2 subtasks maximum
- Only create separate subtasks when they are truly independent or sequential dependencies exist

Examples of GOOD vs BAD:
BAD: 5 granular steps like "Create HTML structure", "Add CSS", "Add JS", "Test"
GOOD: 1 subtask: "Create the calculator application as calc.html"

BAD: "List directory contents", "Read package.json", "Identify dependencies"
GOOD: 1 subtask: "Analyze project dependencies and structure"

BAD (DATA + WRITE SPLIT — WILL FAIL): Subtask 1 "Gather all data from APIs/databases", Subtask 2 "Compile and write results to output.json" — the second Worker will have NO data because Workers do not share memory between subtasks. The file will be empty.
GOOD (DATA + WRITE TOGETHER): 1 subtask: "Gather all data from APIs/databases AND write the complete results to workspace/output.json before returning."

Guidelines:
- Don't create subtasks for clarifying requirements - Worker can ask if needed
- Don't create subtasks for implementation details (styling, specific code structure)
- Don't create separate "test" or "verify" subtasks - Worker does this naturally
- Trust Worker to handle file operations, error checking, and iteration
- Each subtask MUST be a clear, actionable instruction - NOT prose, advice, or explanation

CONVERSATIONAL MESSAGES:
- If the message is purely conversational (greeting, thank-you, compliment, acknowledgment, small talk) with NO actionable task embedded, return:
  {"conversational": true, "subtasks": [], "reasoning": "Conversational message — no task required"}
- Do NOT invent tasks from prior conversation context just because a topic was mentioned earlier.

Respond ONLY with valid JSON in this exact format (no other text before or after):
{
  "reasoning": "<brief explanation of your high-level approach>",
  "conversational": false,
  "subtasks": [
    "<subtask 1 - a clear, actionable instruction>",
    "<subtask 2 - only if truly necessary>"
  ]
}`;

    this.conversationHistory.push({
      role: 'user',
      content: planPrompt,
    });

    const response = await this.orchestrator.chat({
      messages: [...this.getSystemMessages(agentContext), ...this.conversationHistory.slice(1)],
      temperature: 0.1, // Low temperature for deterministic planning
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    // Parse JSON response with fallback
    let plan: { reasoning: string; subtasks: string[]; conversational?: boolean };

    try {
      plan = this.parseJsonPlan(response.content);
    } catch (parseError) {
      // Fallback: ask LLM to clean the raw output into valid JSON
      logger.warn('[Manager] Failed to parse plan JSON, attempting LLM cleanup');
      plan = await this.cleanPlanWithLLM(response.content);
    }

    const isConversational = !!(plan as any).conversational;

    // Validate subtasks - filter out garbage entries (allow empty list for conversational)
    plan.subtasks = this.validateSubtasks(plan.subtasks, isConversational);

    if (isConversational) {
      logger.info('[Manager] Conversational message detected — skipping task execution');
    } else {
      logger.info(`[Manager] Reasoning: ${plan.reasoning}`);
      logger.info(`[Manager] Plan: ${plan.subtasks.length} subtasks`);
      plan.subtasks.forEach((task, i) => logger.info(`  ${i + 1}. ${task}`));
    }

    orchestrationLogger.logManagerPlanCreated(plan.subtasks, plan.reasoning);

    return { subtasks: plan.subtasks, reasoning: plan.reasoning, conversational: isConversational };
  }

  /**
   * Review Worker's results and decide next action
   */
  async reviewResults(subtask: string, workerResult: string): Promise<ManagerDecision> {
    logger.info(`[Manager] Reviewing: "${subtask}"`);
    orchestrationLogger.logManagerReview(subtask, workerResult);

    const reviewPrompt = `The Worker completed this subtask:
Subtask: ${subtask}

Worker Result:
${workerResult}

Please review:
1. Was the subtask completed successfully?
2. Is the result useful for answering the user's request?
3. What should happen next?

Respond in this format:
REASONING: <your analysis>
DECISION: COMPLETE | CONTINUE | RETRY
NEXT_ACTION: <what to do next, if CONTINUE>`;

    this.conversationHistory.push({
      role: 'user',
      content: reviewPrompt,
    });

    const response = await this.orchestrator.chat({
      messages: [...this.getSystemMessages(), ...this.conversationHistory.slice(1)],
      temperature: 0.1, // Low temperature for deterministic decisions
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    const reasoning = this.extractSection(response.content, 'REASONING');
    const decision = this.extractSection(response.content, 'DECISION');
    const nextAction = this.extractSection(response.content, 'NEXT_ACTION');

    logger.info(`[Manager] Review: ${reasoning}`);
    logger.info(`[Manager] Decision: ${decision}`);

    const isComplete = decision.toUpperCase().includes('COMPLETE');
    orchestrationLogger.logManagerDecision(isComplete, reasoning, nextAction || undefined);

    return {
      isComplete,
      reasoning,
      nextAction: nextAction || undefined,
    };
  }

  /**
   * Review a Worker's subtask result and decide whether to accept it or request a retry.
   *
   * Rules (fast-path first — avoids an LLM call for the common case):
   * - AUTO-ACCEPT:  tools were used AND the result is substantive (>100 chars)
   * - AUTO-REJECT:  no tools were used at all (pure hallucination / text-only response)
   * - LLM REVIEW:  tools were used but result is suspiciously short (<100 chars)
   *
   * Returns { accepted: true } or { accepted: false, specificCorrection: "…" }.
   * The specificCorrection is a clean, targeted instruction — NOT a stacked prefix.
   */
  async reviewSubtaskResult(
    subtask: string,
    workerResult: WorkerResult,
    originalRequest: string,
  ): Promise<{ accepted: boolean; specificCorrection?: string }> {
    // Fast-path accept: tools were used and result has substance
    if (workerResult.toolsUsed.length > 0 && workerResult.result.length >= 100) {
      logger.info(`[Manager] Auto-accepted subtask (${workerResult.toolsUsed.length} tools used, ${workerResult.result.length} chars)`);
      return { accepted: true };
    }

    // Fast-path reject: no tools at all — pure text-only response (hallucination)
    if (workerResult.toolsUsed.length === 0) {
      logger.warn(`[Manager] Auto-rejected subtask — Worker used no tools`);
      const correction = `You produced a text-only response without using any tools. You MUST use the available tools to complete this task. Do not fabricate or infer data — call the appropriate tools now.\n\nOriginal task: ${subtask}`;
      return { accepted: false, specificCorrection: correction };
    }

    // Edge case: tools used but result is very short — ask LLM to judge
    logger.info(`[Manager] LLM review: tools=${workerResult.toolsUsed.length}, result length=${workerResult.result.length}`);
    const reviewPrompt = `You are reviewing whether a Worker agent's result satisfactorily completes a subtask.

Original user request: ${originalRequest}

Subtask assigned to Worker: ${subtask}

Tools used by Worker: ${workerResult.toolsUsed.join(', ')}

Worker's result:
${workerResult.result}

DECISION RULES:
- ACCEPT if the Worker gathered real data and provided a substantive result, even if partial
- REJECT only if the result is clearly empty, fabricated, or completely off-task

Respond with ONLY one of:
ACCEPT
REJECT: <one sentence explaining what specific data is still missing>`;

    const response = await this.orchestrator.chat({
      messages: [
        { role: 'system', content: 'You are a task reviewer. Reply with ACCEPT or REJECT: <reason>.' },
        { role: 'user', content: reviewPrompt },
      ],
      temperature: 0.1,
    });

    const verdict = response.content.trim();
    if (verdict.startsWith('REJECT')) {
      const reason = verdict.replace(/^REJECT:?\s*/i, '').trim();
      logger.warn(`[Manager] LLM rejected subtask: ${reason}`);
      const correction = `The previous attempt was insufficient: ${reason}\n\nRetry the subtask using the appropriate tools: ${subtask}`;
      return { accepted: false, specificCorrection: correction };
    }

    logger.info(`[Manager] LLM accepted subtask`);
    return { accepted: true };
  }

  /**
   * Create final response for user
   */
  async synthesizeResponse(allResults: { subtask: string; result: string; accepted?: boolean }[], agentContext?: AgentContext): Promise<string> {
    logger.info('[Manager] Synthesizing final response...');
    orchestrationLogger.logManagerSynthesize(allResults.length);

    const acceptedResults = allResults.filter(r => r.accepted !== false);
    const failedResults = allResults.filter(r => r.accepted === false);

    const completedSection = acceptedResults.length > 0
      ? `Completed Work:\n${acceptedResults.map((r, i) => `${i + 1}. ${r.subtask}\nResult: ${r.result}`).join('\n\n')}`
      : 'No subtasks completed successfully.';

    const failedSection = failedResults.length > 0
      ? `\n\nSubtasks That Could Not Be Completed:\n${failedResults.map((r, i) => `${i + 1}. ${r.subtask}\nWorker output: ${r.result}`).join('\n\n')}`
      : '';

    const synthesisPrompt = `Based on the work below, create a final response for the user.

IMPORTANT: Be honest about what was and was not accomplished. Do NOT claim results were produced if the corresponding subtask is listed as failed.

${completedSection}${failedSection}

Create a clear, honest response that accurately reflects what was accomplished. If any work failed, explain briefly what happened.`;

    this.conversationHistory.push({
      role: 'user',
      content: synthesisPrompt,
    });

    const response = await this.orchestrator.chat({
      messages: [...this.getSystemMessages(agentContext), ...this.conversationHistory.slice(1)],
      temperature: 0.1, // Low temperature for deterministic synthesis
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    logger.info('[Manager] Final response created');

    return response.content;
  }

  /**
   * Respond directly to a conversational message — no planning or tool execution.
   * Used when `createPlan()` signals `conversational: true`.
   *
   * @param userConversationHistory - The full user-facing conversation so far
   *   (already includes the current user message at the tail).
   * @param agentContext - Current agent context for directive injection.
   */
  async directReply(
    userConversationHistory: Message[],
    agentContext?: AgentContext,
  ): Promise<string> {
    const systemMessages = this.getSystemMessages(agentContext);
    const response = await this.orchestrator.chat({
      messages: [...systemMessages, ...userConversationHistory],
      temperature: 0.7, // Slightly higher for natural conversation
    });
    logger.info('[Manager] Direct conversational reply produced');
    return response.content;
  }

  /**
   * Parse a JSON plan from LLM output. Extracts the first JSON object found.
   */
  private parseJsonPlan(content: string): { reasoning: string; subtasks: string[]; conversational?: boolean } {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Conversational responses intentionally return subtasks: [] — that is valid.
    const isConversational = !!parsed.conversational;

    if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
      throw new Error('Invalid plan structure: missing subtasks array');
    }

    if (parsed.subtasks.length === 0 && !isConversational) {
      throw new Error('Invalid plan structure: empty subtasks array for non-conversational message');
    }

    return {
      reasoning: parsed.reasoning || '',
      subtasks: parsed.subtasks.map((s: any) => String(s)),
      conversational: isConversational || undefined,
    };
  }

  /**
   * Fallback: use LLM to clean a raw plan response into valid JSON
   */
  private async cleanPlanWithLLM(rawContent: string): Promise<{ reasoning: string; subtasks: string[]; conversational?: boolean }> {
    const cleanupPrompt = `The following text is a plan that should have been JSON but was not properly formatted.
Extract the reasoning and subtasks from it and return valid JSON.
Ignore any prose, markdown separators, advice paragraphs, or non-actionable content.
Only include entries that are clear, actionable task instructions.

IMPORTANT: If the plan indicates a purely conversational message (greeting, small talk, etc.) with no
actionable subtasks, preserve that by returning: {"conversational": true, "subtasks": [], "reasoning": "..."}

Raw text:
${rawContent}

Return ONLY valid JSON in one of these two formats (no other text):
For actionable tasks: {"reasoning": "<reasoning>", "subtasks": ["<subtask 1>", "<subtask 2>"]}
For conversational messages: {"conversational": true, "subtasks": [], "reasoning": "<reasoning>"}`;

    try {
      const cleanupResponse = await this.orchestrator.chat({
        messages: [
          { role: 'system', content: 'You are a JSON formatting assistant. Return only valid JSON.' },
          { role: 'user', content: cleanupPrompt },
        ],
        temperature: 0.1,
      });

      return this.parseJsonPlan(cleanupResponse.content);
    } catch (error) {
      // Ultimate fallback: treat the entire raw content as a single subtask
      logger.error('[Manager] LLM cleanup also failed, using raw content as single subtask');
      return {
        reasoning: 'Plan parsing failed - executing as single task',
        subtasks: [rawContent.substring(0, 500).trim()],
      };
    }
  }

  /**
   * Validate that each subtask is a reasonable, actionable instruction.
   * Removes garbage entries like separators, prose fragments, or empty strings.
   *
   * @param isConversational - When true, allow an empty list (no min-1 enforcement).
   */
  private validateSubtasks(subtasks: string[], isConversational = false): string[] {
    const validated = subtasks.filter(task => {
      const trimmed = task.trim();
      // Reject empty or too-short entries
      if (trimmed.length < 5) return false;
      // Reject markdown separators (---, ===, ***)
      if (/^[-=*]{2,}$/.test(trimmed)) return false;
      // Reject entries that are just punctuation/symbols
      if (/^[^a-zA-Z0-9]*$/.test(trimmed)) return false;
      return true;
    });

    // Enforce at least one subtask for real task plans.
    // For conversational messages the LLM intentionally returns subtasks: [] — allow that.
    if (validated.length === 0 && !isConversational) {
      logger.warn('[Manager] All subtasks filtered out, preserving first original');
      return subtasks.length > 0 ? [subtasks[0]] : ['Complete the user request'];
    }

    return validated;
  }

  private extractSection(content: string, sectionName: string): string {
    const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  getConversationHistory(): Message[] {
    return this.conversationHistory;
  }

  resetConversation() {
    this.conversationHistory = [];
    this.initializeSystemPrompt();
  }
}
