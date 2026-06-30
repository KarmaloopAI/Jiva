/**
 * Code-mode benchmark suite — public entry point.
 *
 * Drives CodeAgent through a TDD-style suite of increasing complexity in
 * isolated workspaces, scoring each task deterministically with Node's built-in
 * test runner. Invokable from the CLI (`jiva benchmark`) and the HTTP API
 * (`/api/benchmark/*`).
 */

export { BENCHMARK_TASKS, listTaskMetadata, selectTasks } from './tasks.js';
export { BENCHMARK_SUITES, DEFAULT_SUITE_ID, getSuite, listSuiteMetadata } from './suites.js';
export { runBenchmark, BenchmarkRunner } from './runner.js';
export { createOrchestrator } from './orchestrator-factory.js';
export type { OrchestratorInput, OrchestratorBundle, ModelConfigInput } from './orchestrator-factory.js';
export { formatReportForCLI, toReportJSON } from './report.js';
export type {
  BenchmarkTask,
  BenchmarkSuite,
  ScoringMode,
  TaskResult,
  SuiteResult,
  RunnerOptions,
  ProgressEvents,
  VerifyResult,
} from './types.js';
