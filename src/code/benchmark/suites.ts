/**
 * Benchmark suite registry.
 *
 * Three tiers of suites with distinct purposes (see docs/guides/benchmark-suite.md):
 *  - taskstore (baseline)  — gating: does code mode work at all? Most usable configs ~100%.
 *  - microcrm  (capability)— scored: build a Node+SQLite REST API to spec; differentiates
 *                            models and configurations by pass-rate.
 *  - frontier  (future)    — scored: ~50 tests, even an optimal config only ~30-40%; full
 *                            pass needs a frontier model.
 */

import type { BenchmarkSuite } from './types.js';
import { BENCHMARK_TASKS } from './tasks.js';
import { MICROCRM_TASKS } from './microcrm/index.js';

export const BENCHMARK_SUITES: BenchmarkSuite[] = [
  {
    id: 'taskstore',
    name: 'Taskstore (baseline)',
    description:
      'TDD smoke/regression suite over an evolving in-memory library. Binary pass/fail, tasks ' +
      'build on one another. Confirms a model + config can do code mode at all.',
    level: 'baseline',
    scoring: 'gating',
    tasks: BENCHMARK_TASKS,
  },
  {
    id: 'microcrm',
    name: 'micro-CRM API (capability)',
    description:
      'Build a Node + SQLite REST API to a fixed spec, graded by the fraction of spec tests ' +
      'passed. Differentiates models and configurations; use it to find the optimal setup.',
    level: 'capability',
    scoring: 'scored',
    tasks: MICROCRM_TASKS,
  },
];

/** Default suite when none is specified (preserves prior `jiva benchmark` behaviour). */
export const DEFAULT_SUITE_ID = 'taskstore';

export function getSuite(id: string): BenchmarkSuite | undefined {
  return BENCHMARK_SUITES.find((s) => s.id === id);
}

export function listSuiteMetadata(): Array<Pick<BenchmarkSuite, 'id' | 'name' | 'description' | 'level' | 'scoring'> & { taskCount: number }> {
  return BENCHMARK_SUITES.map(({ id, name, description, level, scoring, tasks }) => ({
    id,
    name,
    description,
    level,
    scoring,
    taskCount: tasks.length,
  }));
}
