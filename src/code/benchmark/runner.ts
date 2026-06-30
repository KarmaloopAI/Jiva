/**
 * Benchmark runner — drives CodeAgent through the suite in isolated workspaces
 * and collects deterministic pass/fail plus diagnostic metrics.
 *
 * Each task (default mode):
 *   1. mkdtemp an isolated workspace and write the scaffold (golden baseline +
 *      cumulative tests + any planted bug).
 *   2. Build a fresh minimal CodeAgent pointed at it.
 *   3. Run agent.chat(prompt) under a wall-clock timeout.
 *   4. Run the deterministic verifier (node --test + tamper check).
 *   5. Record metrics and tear everything down.
 *
 * In `continuous` mode the agent's own workspace is carried forward between
 * tiers: only the new test files (and planted source the agent hasn't written
 * yet) are overlaid, so cascading failures surface the way a real session would.
 */

import { mkdtemp, mkdir, writeFile, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import type { ModelOrchestrator } from '../../models/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { buildBenchmarkAgent } from './agent-factory.js';
import { runNodeTests } from './verify.js';
import type {
  BenchmarkTask,
  RunnerOptions,
  ProgressEvents,
  TaskResult,
  SuiteResult,
} from './types.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): Promise<void> {
  const abs = join(workspaceDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf-8');
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BenchmarkRunner {
  constructor(private orchestrator: ModelOrchestrator) {}

  /** Run a selected set of tasks. `tasks` must already be filtered/ordered by tier. */
  async run(
    tasks: BenchmarkTask[],
    options: RunnerOptions = {},
    progress: ProgressEvents = {},
  ): Promise<SuiteResult> {
    const startedAt = new Date().toISOString();
    const results: TaskResult[] = [];
    let carriedWorkspace: string | undefined;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      progress.onTaskStart?.(task, i, tasks.length);

      const maxIterations = options.maxIterations ?? task.maxIterations;
      const timeoutMs = options.timeoutMs ?? task.timeoutMs;

      // Resolve the workspace and write the scaffold.
      let workspaceDir: string;
      let ephemeral = false;
      if (options.continuous && carriedWorkspace) {
        workspaceDir = carriedWorkspace;
        // Overlay new tests always; overlay planted source only where absent.
        for (const [rel, content] of Object.entries(task.scaffold)) {
          const isTest = rel.startsWith('test/');
          const isPkg = rel === 'package.json';
          if (isTest || isPkg || !(await exists(join(workspaceDir, rel)))) {
            await writeWorkspaceFile(workspaceDir, rel, content);
          }
        }
      } else {
        workspaceDir = await mkdtemp(join(tmpdir(), `jiva-bench-${task.id}-`));
        ephemeral = !options.continuous;
        for (const [rel, content] of Object.entries(task.scaffold)) {
          await writeWorkspaceFile(workspaceDir, rel, content);
        }
        if (options.continuous) carriedWorkspace = workspaceDir;
      }

      // Snapshot the protected test files (from the task's own scaffold) for the tamper check.
      const protectedFiles: Record<string, string> = {};
      for (const p of task.protectedPaths) {
        protectedFiles[p] = task.scaffold[p] ?? '';
      }

      const result = await this.runTask(task, workspaceDir, maxIterations, timeoutMs, protectedFiles, !!options.lspEnabled);
      results.push(result);
      progress.onTaskDone?.(result, i, tasks.length);

      // Clean up ephemeral (non-continuous) workspaces unless asked to keep them.
      if (ephemeral && !options.keepWorkspaces) {
        await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    // Clean up the carried-forward workspace at the very end.
    if (options.continuous && carriedWorkspace && !options.keepWorkspaces) {
      await rm(carriedWorkspace, { recursive: true, force: true }).catch(() => {});
    }

    const finishedAt = new Date().toISOString();
    return this.aggregate(tasks, results, startedAt, finishedAt, options);
  }

  private async runTask(
    task: BenchmarkTask,
    workspaceDir: string,
    maxIterations: number,
    timeoutMs: number,
    protectedFiles: Record<string, string>,
    lspEnabled: boolean,
  ): Promise<TaskResult> {
    const agent = await buildBenchmarkAgent({
      orchestrator: this.orchestrator,
      workspaceDir,
      maxIterations,
      lspEnabled,
    });

    const base = {
      id: task.id,
      tier: task.tier,
      title: task.title,
      capability: task.capability,
      kind: task.kind,
    };

    const start = Date.now();
    let iterations = 0;
    let toolsUsed: string[] = [];
    let timedOut = false;
    let agentError: string | undefined;
    let truncationEvents = 0;

    try {
      const chatPromise = agent.chat(task.prompt);
      const raced = await Promise.race([
        chatPromise.then((r) => ({ kind: 'ok' as const, r })),
        delay(timeoutMs).then(() => ({ kind: 'timeout' as const })),
      ]);

      if (raced.kind === 'ok') {
        iterations = raced.r.iterations;
        toolsUsed = raced.r.toolsUsed;
        truncationEvents = raced.r.truncationEvents ?? 0;
      } else {
        timedOut = true;
        agent.stop();
        chatPromise.catch(() => {}); // swallow the late rejection/resolution
        iterations = maxIterations;
      }
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    }

    const wallTimeMs = Date.now() - start;
    let tokenUsage;
    try {
      tokenUsage = agent.getTokenUsage();
    } catch {
      tokenUsage = undefined;
    }

    // Verify regardless — the agent may have completed the files even on timeout.
    const verify = await runNodeTests(workspaceDir, protectedFiles, 60_000);
    await agent.cleanup().catch(() => {});

    const passed = verify.passed && !agentError;
    let reason: TaskResult['reason'];
    if (!passed) {
      if (agentError) reason = 'agent-error';
      else if (timedOut && !verify.passed) reason = 'timeout';
      else reason = verify.reason;
    }

    const outputLimited = !passed && truncationEvents > 0;
    const notes = [
      agentError ? `agent error: ${agentError}` : '',
      timedOut ? `timed out after ${timeoutMs}ms` : '',
      outputLimited ? `hit output-token limit ${truncationEvents}×` : '',
      verify.output ? `verifier: ${verify.output.split('\n').slice(-6).join(' ').slice(0, 300)}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      ...base,
      passed,
      reason,
      iterations,
      hitMaxIterations: iterations >= maxIterations,
      toolsUsed,
      tokenUsage,
      wallTimeMs,
      testsPassed: verify.testsPassed,
      testsFailed: verify.testsFailed,
      failingTests: verify.failingTests,
      truncationEvents,
      outputLimited,
      notes: notes || undefined,
    };
  }

  private aggregate(
    tasks: BenchmarkTask[],
    results: TaskResult[],
    startedAt: string,
    finishedAt: string,
    options: RunnerOptions,
  ): SuiteResult {
    const passed = results.filter((r) => r.passed).length;
    const highestTierPassed = results.filter((r) => r.passed).reduce((m, r) => Math.max(m, r.tier), 0);
    const totalWallTimeMs = results.reduce((s, r) => s + r.wallTimeMs, 0);
    const totalTokens = results.reduce((s, r) => s + (r.tokenUsage?.totalTokens ?? 0), 0);
    const totalTestsPassed = results.reduce((s, r) => s + r.testsPassed, 0);
    const totalTestsRun = results.reduce((s, r) => s + r.testsPassed + r.testsFailed, 0);
    const scorePct = totalTestsRun > 0 ? Math.round((totalTestsPassed / totalTestsRun) * 100) : 0;

    return {
      startedAt,
      finishedAt,
      suiteId: options.suiteId,
      suiteName: options.suiteName,
      scoring: options.scoring,
      model: options.model,
      totalTasks: tasks.length,
      passed,
      failed: results.length - passed,
      highestTierPassed,
      totalTestsPassed,
      totalTestsRun,
      scorePct,
      totalWallTimeMs,
      totalTokens: totalTokens || undefined,
      tasks: results,
    };
  }
}

/** Convenience entry point used by both the CLI command and the HTTP route. */
export async function runBenchmark(
  orchestrator: ModelOrchestrator,
  tasks: BenchmarkTask[],
  options: RunnerOptions = {},
  progress: ProgressEvents = {},
): Promise<SuiteResult> {
  if (tasks.length === 0) {
    logger.warn('[benchmark] no tasks selected');
  }
  return new BenchmarkRunner(orchestrator).run(tasks, options, progress);
}
