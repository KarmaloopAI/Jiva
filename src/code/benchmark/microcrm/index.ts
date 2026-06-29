/**
 * The micro-CRM benchmark suite — a building, scored suite.
 *
 * Tier 1 (`crm-build`) builds the base Node + SQLite REST API from scratch (large single
 * output — a genuine test of whether the model can emit a sizeable file). Tiers 2-5 each
 * scaffold the WORKING base implementation and ask the agent to add one harder feature
 * (atomic bulk insert, advanced querying, weighted analytics, idempotency). Each task is
 * graded by its own hidden test file; the suite score is the fraction of all spec tests
 * passed.
 *
 * Test files and reference implementations live as plain `.mjs` assets (read verbatim at
 * runtime; copied into dist by scripts/copy-benchmark-assets.mjs).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { BenchmarkTask, TaskFile } from '../types.js';
import {
  MICROCRM_SPEC,
  MICROCRM_BULK_SPEC,
  MICROCRM_QUERY_SPEC,
  MICROCRM_STATS_SPEC,
  MICROCRM_IDEMPOTENCY_SPEC,
} from './spec.js';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const readAsset = (name: string): string => readFileSync(join(assetsDir, name), 'utf-8');

export const MICROCRM_PACKAGE_JSON = JSON.stringify({ name: 'microcrm', type: 'module', private: true }, null, 2) + '\n';
/** Base API the agent builds in tier 1 and that scaffolds the extend tasks. */
export const MICROCRM_BASE_APP = readAsset('app.reference.mjs');
/** Reference with every extension implemented — used only by the harness self-test. */
export const MICROCRM_FULL_APP = readAsset('app.full.reference.mjs');

/** A base-build task (from scratch) — no src provided. */
function buildTask(): BenchmarkTask {
  return {
    id: 'crm-build',
    tier: 1,
    title: 'Build the micro-CRM REST API',
    capability: 'Build a spec-defined Node + SQLite REST API (large output)',
    kind: 'scratch',
    prompt: MICROCRM_SPEC,
    scaffold: { 'package.json': MICROCRM_PACKAGE_JSON, 'test/api.test.mjs': readAsset('api.test.mjs') },
    protectedPaths: ['test/api.test.mjs'],
    maxIterations: 60,
    timeoutMs: 600_000,
  };
}

/** An extend task — scaffolds the working base app and adds one feature. */
function extendTask(
  id: string,
  tier: number,
  title: string,
  capability: string,
  prompt: string,
  testFile: string,
): BenchmarkTask {
  return {
    id,
    tier,
    title,
    capability,
    kind: 'extend',
    prompt,
    scaffold: {
      'package.json': MICROCRM_PACKAGE_JSON,
      'src/app.js': MICROCRM_BASE_APP,
      [`test/${testFile}`]: readAsset(testFile),
    },
    protectedPaths: [`test/${testFile}`],
    maxIterations: 40,
    timeoutMs: 360_000,
  };
}

export const MICROCRM_TASKS: BenchmarkTask[] = [
  buildTask(),
  extendTask('crm-bulk', 2, 'Atomic bulk deal insert', 'Transactions / atomicity', MICROCRM_BULK_SPEC, 'bulk.test.mjs'),
  extendTask('crm-query', 3, 'Advanced deal querying', 'Filtering, sorting & pagination', MICROCRM_QUERY_SPEC, 'query.test.mjs'),
  extendTask('crm-stats', 4, 'Pipeline analytics', 'Aggregation & weighted arithmetic', MICROCRM_STATS_SPEC, 'stats.test.mjs'),
  extendTask('crm-idempotency', 5, 'Idempotency-Key on create', 'Idempotency / dedup reasoning', MICROCRM_IDEMPOTENCY_SPEC, 'idempotency.test.mjs'),
];

/** Self-test helper: the known-good files that should pass a given task's tests. */
export function microcrmReferenceFor(task: BenchmarkTask): TaskFile {
  const src = task.id === 'crm-build' ? MICROCRM_BASE_APP : MICROCRM_FULL_APP;
  // Keep the task's test files, but override src/app.js with the reference implementation.
  return { ...task.scaffold, 'package.json': MICROCRM_PACKAGE_JSON, 'src/app.js': src };
}
