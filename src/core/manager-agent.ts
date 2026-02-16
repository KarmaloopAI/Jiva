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
    const directivePrompt = this.workspace.getDirectivePrompt();
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

IMPORTANT:
- Think strategically, not tactically
- Be specific but high-level in your subtask instructions
- Review Worker results critically
- Only mark complete when user's request is fully satisfied
`;

    if (personaPrompt) {
      systemContent += `\n${personaPrompt}\n`;
    }

    if (directivePrompt) {
      systemContent += `\n${directivePrompt}`;
    }

    this.conversationHistory.push({
      role: 'system',
      content: systemContent,
    });
  }

  /**
   * Create a plan for handling the user's request
   */
  async createPlan(task: ManagerTask): Promise<ManagerPlan> {
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

Guidelines:
- Don't create subtasks for clarifying requirements - Worker can ask if needed
- Don't create subtasks for implementation details (styling, specific code structure)
- Don't create separate "test" or "verify" subtasks - Worker does this naturally
- Trust Worker to handle file operations, error checking, and iteration
- Each subtask MUST be a clear, actionable instruction - NOT prose, advice, or explanation

Respond ONLY with valid JSON in this exact format (no other text before or after):
{
  "reasoning": "<brief explanation of your high-level approach>",
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
      messages: this.conversationHistory,
      temperature: 0.1, // Low temperature for deterministic planning
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    // Parse JSON response with fallback
    let plan: { reasoning: string; subtasks: string[] };

    try {
      plan = this.parseJsonPlan(response.content);
    } catch (parseError) {
      // Fallback: ask LLM to clean the raw output into valid JSON
      logger.warn('[Manager] Failed to parse plan JSON, attempting LLM cleanup');
      plan = await this.cleanPlanWithLLM(response.content);
    }

    // Validate subtasks - filter out garbage entries
    plan.subtasks = this.validateSubtasks(plan.subtasks);

    logger.info(`[Manager] Reasoning: ${plan.reasoning}`);
    logger.info(`[Manager] Plan: ${plan.subtasks.length} subtasks`);
    plan.subtasks.forEach((task, i) => logger.info(`  ${i + 1}. ${task}`));

    orchestrationLogger.logManagerPlanCreated(plan.subtasks, plan.reasoning);

    return { subtasks: plan.subtasks, reasoning: plan.reasoning };
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
      messages: this.conversationHistory,
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
   * Create final response for user
   */
  async synthesizeResponse(allResults: { subtask: string; result: string }[]): Promise<string> {
    logger.info('[Manager] Synthesizing final response...');
    orchestrationLogger.logManagerSynthesize(allResults.length);

    const synthesisPrompt = `Based on all the work completed, create a final response for the user.

Completed Work:
${allResults.map((r, i) => `${i + 1}. ${r.subtask}\nResult: ${r.result}`).join('\n\n')}

Create a clear, helpful response that directly answers the user's original request.
Present information clearly with relevant details, code snippets, or examples as appropriate.`;

    this.conversationHistory.push({
      role: 'user',
      content: synthesisPrompt,
    });

    const response = await this.orchestrator.chat({
      messages: this.conversationHistory,
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
   * Parse a JSON plan from LLM output. Extracts the first JSON object found.
   */
  private parseJsonPlan(content: string): { reasoning: string; subtasks: string[] } {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.subtasks || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
      throw new Error('Invalid plan structure: missing or empty subtasks array');
    }

    return {
      reasoning: parsed.reasoning || '',
      subtasks: parsed.subtasks.map((s: any) => String(s)),
    };
  }

  /**
   * Fallback: use LLM to clean a raw plan response into valid JSON
   */
  private async cleanPlanWithLLM(rawContent: string): Promise<{ reasoning: string; subtasks: string[] }> {
    const cleanupPrompt = `The following text is a plan that should have been JSON but was not properly formatted.
Extract the reasoning and actionable subtasks from it and return valid JSON.
Ignore any prose, markdown separators, advice paragraphs, or non-actionable content.
Only include entries that are clear, actionable task instructions.

Raw text:
${rawContent}

Return ONLY valid JSON in this exact format (no other text):
{
  "reasoning": "<the reasoning extracted from the text>",
  "subtasks": ["<subtask 1>", "<subtask 2>"]
}`;

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
   */
  private validateSubtasks(subtasks: string[]): string[] {
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

    // Ensure at least one subtask
    if (validated.length === 0) {
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
