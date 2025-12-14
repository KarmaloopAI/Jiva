/**
 * Dual Agent System - Coordinates Manager and Worker agents
 *
 * This is the main entry point that replaces the old single-agent architecture.
 * It implements a two-agent pattern for better separation of concerns.
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { ConversationManager } from './conversation-manager.js';
import { ManagerAgent } from './manager-agent.js';
import { WorkerAgent } from './worker-agent.js';
import { logger } from '../utils/logger.js';
import { Message } from '../models/base.js';

export interface DualAgentConfig {
  orchestrator: ModelOrchestrator;
  mcpManager: MCPServerManager;
  workspace: WorkspaceManager;
  conversationManager?: ConversationManager;
  maxSubtasks?: number;
  autoSave?: boolean;
  condensingThreshold?: number;
}

export interface DualAgentResponse {
  content: string;
  iterations: number;
  toolsUsed: string[];
  plan?: {
    subtasks: string[];
    reasoning: string;
  };
}

export class DualAgent {
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private workspace: WorkspaceManager;
  private conversationManager: ConversationManager | null;

  private manager: ManagerAgent;
  private worker: WorkerAgent;

  private maxSubtasks: number;
  private autoSave: boolean;
  private condensingThreshold: number;

  private userConversationHistory: Message[] = [];

  constructor(config: DualAgentConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.conversationManager = config.conversationManager || null;

    this.maxSubtasks = config.maxSubtasks || 10;
    this.autoSave = config.autoSave !== false;
    this.condensingThreshold = config.condensingThreshold || 30;

    // Initialize agents
    this.manager = new ManagerAgent(this.orchestrator, this.workspace);
    this.worker = new WorkerAgent(this.orchestrator, this.mcpManager, this.workspace);

    logger.info('[*] Dual-agent system initialized (Manager + Worker)');
  }

  /**
   * Process user message using dual-agent architecture
   */
  async chat(userMessage: string): Promise<DualAgentResponse> {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`>> User: ${userMessage}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Check if conversation needs condensing BEFORE adding new message
    if (this.userConversationHistory.length > this.condensingThreshold && this.conversationManager) {
      logger.info('[*] Condensing conversation history...');
      this.userConversationHistory = await this.conversationManager.condenseConversation(
        this.userConversationHistory,
        this.orchestrator,
        Math.floor(this.condensingThreshold * 0.7)
      );
    }

    // Add user message to history
    this.userConversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const allToolsUsed: string[] = [];
    let totalIterations = 0;

    // PHASE 1: Manager creates plan
    logger.info('\n[PHASE 1: Planning]');
    logger.info('─────────────────────────────────────────');

    const plan = await this.manager.createPlan({
      userRequest: userMessage,
      context: this.getRecentContext(),
    });

    // PHASE 2: Execute subtasks
    logger.info('\n[PHASE 2: Execution]');
    logger.info('─────────────────────────────────────────');

    const results: { subtask: string; result: string }[] = [];
    const subtasksToExecute = plan.subtasks.slice(0, this.maxSubtasks);

    for (let i = 0; i < subtasksToExecute.length; i++) {
      const subtask = subtasksToExecute[i];

      logger.info(`\n[Subtask ${i + 1}/${subtasksToExecute.length}] ${subtask}`);

      // Worker executes subtask
      const workerResult = await this.worker.executeSubtask({
        instruction: subtask,
        context: this.getRecentContext(),
      });

      totalIterations += 1;
      allToolsUsed.push(...workerResult.toolsUsed);

      results.push({
        subtask,
        result: workerResult.result,
      });

      // Manager reviews result
      const decision = await this.manager.reviewResults(subtask, workerResult.result);
      totalIterations += 1;

      if (!decision.isComplete && decision.nextAction) {
        // Manager wants to do something else
        logger.info(`[Manager] Next action: ${decision.nextAction}`);

        // Add as new subtask if not at limit
        if (results.length < this.maxSubtasks) {
          subtasksToExecute.push(decision.nextAction);
        }
      }
    }

    // PHASE 3: Synthesize final response
    logger.info('\n[PHASE 3: Synthesis]');
    logger.info('─────────────────────────────────────────');

    const finalResponse = await this.synthesizeResponse(plan, results);
    totalIterations += 1;

    // Add assistant response to user conversation history
    this.userConversationHistory.push({
      role: 'assistant',
      content: finalResponse,
    });

    // Auto-save if enabled
    if (this.autoSave && this.conversationManager) {
      await this.conversationManager.autoSave(
        this.userConversationHistory,
        this.workspace.getWorkspaceDir(),
        this.orchestrator
      );
    }

    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`[+] Complete: ${totalIterations} iterations, ${allToolsUsed.length} tools used`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      content: finalResponse,
      iterations: totalIterations,
      toolsUsed: allToolsUsed,
      plan: {
        subtasks: plan.subtasks,
        reasoning: plan.reasoning,
      },
    };
  }

  private async synthesizeResponse(
    plan: { subtasks: string[]; reasoning: string },
    results: { subtask: string; result: string }[]
  ): Promise<string> {
    // If only one subtask and simple, just return the result
    if (results.length === 1 && results[0].result.length < 500) {
      return results[0].result;
    }

    // Otherwise, ask Manager to synthesize
    return await this.manager.synthesizeResponse(results);
  }

  private getRecentContext(): string {
    // Get last few user messages for context
    const recent = this.userConversationHistory
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content)
      .join('\n');

    return recent || '';
  }

  async cleanup() {
    await this.mcpManager.cleanup();
    logger.info('[*] Dual-agent system cleaned up');
  }

  resetConversation() {
    this.userConversationHistory = [];
    this.manager.resetConversation();
    logger.info('[*] Conversation reset');
  }

  getConversationHistory(): Message[] {
    return this.userConversationHistory;
  }

  getWorkspace(): WorkspaceManager {
    return this.workspace;
  }

  getMCPManager(): MCPServerManager {
    return this.mcpManager;
  }

  getConversationManager(): ConversationManager | null {
    return this.conversationManager;
  }

  async saveConversation(): Promise<string | null> {
    if (!this.conversationManager) {
      logger.warn('Conversation manager not initialized');
      return null;
    }

    const id = await this.conversationManager.saveConversation(
      this.userConversationHistory,
      this.workspace.getWorkspaceDir(),
      undefined,
      this.orchestrator
    );

    logger.info(`[+] Conversation saved: ${id}`);
    return id;
  }

  async loadConversation(id: string): Promise<void> {
    if (!this.conversationManager) {
      throw new Error('Conversation manager not initialized');
    }

    const conversation = await this.conversationManager.loadConversation(id);
    this.userConversationHistory = conversation.messages;
    this.manager.resetConversation();

    logger.info(`[+] Conversation loaded: ${id}`);
  }

  async listConversations() {
    if (!this.conversationManager) {
      throw new Error('Conversation manager not initialized');
    }

    return await this.conversationManager.listConversations();
  }
}
