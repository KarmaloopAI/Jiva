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

Examples:
BAD (too granular):
  - Ask user for requirements
  - Create HTML structure
  - Add CSS styling
  - Add JavaScript logic
  - Test in browser
  (This should be 1 subtask: "Create calculator app as calc.html")

GOOD (appropriate level):
  - Create the calculator application
  - Refine based on user feedback (if needed)

BAD (too granular):
  - List directory contents
  - Read package.json
  - Identify dependencies
  - Format output
  (This should be 1 subtask: "List and analyze project dependencies")

GOOD (appropriate level):
  - Analyze project dependencies and structure

Guidelines:
- Don't create subtasks for clarifying requirements - Worker can ask if needed
- Don't create subtasks for implementation details (styling, specific code structure)
- Don't create separate "test" or "verify" subtasks - Worker does this naturally
- Trust Worker to handle file operations, error checking, and iteration

Respond in this format:
REASONING: <brief explanation of your high-level approach>
SUBTASKS:
- <subtask 1>
- <subtask 2> (only if truly necessary)
...`;

    this.conversationHistory.push({
      role: 'user',
      content: planPrompt,
    });

    const response = await this.orchestrator.chat({
      messages: this.conversationHistory,
      temperature: 0.3,
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    // Parse response
    const reasoning = this.extractSection(response.content, 'REASONING');
    const subtasksText = this.extractSection(response.content, 'SUBTASKS');
    const subtasks = subtasksText
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim());

    logger.info(`[Manager] Reasoning: ${reasoning}`);
    logger.info(`[Manager] Plan: ${subtasks.length} subtasks`);
    subtasks.forEach((task, i) => logger.info(`  ${i + 1}. ${task}`));

    orchestrationLogger.logManagerPlanCreated(subtasks, reasoning);

    return { subtasks, reasoning };
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
      temperature: 0.3,
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
      temperature: 0.5,
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    logger.info('[Manager] Final response created');

    return response.content;
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
