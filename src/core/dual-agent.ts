/**
 * Dual Agent System - Coordinates Manager, Worker, and Client agents
 *
 * Three-agent architecture:
 * - Manager: High-level planning and coordination
 * - Worker: Task execution with tools
 * - Client: Adaptive validation and quality control
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { ConversationManager } from './conversation-manager.js';
import { PersonaManager } from '../personas/persona-manager.js';
import { AgentSpawner } from './agent-spawner.js';
import { ManagerAgent } from './manager-agent.js';
import { WorkerAgent } from './worker-agent.js';
import { ClientAgent } from './client-agent.js';
import { logger } from '../utils/logger.js';
import { orchestrationLogger } from '../utils/orchestration-logger.js';
import { Message } from '../models/base.js';

export interface DualAgentConfig {
  orchestrator: ModelOrchestrator;
  mcpManager: MCPServerManager;
  workspace: WorkspaceManager;
  conversationManager?: ConversationManager;
  personaManager?: PersonaManager;
  maxSubtasks?: number;
  maxIterations?: number;
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
  private personaManager: PersonaManager | null;
  private agentSpawner: AgentSpawner | null = null;

  private manager: ManagerAgent;
  private worker: WorkerAgent;
  private client: ClientAgent;

  private maxSubtasks: number;
  private maxIterations: number;
  private autoSave: boolean;
  private condensingThreshold: number;

  private userConversationHistory: Message[] = [];

  constructor(config: DualAgentConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.conversationManager = config.conversationManager || null;
    this.personaManager = config.personaManager || null;

    this.maxSubtasks = config.maxSubtasks || 10;
    this.maxIterations = config.maxIterations || 10;
    this.autoSave = config.autoSave !== false;
    this.condensingThreshold = config.condensingThreshold || 30;

    // Initialize agents (three-agent architecture)
    this.manager = new ManagerAgent(this.orchestrator, this.workspace, this.personaManager || undefined);
    this.worker = new WorkerAgent(this.orchestrator, this.mcpManager, this.workspace, this.maxIterations, this.personaManager || undefined);
    this.client = new ClientAgent(this.orchestrator, this.mcpManager);

    // Initialize AgentSpawner if PersonaManager is available
    if (this.personaManager) {
      this.agentSpawner = new AgentSpawner(
        this.orchestrator,
        this.mcpManager,
        this.workspace,
        this.conversationManager,
        this.personaManager
      );
      this.worker.setAgentSpawner(this.agentSpawner);
    }

    logger.info('[*] Three-agent system initialized (Manager + Worker + Client)');
    
    if (this.personaManager) {
      const activePersona = this.personaManager.getActivePersona();
      if (activePersona) {
        logger.info(`[*] Active persona: ${activePersona.manifest.name} (${activePersona.skills.length} skills)`);
      }
    }
  }

  /**
   * Process user message using dual-agent architecture
   */
  async chat(userMessage: string): Promise<DualAgentResponse> {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`>> User: ${userMessage}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    orchestrationLogger.logUserMessage(userMessage);

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

    const phaseStartTime = Date.now();
    orchestrationLogger.logPhaseStart('PLANNING');

    const plan = await this.manager.createPlan({
      userRequest: userMessage,
      context: this.getRecentContext(),
    });

    orchestrationLogger.logPhaseEnd('PLANNING', Date.now() - phaseStartTime);

    // PHASE 2: Execute subtasks
    logger.info('\n[PHASE 2: Execution]');
    logger.info('─────────────────────────────────────────');

    const executionStartTime = Date.now();
    orchestrationLogger.logPhaseStart('EXECUTION');

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

      // Client validates Worker's result (adaptive involvement)
      const validation = await this.client.validate(
        userMessage,
        plan.subtasks,
        workerResult
      );

      if (!validation.approved && validation.nextAction) {
        logger.info(`[Client] Validation failed: ${validation.issues.join(', ')}`);
        logger.info(`[Client] Requesting correction: ${validation.nextAction}`);

        // Deduplicate correction subtasks - don't add the same correction twice
        const normalizedCorrection = validation.nextAction.toLowerCase().trim();
        const isDuplicate = subtasksToExecute.some(existing => 
          existing.toLowerCase().trim() === normalizedCorrection
        ) || results.some(r => 
          r.subtask.toLowerCase().trim() === normalizedCorrection
        );

        // Add correction subtask (but don't exceed maxSubtasks and avoid duplicates)
        if (isDuplicate) {
          logger.warn(`[Client] Skipping duplicate correction subtask`);
        } else if (subtasksToExecute.length < this.maxSubtasks) {
          subtasksToExecute.push(validation.nextAction);
          logger.info(`[Client] Added correction subtask (${subtasksToExecute.length} total)`);
        } else {
          logger.warn(`[Client] Cannot add correction - maxSubtasks (${this.maxSubtasks}) reached`);
        }
      } else if (validation.approved) {
        logger.info(`[Client] Validation passed (${validation.involvementLevel} level)`);
      }
    }

    orchestrationLogger.logPhaseEnd('EXECUTION', Date.now() - executionStartTime);

    // PHASE 3: Synthesize final response
    logger.info('\n[PHASE 3: Synthesis]');
    logger.info('─────────────────────────────────────────');

    const synthesisStartTime = Date.now();
    orchestrationLogger.logPhaseStart('SYNTHESIS');

    const finalResponse = await this.synthesizeResponse(plan, results);
    totalIterations += 1;

    orchestrationLogger.logPhaseEnd('SYNTHESIS', Date.now() - synthesisStartTime);

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

    orchestrationLogger.logFinalResponse(finalResponse, totalIterations, allToolsUsed);

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
    // If only one subtask and it's a short success message, return directly
    // But ALWAYS synthesize if result indicates failure or incomplete work
    if (results.length === 1 && results[0].result.length < 500) {
      const result = results[0].result;

      // Check if this is a failure/incomplete message
      const isFailure = result.includes('could not be completed') ||
                       result.includes('failed') ||
                       result.includes('error') ||
                       result.toLowerCase().includes('unable to');

      // If it's a failure, always let Manager synthesize to provide proper context
      if (isFailure) {
        logger.info('[DualAgent] Result indicates failure, invoking Manager synthesis');
        return await this.manager.synthesizeResponse(results);
      }

      // Otherwise, short successful result can be returned directly
      return result;
    }

    // Multiple subtasks or long result - ask Manager to synthesize
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
    logger.info('[DualAgent] Cleaning up...');
    
    // Cleanup spawned agents
    if (this.agentSpawner) {
      await this.agentSpawner.cleanup();
    }
    
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

  getPersonaManager(): PersonaManager | null {
    return this.personaManager;
  }

  /**
   * Set agent spawner (used by parent agents to enable spawning in sub-agents)
   */
  setAgentSpawner(spawner: AgentSpawner): void {
    this.agentSpawner = spawner;
    if (this.worker) {
      this.worker.setAgentSpawner(spawner);
    }
  }

  /**
   * Get agent spawner
   */
  getAgentSpawner(): AgentSpawner | null {
    return this.agentSpawner;
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
