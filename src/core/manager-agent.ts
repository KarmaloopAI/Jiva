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
import { Message } from '../models/base.js';
import { logger } from '../utils/logger.js';

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
  private conversationHistory: Message[] = [];

  constructor(orchestrator: ModelOrchestrator, workspace: WorkspaceManager) {
    this.orchestrator = orchestrator;
    this.workspace = workspace;
    this.initializeSystemPrompt();
  }

  private initializeSystemPrompt() {
    const directivePrompt = this.workspace.getDirectivePrompt();

    let systemContent = `You are the Manager Agent in a two-agent system.

ROLE:
You plan and coordinate tasks. You do NOT execute tools directly.

WORKFLOW:
1. Understand the user's request
2. Break it down into clear, actionable subtasks
3. Delegate subtasks to the Worker agent
4. Review Worker's results
5. Decide if task is complete or more work needed
6. Format final response for user

IMPORTANT:
- Think step-by-step and explain your reasoning
- Be specific in your subtask instructions to Worker
- Review Worker results critically
- Only mark complete when user's request is fully satisfied
`;

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

    const planPrompt = `User Request: ${task.userRequest}
${task.context ? `\nContext: ${task.context}` : ''}

Please analyze this request and create a plan:
1. What subtasks are needed?
2. What order should they be executed?
3. What information needs to be gathered?

Respond in this format:
REASONING: <your analysis>
SUBTASKS:
- <subtask 1>
- <subtask 2>
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

    return { subtasks, reasoning };
  }

  /**
   * Review Worker's results and decide next action
   */
  async reviewResults(subtask: string, workerResult: string): Promise<ManagerDecision> {
    logger.info(`[Manager] Reviewing: "${subtask}"`);

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

    return {
      isComplete: decision.toUpperCase().includes('COMPLETE'),
      reasoning,
      nextAction: nextAction || undefined,
    };
  }

  /**
   * Create final response for user
   */
  async synthesizeResponse(allResults: { subtask: string; result: string }[]): Promise<string> {
    logger.info('[Manager] Synthesizing final response...');

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
