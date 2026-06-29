/**
 * Benchmark types — shared by the runner, the CLI command and the HTTP routes.
 *
 * The benchmark measures how well a given model + config performs in code mode
 * across a TDD-style suite of increasing complexity. Each task scaffolds an
 * isolated workspace containing failing tests; the agent must make them pass
 * without editing the protected test files. Scoring is deterministic — it is the
 * exit status of Node's built-in test runner, not an LLM judgement.
 */

import type { TokenUsageSnapshot } from '../../models/token-tracker.js';

/** A map of workspace-relative path → file content, written before the agent runs. */
export type TaskFile = Record<string, string>;

/**
 * A single benchmark task. Tasks are ordered by `tier` (1 = easiest) and build
 * on one another: the scaffold for tier N is the canonical solution of tiers
 * 1..N-1 plus the new failing test(s) for tier N.
 */
export interface BenchmarkTask {
  /** Stable identifier, e.g. "t03-bugfix-toggle". */
  id: string;
  /** Complexity tier, 1 (trivial) .. 8 (long-horizon debug). */
  tier: number;
  /** Short human title. */
  title: string;
  /** The capability this tier primarily exercises (shown in reports). */
  capability: string;
  /** Whether the task builds from scratch or improves/fixes existing code. */
  kind: 'scratch' | 'extend' | 'bugfix' | 'refactor';
  /** The instruction handed to the agent. */
  prompt: string;
  /** Files written into the workspace before the agent runs (the scaffold). */
  scaffold: TaskFile;
  /**
   * Workspace-relative paths the agent must NOT modify (the tests). If any of
   * these differ after the run, the task fails with reason `tests-modified`.
   */
  protectedPaths: string[];
  /** Per-task iteration cap (overridable globally). */
  maxIterations: number;
  /** Per-task wall-clock timeout in ms (overridable globally). */
  timeoutMs: number;
}

/**
 * Scoring mode for a suite:
 *  - 'gating' : binary pass/fail per task; tasks build on one another (the baseline
 *    taskstore suite). Measures "does code mode work at all".
 *  - 'scored' : graded by the FRACTION of spec tests passed (the capability/frontier
 *    suites). The headline metric is the pass-rate, not all-or-nothing.
 */
export type ScoringMode = 'gating' | 'scored';

/** A named collection of tasks with a shared purpose and scoring philosophy. */
export interface BenchmarkSuite {
  id: string;
  name: string;
  description: string;
  /** Difficulty/intent tier of the whole suite. */
  level: 'baseline' | 'capability' | 'frontier';
  scoring: ScoringMode;
  tasks: BenchmarkTask[];
}

/** Outcome of running the deterministic verifier against a workspace. */
export interface VerifyResult {
  passed: boolean;
  /** Number of passing / failing test cases parsed from the runner output. */
  testsPassed: number;
  testsFailed: number;
  /** Names of failing test cases (parsed from `not ok` lines) — drives scored reports. */
  failingTests: string[];
  /** Categorised failure reason when !passed. */
  reason?: 'tests-failed' | 'tests-modified' | 'runner-error' | 'timeout';
  /** Trimmed runner output (stdout+stderr), useful for diagnosis. */
  output: string;
}

/** Per-task result with diagnostic metrics. */
export interface TaskResult {
  id: string;
  tier: number;
  title: string;
  capability: string;
  kind: BenchmarkTask['kind'];
  passed: boolean;
  /** Categorised reason when !passed (mirrors VerifyResult.reason or 'agent-error'). */
  reason?: VerifyResult['reason'] | 'agent-error';
  /** Agent loop iterations consumed. */
  iterations: number;
  /** True when the agent hit its iteration cap (a strong "struggling" signal). */
  hitMaxIterations: boolean;
  /** Tool names the agent invoked. */
  toolsUsed: string[];
  /** Token usage accumulated by the agent during this task. */
  tokenUsage?: TokenUsageSnapshot;
  /** Wall-clock duration of the agent turn (not counting verification). */
  wallTimeMs: number;
  testsPassed: number;
  testsFailed: number;
  /** Names of failing test cases (for scored suites, this is the per-capability gap list). */
  failingTests?: string[];
  /** Times the model hit its output-token limit mid tool-call (write/edit cut off). */
  truncationEvents?: number;
  /** True when this task failed AND hit output-token limits — an output-length limitation. */
  outputLimited?: boolean;
  /** Free-form diagnostic notes (errors, truncation hints, verifier output head). */
  notes?: string;
}

/** Aggregate result for a full suite run. */
export interface SuiteResult {
  startedAt: string;
  finishedAt: string;
  /** Suite identity and scoring mode (drives report rendering). */
  suiteId?: string;
  suiteName?: string;
  scoring?: ScoringMode;
  /** Model label, when resolvable from the orchestrator config. */
  model?: string;
  totalTasks: number;
  passed: number;
  failed: number;
  /** Highest tier reached with a pass (a single capability ceiling number). */
  highestTierPassed: number;
  /** Aggregate spec-test counts across the suite (the headline for scored suites). */
  totalTestsPassed: number;
  totalTestsRun: number;
  /** Percentage of spec tests passed (0–100). */
  scorePct: number;
  totalWallTimeMs: number;
  totalTokens?: number;
  tasks: TaskResult[];
}

/** Options controlling a suite run. */
export interface RunnerOptions {
  /** Run only tiers 1..maxTier. */
  maxTier?: number;
  /** Run only these task ids (overrides maxTier). */
  taskIds?: string[];
  /** Global override for each task's iteration cap. */
  maxIterations?: number;
  /** Global override for each task's timeout. */
  timeoutMs?: number;
  /** Enable LSP during the run (default: off, to reduce variance). */
  lspEnabled?: boolean;
  /**
   * Carry the agent's own resulting workspace forward to the next tier instead
   * of scaffolding from the canonical golden baseline. Surfaces cascading
   * failures the way a real session would.
   */
  continuous?: boolean;
  /** Keep temp workspaces on disk for debugging. */
  keepWorkspaces?: boolean;
  /** Model label for reporting. */
  model?: string;
  /** Suite identity + scoring, embedded into the result for reporting. */
  suiteId?: string;
  suiteName?: string;
  scoring?: ScoringMode;
}

/** Progress callback fired around each task (enables CLI lines and SSE). */
export interface ProgressEvents {
  onTaskStart?: (task: BenchmarkTask, index: number, total: number) => void;
  onTaskDone?: (result: TaskResult, index: number, total: number) => void;
}
