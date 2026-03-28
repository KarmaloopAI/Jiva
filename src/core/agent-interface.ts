/**
 * IAgent - Shared interface implemented by both DualAgent and CodeAgent.
 *
 * Placing this in src/core/ allows both the CLI and HTTP layers to import
 * it without creating circular dependencies.
 */

import type { WorkspaceManager } from './workspace.js';
import type { ConversationManager } from './conversation-manager.js';
import type { Message } from '../models/base.js';

export interface AgentChatResponse {
  content: string;
  toolsUsed: string[];
  iterations: number;
  /**
   * Present only in DualAgent responses (contains the plan produced by the manager).
   * Absent in CodeAgent responses.
   */
  plan?: {
    subtasks: string[];
    reasoning: string;
  };
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
}
