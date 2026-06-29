/**
 * The benchmark suite — 8 TDD-style coding tasks of increasing complexity over a
 * single evolving `taskstore` library. Tier 1 is a from-scratch one-liner; tier 8
 * is a long-horizon cross-module debug that stresses iteration count and output
 * length — the regime where rate-limited or short-output models fall down.
 */

import type { BenchmarkTask, TaskFile } from './types.js';
import { PACKAGE_JSON, scaffoldSrc } from './fixtures.js';
import { cumulativeTests, cumulativeTestPaths } from './tests.js';

const COMMON_RULES = `
Rules:
- The workspace is a Node ES-module project. Run the test suite with: node --test
- Make ALL tests pass. Do not stop until "node --test" reports zero failures.
- You MUST NOT modify, delete or move anything under the test/ directory.
- Keep existing passing tests green — only change source files under src/.`;

function buildScaffold(tier: number): TaskFile {
  return {
    'package.json': PACKAGE_JSON,
    ...scaffoldSrc(tier),
    ...cumulativeTests(tier),
  };
}

interface TaskSpec {
  id: string;
  tier: number;
  title: string;
  capability: string;
  kind: BenchmarkTask['kind'];
  instruction: string;
  maxIterations: number;
  timeoutMs: number;
}

const SPECS: TaskSpec[] = [
  {
    id: 't01-create',
    tier: 1,
    title: 'Create createTask from scratch',
    capability: 'Write a new file',
    kind: 'scratch',
    instruction:
      'Create src/index.js exporting a function `createTask(title)` that returns an object ' +
      '`{ title, done: false }` and throws an Error when the title is empty or only whitespace.',
    maxIterations: 15,
    timeoutMs: 120_000,
  },
  {
    id: 't02-extend-crud',
    tier: 2,
    title: 'Add addTask / removeTask / listTasks',
    capability: 'Read & extend an existing file',
    kind: 'extend',
    instruction:
      'src/index.js already has createTask. Add and export `addTask(list, title)` (returns a NEW ' +
      'list with an appended task that has a unique incrementing numeric `id` starting at 1, without ' +
      'mutating the input), `removeTask(list, id)` (returns a new list without that task), and ' +
      '`listTasks(list)` (returns all tasks).',
    maxIterations: 20,
    timeoutMs: 180_000,
  },
  {
    id: 't03-bugfix-toggle',
    tier: 3,
    title: 'Fix the toggleTask bug',
    capability: 'Diagnose & fix a targeted bug',
    kind: 'bugfix',
    instruction:
      'src/index.js contains a `toggleTask(list, id)` function that is supposed to flip the `done` ' +
      'flag of the task whose `id` matches, but the tests are failing. Find and fix the bug. ' +
      'Do not rewrite unrelated code.',
    maxIterations: 20,
    timeoutMs: 180_000,
  },
  {
    id: 't04-feature-priority',
    tier: 4,
    title: 'Add task priorities',
    capability: 'Multi-function feature',
    kind: 'extend',
    instruction:
      'Add priority support to src/index.js. New tasks must default to priority "normal". Export ' +
      '`setPriority(list, id, priority)` that updates the matching task (allowed values: "low", ' +
      '"normal", "high"; throw on anything else) and `tasksByPriority(list, priority)` that filters ' +
      'tasks by priority.',
    maxIterations: 25,
    timeoutMs: 240_000,
  },
  {
    id: 't05-refactor-split',
    tier: 5,
    title: 'Split into model / query modules',
    capability: 'Multi-file refactor without regressions',
    kind: 'refactor',
    instruction:
      'Refactor the single src/index.js into three files WITHOUT changing behaviour: ' +
      '`src/model.js` exporting the mutation functions (createTask, addTask, removeTask, toggleTask, ' +
      'setPriority), `src/query.js` exporting the read functions (listTasks, tasksByPriority), and ' +
      '`src/index.js` re-exporting everything from both so the existing public API is unchanged. ' +
      'All previously passing tests must remain green.',
    maxIterations: 30,
    timeoutMs: 300_000,
  },
  {
    id: 't06-algorithm-sort',
    tier: 6,
    title: 'Implement sortTasks with edge cases',
    capability: 'Algorithmic reasoning & edge cases',
    kind: 'extend',
    instruction:
      'Add and export `sortTasks(list, { by })` (currently only `by: "due"` is supported — throw on ' +
      'anything else). It returns a NEW array sorted by the `due` field (an ISO date string) ascending. ' +
      'Tasks whose `due` is null or undefined must sort to the end, and the sort must be stable for ' +
      'tasks with equal due dates. Put it in the appropriate module and re-export it from src/index.js.',
    maxIterations: 30,
    timeoutMs: 300_000,
  },
  {
    id: 't07-storage-roundtrip',
    tier: 7,
    title: 'Add JSON serialize / deserialize',
    capability: 'New module + serialization',
    kind: 'extend',
    instruction:
      'Create `src/storage.js` exporting `serialize(list)` (returns a JSON string) and ' +
      '`deserialize(str)` (parses it back into a task list, throwing if the parsed value is not an ' +
      'array). A serialize→deserialize round-trip must preserve every field of every task. Re-export ' +
      'both from src/index.js.',
    maxIterations: 30,
    timeoutMs: 300_000,
  },
  {
    id: 't08-debug-id-collision',
    tier: 8,
    title: 'Debug the id-collision integration bug',
    capability: 'Long-horizon cross-module debugging',
    kind: 'bugfix',
    instruction:
      'The integration tests in test/t08.test.mjs are failing: after a task is removed (or a list is ' +
      'restored from storage) and a new task is added, the new task can collide with an existing id. ' +
      'Run the tests, read the failure, find the root cause across the source modules, and fix it so ' +
      'ids are always unique. Do not weaken or change any test.',
    maxIterations: 40,
    timeoutMs: 420_000,
  },
];

export const BENCHMARK_TASKS: BenchmarkTask[] = SPECS.map((s) => ({
  id: s.id,
  tier: s.tier,
  title: s.title,
  capability: s.capability,
  kind: s.kind,
  prompt: `${s.instruction}\n${COMMON_RULES}`,
  scaffold: buildScaffold(s.tier),
  protectedPaths: cumulativeTestPaths(s.tier),
  maxIterations: s.maxIterations,
  timeoutMs: s.timeoutMs,
}));

/** Lightweight metadata for listing endpoints (no scaffold/test payloads). */
export function listTaskMetadata(
  tasks: BenchmarkTask[],
): Array<Pick<BenchmarkTask, 'id' | 'tier' | 'title' | 'capability' | 'kind'>> {
  return tasks.map(({ id, tier, title, capability, kind }) => ({ id, tier, title, capability, kind }));
}

/** Resolve which tasks to run from a suite's task list, given runner filters. */
export function selectTasks(tasks: BenchmarkTask[], opts: { maxTier?: number; taskIds?: string[] }): BenchmarkTask[] {
  if (opts.taskIds && opts.taskIds.length > 0) {
    const set = new Set(opts.taskIds);
    return tasks.filter((t) => set.has(t.id));
  }
  if (typeof opts.maxTier === 'number') {
    return tasks.filter((t) => t.tier <= opts.maxTier!);
  }
  return [...tasks];
}
