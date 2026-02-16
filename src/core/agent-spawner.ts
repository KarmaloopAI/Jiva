/**
 * Agent Spawner - Manages hierarchical sub-agent spawning with personas
 * 
 * Enables a parent agent to spawn child agents with specific personas,
 * creating a multi-agent collaboration system for complex tasks.
 * 
 * Example: An "engineering-manager" persona can spawn:
 * - "code-reviewer" agent to review code
 * - "developer" agent to implement features
 * - "tester" agent to write tests
 */

import { DualAgent, DualAgentConfig } from './dual-agent.js';
import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { WorkspaceManager } from './workspace.js';
import { ConversationManager } from './conversation-manager.js';
import { PersonaManager } from '../personas/persona-manager.js';
import { logger } from '../utils/logger.js';

export interface SpawnedAgent {
  id: string;
  persona: string;
  agent: DualAgent;
  parentId?: string;
  createdAt: Date;
  messageCount: number;
  status: 'active' | 'completed' | 'failed';
  result?: string;
}

export interface SpawnAgentRequest {
  persona: string;
  task: string;
  context?: string;
  maxIterations?: number;
}

export interface SpawnAgentResponse {
  agentId: string;
  persona: string;
  result: string;
  iterations: number;
  toolsUsed: string[];
}

export class AgentSpawner {
  private agents: Map<string, SpawnedAgent> = new Map();
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private workspace: WorkspaceManager;
  private conversationManager: ConversationManager | null;
  private basePersonaManager: PersonaManager;
  private parentAgentId?: string;
  private maxDepth: number;
  private currentDepth: number;

  constructor(
    orchestrator: ModelOrchestrator,
    mcpManager: MCPServerManager,
    workspace: WorkspaceManager,
    conversationManager: ConversationManager | null,
    basePersonaManager: PersonaManager,
    options?: {
      parentAgentId?: string;
      maxDepth?: number;
      currentDepth?: number;
    }
  ) {
    this.orchestrator = orchestrator;
    this.mcpManager = mcpManager;
    this.workspace = workspace;
    this.conversationManager = conversationManager;
    this.basePersonaManager = basePersonaManager;
    this.parentAgentId = options?.parentAgentId;
    this.maxDepth = options?.maxDepth || 1; // Default: only top-level can spawn
    this.currentDepth = options?.currentDepth || 0;
  }

  /**
   * Check if agent spawning is allowed at current depth
   */
  canSpawnMore(): boolean {
    return this.currentDepth < this.maxDepth;
  }

  /**
   * Get current depth level
   */
  getCurrentDepth(): number {
    return this.currentDepth;
  }

  /**
   * Get maximum depth
   */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Spawn a sub-agent with a specific persona
   */
  async spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse> {
    // Check depth limit
    if (this.currentDepth >= this.maxDepth) {
      throw new Error(
        `Maximum agent depth (${this.maxDepth}) reached. Cannot spawn more sub-agents.`
      );
    }

    // Ensure PersonaManager is initialized
    if (this.basePersonaManager.getPersonas().length === 0) {
      logger.info('[AgentSpawner] PersonaManager not initialized, initializing now...');
      await this.basePersonaManager.initialize();
    }

    // Validate persona exists
    const availablePersonas = this.basePersonaManager.getPersonas();
    if (availablePersonas.length === 0) {
      throw new Error(
        `No personas available. Please install personas in ~/.jiva/personas/ or activate one with 'jiva persona activate <name>'`
      );
    }
    
    const personaExists = availablePersonas.some((p: any) => p.manifest.name === request.persona);
    
    if (!personaExists) {
      throw new Error(
        `Persona '${request.persona}' not found. Available personas: ${availablePersonas.map((p: any) => p.manifest.name).join(', ')}`
      );
    }

    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`[AgentSpawner] Spawning sub-agent with persona: ${request.persona}`);
    logger.info(`[AgentSpawner] Task: ${request.task}`);
    logger.info(`[AgentSpawner] Depth: ${this.currentDepth + 1}/${this.maxDepth}`);

    try {
      // Create an ephemeral PersonaManager for the sub-agent
      // Ephemeral = true means it won't persist persona to global config
      const subPersonaManager = new PersonaManager([], true);
      await subPersonaManager.initialize();

      // Activate the requested persona (ephemeral, won't overwrite parent's persona)
      await subPersonaManager.activatePersona(request.persona);
      logger.success(`[AgentSpawner] Activated ephemeral persona: ${request.persona}`);

      // Merge persona MCP servers
      const personaMCPServers = subPersonaManager.getPersonaMCPServers();
      if (Object.keys(personaMCPServers).length > 0) {
        logger.info(`[AgentSpawner] Loading ${Object.keys(personaMCPServers).length} MCP servers from persona`);
        
        for (const [name, config] of Object.entries(personaMCPServers)) {
          try {
            await this.mcpManager.addServer(name, config as any);
          } catch (error) {
            // Server might already exist from parent, that's ok
            logger.debug(`[AgentSpawner] MCP server '${name}' already exists or failed to add`);
          }
        }
      }

      // Create sub-agent with persona and nested spawner
      const subSpawner = new AgentSpawner(
        this.orchestrator,
        this.mcpManager,
        this.workspace,
        this.conversationManager,
        this.basePersonaManager,
        {
          parentAgentId: agentId,
          maxDepth: this.maxDepth,
          currentDepth: this.currentDepth + 1,
        }
      );

      const subAgentConfig: DualAgentConfig = {
        orchestrator: this.orchestrator,
        mcpManager: this.mcpManager,
        workspace: this.workspace,
        conversationManager: this.conversationManager || undefined,
        personaManager: subPersonaManager,
        maxSubtasks: 20,
        maxIterations: request.maxIterations || 10,
        maxAgentDepth: this.maxDepth, // Inherit parent's max depth limit
        autoSave: false, // Sub-agents don't auto-save
      };

      const subAgent = new DualAgent(subAgentConfig);
      
      // Override with the nested spawner (which has currentDepth + 1)
      subAgent.setAgentSpawner(subSpawner);

      // Track the spawned agent
      const spawnedAgent: SpawnedAgent = {
        id: agentId,
        persona: request.persona,
        agent: subAgent,
        parentId: this.parentAgentId,
        createdAt: new Date(),
        messageCount: 0,
        status: 'active',
      };

      this.agents.set(agentId, spawnedAgent);

      // Prepare task message with context
      // IMPORTANT: Always include workspace path for sub-agents
      const workspacePath = this.workspace.getWorkspaceDir();
      let contextSection = `Project root: ${workspacePath}`;
      
      if (request.context) {
        contextSection += `\n${request.context}`;
      }
      
      const taskMessage = `CONTEXT:\n${contextSection}\n\nTASK:\n${request.task}`;

      // Save parent's persona context and set sub-agent's persona for logging
      const parentPersonaContext = logger.getPersonaContext();
      
      try {
        logger.setPersonaContext(request.persona);

        // Execute the task
        logger.info(`[AgentSpawner] Executing task with sub-agent...`);
        const response = await subAgent.chat(taskMessage);

        // Update agent status
        spawnedAgent.messageCount = 1;
        spawnedAgent.status = 'completed';
        spawnedAgent.result = response.content;

        logger.success(`[AgentSpawner] Sub-agent completed task (${response.iterations} iterations)`);

        return {
          agentId,
          persona: request.persona,
          result: response.content,
          iterations: response.iterations,
          toolsUsed: response.toolsUsed,
        };
      } finally {
        // Always restore parent's persona context
        logger.setPersonaContext(parentPersonaContext);
      }

    } catch (error) {
      logger.error(`[AgentSpawner] Sub-agent failed:`, error);
      
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = 'failed';
        agent.result = error instanceof Error ? error.message : String(error);
      }

      throw error;
    }
  }

  /**
   * Get information about a spawned agent
   */
  getAgent(agentId: string): SpawnedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all spawned agents
   */
  listAgents(): SpawnedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get available personas that can be spawned
   */
  getAvailablePersonas(): string[] {
    return this.basePersonaManager.getPersonas().map((p: any) => p.manifest.name);
  }

  /**
   * Cleanup all spawned agents
   */
  async cleanup(): Promise<void> {
    for (const [agentId, spawnedAgent] of this.agents.entries()) {
      try {
        await spawnedAgent.agent.cleanup();
      } catch (error) {
        logger.warn(`[AgentSpawner] Failed to cleanup agent ${agentId}:`, error);
      }
    }
    this.agents.clear();
  }
}
