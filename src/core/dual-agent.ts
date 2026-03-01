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
import { AgentContext } from './types/agent-context.js';
import { CompletionSignal } from './types/completion-signal.js';
import { serializeAgentContext } from './utils/serialize-agent-context.js';
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
  maxAgentDepth?: number; // Max depth for agent spawning (default: 1)
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
  private maxAgentDepth: number;
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
    this.maxAgentDepth = config.maxAgentDepth ?? 1; // Default: only Manager can spawn
    this.autoSave = config.autoSave !== false;
    this.condensingThreshold = config.condensingThreshold || 30;

    // Initialize agents (three-agent architecture)
    this.manager = new ManagerAgent(this.orchestrator, this.workspace, this.personaManager || undefined);
    this.worker = new WorkerAgent(this.orchestrator, this.mcpManager, this.workspace, this.maxIterations, this.personaManager || undefined);
    this.client = new ClientAgent(this.orchestrator, this.mcpManager);

    // Initialize AgentSpawner - always available as a baseline tool
    // Create a PersonaManager if one wasn't provided
    let spawnerPersonaManager: PersonaManager = this.personaManager!;
    if (!this.personaManager) {
      const { PersonaManager } = require('../personas/persona-manager.js');
      // Use ephemeral=false for top-level agent's spawner (it should persist)
      // Note: No StorageProvider here - CLI mode uses ConfigManager
      spawnerPersonaManager = new PersonaManager([], false);
      // Note: Not awaiting initialize() here - will be lazy loaded if needed
    }
    
    this.agentSpawner = new AgentSpawner(
      this.orchestrator,
      this.mcpManager,
      this.workspace,
      this.conversationManager,
      spawnerPersonaManager,
      {
        maxDepth: this.maxAgentDepth,
        currentDepth: 0,
      }
    );
    this.worker.setAgentSpawner(this.agentSpawner);

    logger.info('[*] Three-agent system initialized (Manager + Worker + Client)');
    logger.info(`[*] Agent spawn depth limit: ${this.maxAgentDepth} (${this.maxAgentDepth === 1 ? 'only Manager can spawn' : `${this.maxAgentDepth} levels deep`})`);
    
    if (this.personaManager) {
      const activePersona = this.personaManager.getActivePersona();
      if (activePersona) {
        logger.info(`[*] Active persona: ${activePersona.manifest.name} (${activePersona.skills.length} skills)`);
      }
    }
  }

  /**
   * Build a shared AgentContext for the current turn.
   * Single source of truth: all three agents receive the same context object.
   *
   * Strategy:
   * - Option A (primary): If ConversationManager is available, condense + last N messages.
   * - Option B (fallback): Keep last N messages of all roles when ConversationManager is null.
   */
  private buildAgentContext(): AgentContext {
    // Fresh directive each turn
    const directive = this.workspace.getDirectivePrompt() || undefined;

    // Conversation history: include user + assistant + tool roles
    const allRoleMessages = this.userConversationHistory.filter(
      m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool'
    );

    // Option A uses summary from condensed history; Option B uses raw tail.
    // After condensing (which happens before this call in chat()), the first
    // system-role entry starting with "[Previous conversation summary]" serves
    // as the summary.
    let summary: string | undefined;
    if (this.conversationManager) {
      const summaryMsg = this.userConversationHistory.find(
        m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Previous conversation summary]')
      );
      if (summaryMsg && typeof summaryMsg.content === 'string') {
        summary = summaryMsg.content;
      }
    }

    // Pass the full conversation history — the conversation manager already
    // condenses history (at condensingThreshold) before this is called, so
    // no artificial slice is needed here. The 128k context window handles the rest.
    const recentMessages = allRoleMessages;

    // Persona context
    let persona: AgentContext['persona'];
    if (this.personaManager) {
      const activePersona = this.personaManager.getActivePersona();
      if (activePersona) {
        persona = {
          name: activePersona.manifest.name,
          systemPromptAddition: this.personaManager.getSystemPromptAddition(),
          validationContext: this.buildValidationContext(),
        };
      }
    }

    return {
      workspaceDir: this.workspace.getWorkspaceDir(),
      directive,
      conversation: {
        summary,
        recentMessages,
      },
      persona,
    };
  }

  /**
   * Build validation-specific persona context for Client.
   * Contains persona name/description + skill names + constraints but NOT
   * the full execution persona block (avoids Client trying to direct execution).
   */
  private buildValidationContext(): string | undefined {
    if (!this.personaManager) return undefined;
    const activePersona = this.personaManager.getActivePersona();
    if (!activePersona) return undefined;

    const skills = this.personaManager.getActiveSkills();
    const skillLines = skills.map(s => {
      let line = `- ${s.metadata.name}: ${s.metadata.description}`;
      if (s.metadata.allowedTools && s.metadata.allowedTools.length > 0) {
        line += `\n  Allowed tools: ${s.metadata.allowedTools.join(', ')}`;
      }
      return line;
    }).join('\n');

    return `ACTIVE PERSONA: ${activePersona.manifest.name} — ${activePersona.manifest.description}

SKILLS AVAILABLE TO WORKER:
${skillLines || '(no skills registered)'}

VALIDATION GUIDANCE:
- Worker is expected to use skills above when relevant to the user's request.
- Validate that Worker's tool usage is consistent with the skills it was expected to apply.
- Validate that any mandatory steps or safety constraints defined above were followed.`;
  }

  /**
   * Determine corrective strategy for a subtask based on CompletionSignal.
   * Returns a description of the action taken, or null if no correction needed.
   */
  private applyCorrectionStrategy(
    signal: CompletionSignal,
    subtask: string,
    retryCount: number,
    maxRetries: number,
    subtasksToExecute: string[],
    results: { subtask: string; result: string }[]
  ): string | null {
    if (signal.confidence === 'high') return null;

    const strategy = signal.suggestedStrategy || 'retry';

    // Budget exhausted
    if (retryCount >= maxRetries) {
      if (signal.progressMade) {
        logger.info(`[DualAgent] Retry budget exhausted but progress was made — continuing to synthesis`);
        return null;
      }
      logger.warn(`[DualAgent] Retry budget exhausted with no progress — skipping subtask`);
      return null; // handled by caller
    }

    switch (strategy) {
      case 'retry':
        return subtask; // re-queue same instruction

      case 'rephrase':
        return `[CLARIFIED] ${subtask} — Please ensure the correct tools and approach are used. Avoid scope drift.`;

      case 'decompose':
        // Manager would ideally split this; we approximate by re-queuing with guidance
        return `[DECOMPOSE] Break this task into smaller concrete steps and execute them: ${subtask}`;

      case 'skip':
        logger.warn(`[DualAgent] Strategy=skip for subtask: ${subtask}`);
        return null; // caller skips

      case 'escalate':
        logger.warn(`[DualAgent] Escalating subtask to user — cannot auto-correct: ${subtask}`);
        results.push({
          subtask,
          result: `⚠️ This subtask could not be completed automatically and requires user attention: ${signal.blockerType || 'unknown blocker'}`,
        });
        return null;

      default:
        return subtask;
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

    // Build shared context ONCE per turn (single source of truth)
    const agentContext = this.buildAgentContext();

    const allToolsUsed: string[] = [];
    let totalIterations = 0;

    // PHASE 1: Manager creates plan
    logger.info('\n[PHASE 1: Planning]');
    logger.info('─────────────────────────────────────────');

    const phaseStartTime = Date.now();
    orchestrationLogger.logPhaseStart('PLANNING');

    const plan = await this.manager.createPlan({
      userRequest: userMessage,
      context: serializeAgentContext(agentContext, 'manager'),
    }, agentContext);

    orchestrationLogger.logPhaseEnd('PLANNING', Date.now() - phaseStartTime);

    // PHASE 2: Execute subtasks with per-subtask retry budget
    logger.info('\n[PHASE 2: Execution]');
    logger.info('─────────────────────────────────────────');

    const executionStartTime = Date.now();
    orchestrationLogger.logPhaseStart('EXECUTION');

    const results: { subtask: string; result: string }[] = [];
    const subtasksToExecute = plan.subtasks.slice(0, this.maxSubtasks);
    const MAX_RETRIES_PER_SUBTASK = 2;

    // Track per-subtask retry counts (keyed by original subtask text)
    const subtaskRetryCounts = new Map<string, number>();

    for (let i = 0; i < subtasksToExecute.length; i++) {
      const subtask = subtasksToExecute[i];

      logger.info(`\n[Subtask ${i + 1}/${subtasksToExecute.length}] ${subtask}`);

      // Worker executes subtask with shared context
      const workerResult = await this.worker.executeSubtask({
        instruction: subtask,
        context: serializeAgentContext(agentContext, 'worker'),
      }, agentContext);

      totalIterations += 1;
      allToolsUsed.push(...workerResult.toolsUsed);

      results.push({
        subtask,
        result: workerResult.result,
      });

      // Client validates Worker's result with shared context (adaptive involvement)
      const validation = await this.client.validate(
        userMessage,
        plan.subtasks,
        workerResult,
        undefined, // let Client determine involvement level
        agentContext
      );

      if (!validation.approved) {
        const signal = validation.completionSignal;
        const retryCount = subtaskRetryCounts.get(subtask) || 0;

        if (signal) {
          logger.info(`[DualAgent] CompletionSignal: confidence=${signal.confidence}, blocker=${signal.blockerType || 'none'}, strategy=${signal.suggestedStrategy || 'none'}, progress=${signal.progressMade}`);

          const correction = this.applyCorrectionStrategy(
            signal, subtask, retryCount, MAX_RETRIES_PER_SUBTASK, subtasksToExecute, results
          );

          if (correction) {
            // Deduplicate against the pending queue only — NOT against results.
            // Correction subtasks intentionally re-execute something that failed,
            // so checking results would always flag a retry as a duplicate.
            const normalizedCorrection = correction.toLowerCase().trim();
            const isDuplicate = subtasksToExecute.some(existing =>
              existing.toLowerCase().trim() === normalizedCorrection
            );

            if (isDuplicate) {
              logger.warn(`[DualAgent] Skipping duplicate correction subtask`);
            } else if (subtasksToExecute.length < this.maxSubtasks) {
              subtasksToExecute.push(correction);
              subtaskRetryCounts.set(subtask, retryCount + 1);
              logger.info(`[DualAgent] Added correction subtask via ${signal.suggestedStrategy} (${subtasksToExecute.length} total, retry ${retryCount + 1}/${MAX_RETRIES_PER_SUBTASK})`);
            } else {
              logger.warn(`[DualAgent] Cannot add correction — maxSubtasks (${this.maxSubtasks}) reached`);
            }
          } else if (!signal.progressMade && retryCount >= MAX_RETRIES_PER_SUBTASK) {
            logger.warn(`[DualAgent] No progress after ${MAX_RETRIES_PER_SUBTASK} retries — skipping subtask`);
          }
        } else if (validation.nextAction) {
          // Fallback to legacy correction if no signal present
          logger.info(`[Client] Validation failed: ${validation.issues.join(', ')}`);
          logger.info(`[Client] Requesting correction: ${validation.nextAction}`);

          const normalizedCorrection = validation.nextAction.toLowerCase().trim();
          // Only deduplicate against the pending queue — corrections are intentional
          // re-attempts, so matching against results would always skip them.
          const isDuplicate = subtasksToExecute.some(existing =>
            existing.toLowerCase().trim() === normalizedCorrection
          );

          if (isDuplicate) {
            logger.warn(`[Client] Skipping duplicate correction subtask`);
          } else if (subtasksToExecute.length < this.maxSubtasks) {
            subtasksToExecute.push(validation.nextAction);
            logger.info(`[Client] Added correction subtask (${subtasksToExecute.length} total)`);
          } else {
            logger.warn(`[Client] Cannot add correction - maxSubtasks (${this.maxSubtasks}) reached`);
          }
        }
      } else {
        logger.info(`[Client] Validation passed (${validation.involvementLevel} level)`);
      }
    }

    orchestrationLogger.logPhaseEnd('EXECUTION', Date.now() - executionStartTime);

    // PHASE 3: Synthesize final response
    logger.info('\n[PHASE 3: Synthesis]');
    logger.info('─────────────────────────────────────────');

    const synthesisStartTime = Date.now();
    orchestrationLogger.logPhaseStart('SYNTHESIS');

    const finalResponse = await this.synthesizeResponse(plan, results, agentContext);
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
    results: { subtask: string; result: string }[],
    agentContext?: AgentContext
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
        return await this.manager.synthesizeResponse(results, agentContext);
      }

      // Otherwise, short successful result can be returned directly
      return result;
    }

    // Multiple subtasks or long result - ask Manager to synthesize
    return await this.manager.synthesizeResponse(results, agentContext);
  }

  private getRecentContext(): string {
    // Include user + assistant + tool messages for full context
    const recent = this.userConversationHistory
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .slice(-6)
      .map(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${m.role.toUpperCase()}]: ${content}`;
      })
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
    this.client.resetSessionState();
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
