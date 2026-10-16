/**
 * Tool scheduler — runs the tool calls from one model turn concurrently where
 * it is safe to, and serially where it is not.
 *
 * Every agent loop (CodeAgent, WorkerAgent, EvaluatorAgent) uses this, so the
 * concurrency rules live in one place.
 *
 * Model: each call declares what it touches (`ToolAccess`):
 *   - `{ exclusive: true }`             — run alone (unknown side effects: bash,
 *                                         sub-agents, mutating MCP tools)
 *   - `{ reads: [...], writes: [...] }` — resource keys (normally absolute file
 *                                         paths; '*' = the whole workspace)
 *
 * Calls are partitioned IN ORDER into groups: a group keeps growing while the
 * next call does not conflict with anything already in it (write/write or
 * read/write on the same key, '*' overlapping everything). An exclusive call
 * always forms its own group. Groups run one after another; calls inside a
 * group run concurrently (bounded by `maxConcurrency`). Nothing is ever
 * reordered across a conflict, so `[edit a, read a]` still reads the edited file.
 *
 * Results are returned in CALL order regardless of completion order — callers
 * push tool messages in that order, which is what providers and
 * `ensureToolResultPairing` expect.
 *
 * Mirrors Claude Code's partitionToolCalls (consecutive concurrency-safe calls
 * batch together) refined with per-path keys so edits to different files can
 * also overlap; the per-file `fileLock` remains the backstop for same-file writes.
 */

export type ToolAccess = { exclusive: true } | { reads: string[]; writes: string[] };

export const EXCLUSIVE: ToolAccess = { exclusive: true };
/** Read-only access to the whole workspace (search tools, read-only commands). */
export const READS_ALL: ToolAccess = { reads: ['*'], writes: [] };

/** Map MCP tool annotations to an access: readOnlyHint ⇒ reads-all, anything else ⇒ exclusive. */
export function accessFromAnnotations(annotations: { readOnlyHint?: boolean } | undefined): ToolAccess {
  return annotations?.readOnlyHint === true ? READS_ALL : EXCLUSIVE;
}

export const readsPath = (p: string): ToolAccess => ({ reads: [p], writes: [] });
export const writesPath = (p: string): ToolAccess => ({ reads: [], writes: [p] });

export interface ScheduledCall<R> {
  /** Position in the model's tool-call list. */
  index: number;
  id: string;
  name: string;
  access: ToolAccess;
  run(signal: AbortSignal): Promise<R>;
}

export interface CallOutcome<R> {
  call: ScheduledCall<R>;
  /** Set when run() resolved. */
  result?: R;
  /** Set when run() threw (or the batch was aborted before it started). */
  error?: unknown;
  /** True when the call never ran because the batch signal was aborted first. */
  skipped?: boolean;
  durationMs: number;
}

export interface BatchStats {
  /** Number of groups executed (1 = everything ran in one parallel group). */
  groups: number;
  /** Largest number of calls that ran in one group. */
  maxGroupSize: number;
  /** Wall-clock time for the whole batch. */
  wallMs: number;
  /** Sum of individual call durations (what a serial run would have cost). */
  serialMs: number;
}

export interface RunBatchOptions {
  /** Upper bound on concurrently running calls. 1 = fully sequential. Default 8. */
  maxConcurrency?: number;
  /** When false, every call runs alone, in order (pre-scheduler behaviour). */
  parallel?: boolean;
  /** Turn-level abort; calls not yet started are skipped once it fires. */
  signal?: AbortSignal;
}

export interface BatchResult<R> {
  outcomes: CallOutcome<R>[];
  stats: BatchStats;
}

export const DEFAULT_MAX_TOOL_CONCURRENCY = 8;

function isExclusive(a: ToolAccess): a is { exclusive: true } {
  return (a as { exclusive?: boolean }).exclusive === true;
}

function keysOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.includes('*') || b.includes('*')) return true;
  return a.some((k) => b.includes(k));
}

/** True when two non-exclusive accesses must not run concurrently. */
export function conflicts(a: ToolAccess, b: ToolAccess): boolean {
  if (isExclusive(a) || isExclusive(b)) return true;
  return (
    keysOverlap(a.writes, b.writes) ||
    keysOverlap(a.writes, b.reads) ||
    keysOverlap(a.reads, b.writes)
  );
}

/**
 * Partition calls (in order) into groups that may each run concurrently.
 * Exported for tests and for logging/diagnostics.
 */
export function partitionCalls<T extends { access: ToolAccess }>(calls: readonly T[], parallel = true): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const call of calls) {
    const canJoin =
      parallel &&
      current.length > 0 &&
      !isExclusive(call.access) &&
      current.every((c) => !conflicts(c.access, call.access));
    if (canJoin) {
      current.push(call);
    } else {
      if (current.length > 0) groups.push(current);
      current = [call];
    }
    // An exclusive call never shares its group.
    if (isExclusive(call.access)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Run `tasks` with at most `limit` in flight; results keep task order. */
async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Execute one model turn's tool calls. Never throws for a failing call — each
 * failure is reported on its own outcome so siblings are unaffected.
 */
export async function runToolBatch<R>(
  calls: readonly ScheduledCall<R>[],
  options: RunBatchOptions = {},
): Promise<BatchResult<R>> {
  const parallel = options.parallel ?? true;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_TOOL_CONCURRENCY);
  const signal = options.signal ?? new AbortController().signal;

  const groups = partitionCalls(calls, parallel && maxConcurrency > 1);
  const outcomeByIndex = new Map<ScheduledCall<R>, CallOutcome<R>>();
  const batchStart = Date.now();
  let serialMs = 0;

  for (const group of groups) {
    const tasks = group.map((call) => async (): Promise<void> => {
      if (signal.aborted) {
        outcomeByIndex.set(call, { call, skipped: true, error: new Error('Aborted'), durationMs: 0 });
        return;
      }
      const start = Date.now();
      try {
        const result = await call.run(signal);
        outcomeByIndex.set(call, { call, result, durationMs: Date.now() - start });
      } catch (error) {
        outcomeByIndex.set(call, { call, error, durationMs: Date.now() - start });
      }
    });
    await runLimited(tasks, maxConcurrency);
  }

  const outcomes = calls.map((call) => outcomeByIndex.get(call)!);
  for (const o of outcomes) serialMs += o.durationMs;

  return {
    outcomes,
    stats: {
      groups: groups.length,
      maxGroupSize: groups.reduce((m, g) => Math.max(m, g.length), 0),
      wallMs: Date.now() - batchStart,
      serialMs,
    },
  };
}

export interface ToolExecutionSettingsInput {
  parallel?: boolean;
  maxConcurrency?: number;
  /**
   * Already-final settings (e.g. a per-session HTTP override that must beat
   * the env vars): returned as-is, env is not consulted.
   */
  resolved?: boolean;
}

/**
 * Resolve tool-execution settings. Precedence: `resolved` input > env
 * (JIVA_PARALLEL_TOOLS / JIVA_MAX_TOOL_CONCURRENCY) > config > defaults.
 */
export function resolveToolExecutionSettings(cfg?: ToolExecutionSettingsInput): {
  parallel: boolean;
  maxConcurrency: number;
} {
  if (cfg?.resolved) {
    return {
      parallel: cfg.parallel ?? true,
      maxConcurrency: Math.max(1, cfg.maxConcurrency ?? DEFAULT_MAX_TOOL_CONCURRENCY),
    };
  }
  const envParallel = process.env.JIVA_PARALLEL_TOOLS;
  const envMax = Number(process.env.JIVA_MAX_TOOL_CONCURRENCY);
  const parallel =
    envParallel !== undefined
      ? !['0', 'false', 'no', 'off'].includes(envParallel.trim().toLowerCase())
      : cfg?.parallel ?? true;
  const maxConcurrency =
    Number.isFinite(envMax) && envMax >= 1
      ? Math.floor(envMax)
      : cfg?.maxConcurrency ?? DEFAULT_MAX_TOOL_CONCURRENCY;
  return { parallel, maxConcurrency };
}
