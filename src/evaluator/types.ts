/**
 * Evaluator Harness — type definitions.
 *
 * The Evaluator is an autonomous supervisor agent that validates whether the
 * main Jiva agent has completed its assigned work and nudges it toward completion
 * when gaps are found.
 */

import type { ModelOrchestrator } from '../models/orchestrator.js';
import type { MCPServerManager } from '../mcp/server-manager.js';
import type { WorkspaceManager } from '../core/workspace.js';
import type { IAgent } from '../core/agent-interface.js';
import type { TokenUsageSnapshot } from '../models/token-tracker.js';

// ─── Evaluator Agent ─────────────────────────────────────────────────────────

export interface EvaluatorConfig {
  /** Fresh, isolated orchestrator — same model config as main agent but own LLM state. */
  orchestrator: ModelOrchestrator;
  /** Fresh MCPServerManager — same servers as main agent, independent connections. */
  mcpManager: MCPServerManager;
  /** Shared workspace reference — evaluator reads the same files as the main agent. */
  workspace: WorkspaceManager;
  /** The Jiva agent being supervised. */
  targetAgent: IAgent;
  /**
   * Maximum number of "evaluate → nudge → re-check" cycles before giving up.
   * Each cycle is one full EvaluatorAgent agentic loop.
   * Default: 5.
   */
  maxEvaluationCycles?: number;
  /**
   * Maximum model iterations per evaluation cycle (mirrors CodeAgent.maxIterations).
   * Default: 30.
   */
  maxIterationsPerCycle?: number;
}

export interface EvaluationContext {
  /** The original goal / task description that the main agent was asked to accomplish. */
  userMessage: string;
  /** If provided, load this conversation into the target agent before evaluating. */
  targetConversationId?: string;
}

export interface EvaluationResult {
  /** True when the evaluator is satisfied that all tasks in the directive are complete. */
  passed: boolean;
  /** Specific items the evaluator found to be incomplete or incorrect. */
  gaps: string[];
  /** Number of messages the evaluator sent to the main agent to guide completion. */
  nudgesSent: number;
  /** Number of evaluation cycles that ran. */
  cyclesRan: number;
  /** File paths / content snippets the evaluator inspected as evidence. */
  evidence: string[];
  /** Human-readable final assessment (1-3 sentences). */
  summary: string;
}

// ─── Tool context ─────────────────────────────────────────────────────────────

export interface EvaluatorToolContext {
  workspaceDir: string;
  /** The supervised agent — used by interact_with_agent and list_conversations tools. */
  targetAgent: IAgent;
  /** Called each time interact_with_agent sends a message — increments nudgesSent. */
  onNudgeSent: () => void;
  /** Accumulate file paths read/checked during evaluation. */
  onEvidenceFound: (path: string) => void;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

export interface HarnessOptions {
  /**
   * Whether to log evaluator progress to the console.
   * Default: true.
   */
  verbose?: boolean;
}

export interface HarnessResult {
  /** Final response text from the main agent (from its last chat() call). */
  mainAgentResponse: string;
  /** Total LLM iterations the main agent used across all its chat() calls. */
  mainAgentIterations: number;
  /** Evaluation outcome after the evaluator ran. */
  evaluation: EvaluationResult;
  /** Token usage accumulated by the main agent's orchestrator during this harness run. */
  mainAgentTokenUsage?: TokenUsageSnapshot;
  /** Token usage accumulated by the evaluator's isolated orchestrator. */
  evaluatorTokenUsage?: TokenUsageSnapshot;
}
