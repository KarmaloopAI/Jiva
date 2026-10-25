/**
 * IAgent - Shared interface implemented by both DualAgent and CodeAgent.
 *
 * Placing this in src/core/ allows both the CLI and HTTP layers to import
 * it without creating circular dependencies.
 */

import type { WorkspaceManager } from './workspace.js';
import type { ConversationManager } from './conversation-manager.js';
import type { Message } from '../models/base.js';
import type { TokenUsageSnapshot, TurnUsage } from '../models/token-tracker.js';
import type { ToolCallRecord } from './worker-agent.js';

export interface AgentChatResponse {
  content: string;
  toolsUsed: string[];
  /**
   * Parallel to `toolsUsed`: each tool call's name AND arguments.
   * Present only for DualAgent (Chat-mode) responses; `undefined` for CodeAgent
   * (code-mode) sessions, so it is omitted from JSON in that case.
   */
  toolCalls?: ToolCallRecord[];
  iterations: number;
  /**
   * Present only in DualAgent responses (contains the plan produced by the manager).
   * Absent in CodeAgent responses.
   */
  plan?: {
    subtasks: string[];
    reasoning: string;
  };
  /** Lifetime token usage of the agent's orchestrator (all turns so far — NOT this turn). */
  tokenUsage?: TokenUsageSnapshot;
  /** Usage of THIS turn only: tokens (incl. cached/reasoning), cost and the cost's source. */
  turnUsage?: TurnUsage;
  /** Estimated tokens of the context carried into the next turn (excludes tool calls/results). */
  contextTokens?: number;
  /**
   * How the turn ended. Code mode sets 'max-iterations' when the step limit was hit
   * before finishing, so the CLI can offer the user the option to continue.
   */
  stopReason?: 'completed' | 'max-iterations' | 'stopped';
}

export interface IAgent {
  chat(message: string): Promise<AgentChatResponse>;
  /**
   * Cooperatively stop a running chat() call.
   * The agent finishes its current model call / tool execution then exits the loop,
   * returning a partial result with a "[Task stopped by user]" message.
   * Safe to call from a SIGINT handler or an HTTP stop endpoint.
   */
  stop(): void;
  cleanup(): Promise<void>;
  getWorkspace(): WorkspaceManager;
  getMCPManager(): {
    getServerStatus(): Array<{ name: string; connected: boolean; enabled: boolean; toolCount: number }>;
    getClient(): { getAllTools(): Array<{ name: string; description: string }> };
  };
  resetConversation(): void;
  getConversationHistory(): Message[];
  getConversationManager(): ConversationManager | null | undefined;
  saveConversation(): Promise<string | null>;
  loadConversation(id: string): Promise<void>;
  listConversations(): Promise<Array<{
    id: string;
    title?: string;
    updated: string | number;
    messageCount: number;
    workspace?: string;
    type?: string;
  }>>;
  /** Return a snapshot of token usage accumulated by this agent's orchestrator. */
  getTokenUsage(): TokenUsageSnapshot;
  /** Estimated size of the context carried into the next turn (system prompt + user/assistant history). */
  getContextSize(): { tokens: number; messages: number };
  /** Compact the carried conversation now (summary + recent exchanges). */
  compact(opts?: { keepMessages?: number }): Promise<CompactionResult>;
}

/** Outcome of a manual compaction — estimated context sizes before/after. */
export interface CompactionResult {
  beforeTokens: number;
  afterTokens: number;
  beforeMessages: number;
  afterMessages: number;
  /** Cost/tokens of the summarisation call. */
  usage?: TurnUsage;
}
