/**
 * Dual Agent System - Coordinates Manager and Worker agents
 *
 * Two-agent architecture:
 * - Manager: High-level planning, review, and synthesis
 * - Worker: Task execution with tools
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { ConversationManager } from './conversation-manager.js';
import { PersonaManager } from '../personas/persona-manager.js';
import { AgentSpawner } from './agent-spawner.js';
import { ManagerAgent } from './manager-agent.js';
import { WorkerAgent } from './worker-agent.js';
import { AgentContext } from './types/agent-context.js';
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
  /** @deprecated Use compactionThreshold + maxMessagesBeforeCondense instead. */
  condensingThreshold?: number;
  /**
   * Prompt-token count above which conversation compaction is triggered.
   * Defaults to 100_000 (≈80% of a typical 128K context window).
   */
  compactionThreshold?: number;
  /**
   * Message-count fallback: condense when this many messages accumulate even if
   * the API omits token data. Defaults to 60.
   */
  maxMessagesBeforeCondense?: number;
  maxToolCalls?: number; // Maximum tool calls per subtask
}

export interface DualAgentResponse {
  content: string;
  iterations: number;
  toolsUsed: string[];
  plan?: {
    subtasks: string[];
    reasoning: string;
  };
  tokenUsage?: import('../models/token-tracker.js').TokenUsageSnapshot;
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

  private maxSubtasks: number;
  private maxIterations: number;
  private maxAgentDepth: number;
  private autoSave: boolean;
  private condensingThreshold: number;
  private compactionThreshold: number;
  private maxMessagesBeforeCondense: number;

  private userConversationHistory: Message[] = [];
  private _stopped = false;

  constructor(config: DualAgentConfig) {
    this.orchestrator = config.orchestrator;
    this.mcpManager = config.mcpManager;
    this.workspace = config.workspace;
    this.conversationManager = config.conversationManager || null;
    this.personaManager = config.personaManager || null;

    this.maxSubtasks = config.maxSubtasks || 10;
    this.maxIterations = config.maxIterations || 20;
    this.maxAgentDepth = config.maxAgentDepth ?? 1; // Default: only Manager can spawn
    this.autoSave = config.autoSave !== false;
    this.condensingThreshold = config.condensingThreshold || 30; // kept for compat
    this.compactionThreshold = config.compactionThreshold ?? 100_000;
    this.maxMessagesBeforeCondense = config.maxMessagesBeforeCondense ?? 60;
    if (config.condensingThreshold !== undefined) {
      logger.warn('[DualAgent] condensingThreshold is deprecated — use compactionThreshold + maxMessagesBeforeCondense instead');
    }

    // Initialize agents (Manager + Worker architecture)
    this.manager = new ManagerAgent(this.orchestrator, this.workspace, this.personaManager || undefined);
    this.worker = new WorkerAgent(this.orchestrator, this.mcpManager, this.workspace, this.maxIterations, this.personaManager || undefined);

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

    logger.info('[*] Two-agent system initialized (Manager + Worker)');
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
   * Process user message using dual-agent architecture
   */
  /** Signal the agent to stop after the current subtask completes. */
  stop(): void {
    this._stopped = true;
  }

  async chat(userMessage: string): Promise<DualAgentResponse> {
    this._stopped = false; // reset for new turn
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`>> User: ${userMessage}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    orchestrationLogger.logUserMessage(userMessage);

    // Check if conversation needs condensing BEFORE adding new message.
    // Token-based trigger: compacts when the last prompt was close to the context limit.
    // Message-count fallback: triggers when API omits usage data.
    if (this.conversationManager) {
      const snapshot = this.orchestrator.getTokenUsage();
      const byTokens = snapshot.lastPromptTokens > 0 &&
                       snapshot.lastPromptTokens > this.compactionThreshold;
      const byMessages = this.userConversationHistory.length > this.maxMessagesBeforeCondense;

      if (byTokens || byMessages) {
        const reason = byTokens
          ? `${snapshot.lastPromptTokens.toLocaleString()} prompt tokens > ${this.compactionThreshold.toLocaleString()} threshold`
          : `${this.userConversationHistory.length} messages > ${this.maxMessagesBeforeCondense} threshold`;
        logger.info(`[DualAgent] Condensing — ${reason}`);
        this.userConversationHistory = await this.conversationManager.condenseConversation(
          this.userConversationHistory,
          this.orchestrator,
          Math.floor(this.maxMessagesBeforeCondense * 0.7),
          {
            directive: this.workspace.getDirectivePrompt() || undefined,
            currentGoal: userMessage,
          }
        );
      }
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

    // Conversational short-circuit: skip execution entirely for greetings, thank-yous, etc.
    if (plan.conversational) {
      logger.info('[DualAgent] Conversational message — returning direct reply');
      const directReply = await this.manager.directReply(
        this.userConversationHistory,
        agentContext,
      );
      this.userConversationHistory.push({ role: 'assistant', content: directReply });

      if (this.autoSave && this.conversationManager) {
        const tokenSnap = this.orchestrator.getTokenUsage();
        await this.conversationManager.autoSave(
          this.userConversationHistory,
          this.workspace.getWorkspaceDir(),
          this.orchestrator,
          'chat',
          tokenSnap,
        );
      }

      logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('[+] Complete: 1 iteration, 0 tools used (conversational)');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        content: directReply,
        iterations: 1,
        toolsUsed: [],
        plan: { subtasks: [], reasoning: plan.reasoning },
        tokenUsage: this.orchestrator.getTokenUsage(),
      };
    }

    // PHASE 2: Execute subtasks with per-subtask retry budget
    logger.info('\n[PHASE 2: Execution]');
    logger.info('─────────────────────────────────────────');

    const executionStartTime = Date.now();
    orchestrationLogger.logPhaseStart('EXECUTION');

    const results: { subtask: string; result: string; accepted: boolean }[] = [];
    const subtasksToExecute = plan.subtasks.slice(0, this.maxSubtasks);
    // Max 1 retry per original subtask — keyed by original subtask text (not correction text)
    const MAX_RETRIES_PER_SUBTASK = 1;
    const subtaskRetryCounts = new Map<string, number>();

    for (let i = 0; i < subtasksToExecute.length; i++) {
      // Cooperative stop: set by stop() (Ctrl+C or HTTP stop endpoint)
      if (this._stopped) {
        logger.info('[DualAgent] Stop requested — halting subtask execution');
        break;
      }

      const subtask = subtasksToExecute[i];

      logger.info(`\n[Subtask ${i + 1}/${subtasksToExecute.length}] ${subtask}`);

      // Worker executes subtask with shared context
      const workerResult = await this.worker.executeSubtask({
        instruction: subtask,
        context: serializeAgentContext(agentContext, 'worker'),
      }, agentContext);

      totalIterations += 1;
      allToolsUsed.push(...workerResult.toolsUsed);

      // Manager reviews Worker's result — fast-path for common cases, LLM only for edge cases
      const review = await this.manager.reviewSubtaskResult(subtask, workerResult, userMessage);

      results.push({
        subtask,
        result: workerResult.result,
        accepted: review.accepted,
      });

      if (!review.accepted && review.specificCorrection) {
        // Determine the original subtask key for retry counting.
        // Correction subtasks always start fresh — map them back to the original via
        // their position in the queue vs the original plan length.
        const originalSubtask = plan.subtasks[Math.min(i, plan.subtasks.length - 1)] || subtask;
        const retryCount = subtaskRetryCounts.get(originalSubtask) || 0;

        if (retryCount < MAX_RETRIES_PER_SUBTASK && subtasksToExecute.length < this.maxSubtasks) {
          subtasksToExecute.splice(i + 1, 0, review.specificCorrection);
          subtaskRetryCounts.set(originalSubtask, retryCount + 1);
          logger.info(`[DualAgent] Inserted targeted retry at position ${i + 2} (retry ${retryCount + 1}/${MAX_RETRIES_PER_SUBTASK})`);
        } else {
          logger.warn(`[DualAgent] Retry budget exhausted or queue full — accepting partial result`);
        }
      } else {
        logger.info(`[Manager] Subtask accepted`);
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
      const tokenSnap = this.orchestrator.getTokenUsage();
      await this.conversationManager.autoSave(
        this.userConversationHistory,
        this.workspace.getWorkspaceDir(),
        this.orchestrator,
        'chat',
        tokenSnap,
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
      tokenUsage: this.orchestrator.getTokenUsage(),
    };
  }

  private async synthesizeResponse(
    plan: { subtasks: string[]; reasoning: string },
    results: { subtask: string; result: string; accepted: boolean }[],
    agentContext?: AgentContext
  ): Promise<string> {
    // Always have the Manager synthesize a final response.
    //
    // The previous short-circuit (returning Worker's raw result when it was a
    // single short subtask) caused the user to see Worker-internal operational
    // strings like "Task work completed (1 operations performed). Max iterations
    // reached but all tool operations succeeded." as their final answer.  The
    // Manager synthesis step is cheap (one LLM call) and guarantees the user
    // always receives a properly formatted, contextually accurate response.
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
    // Null out the conversation ID so the next autoSave generates a fresh file
    // rather than continuing to append to the previous conversation's storage entry.
    this.conversationManager?.setCurrentConversationId(null);
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

  getTokenUsage() {
    return this.orchestrator.getTokenUsage();
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
      this.orchestrator,
      'chat'
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

    return await this.conversationManager.listConversations('chat');
  }
}
