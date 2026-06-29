/**
 * Self-test for the benchmark harness — validates the fixtures and verifier
 * without any LLM. For each tier it asserts:
 *   1. The canonical golden solution PASSES the tier's tests.
 *   2. The scaffolded starting state (missing function / planted bug) FAILS.
 *   3. Tampering with a test file is detected (tests-modified).
 *
 * Run after `npm run build`:  node scripts/bench-selftest.mjs
 */

import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

const { goldenSrcAfter, scaffoldSrc, PACKAGE_JSON } = await import('../dist/code/benchmark/fixtures.js');
const { cumulativeTests, cumulativeTestPaths } = await import('../dist/code/benchmark/tests.js');
const { runNodeTests } = await import('../dist/code/benchmark/verify.js');
const { MICROCRM_TASKS, microcrmReferenceFor } = await import('../dist/code/benchmark/microcrm/index.js');

async function writeAll(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
}

function protectedMap(tier) {
  const tests = cumulativeTests(tier);
  const map = {};
  for (const p of cumulativeTestPaths(tier)) map[p] = tests[p];
  return map;
}

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

for (let tier = 1; tier <= 8; tier++) {
  console.log(`\nTier ${tier}`);

  // 1. Golden solution passes.
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-golden-${tier}-`));
    await writeAll(dir, { 'package.json': PACKAGE_JSON, ...goldenSrcAfter(tier), ...cumulativeTests(tier) });
    const r = await runNodeTests(dir, protectedMap(tier), 60000);
    ok(r.passed, `golden passes (pass=${r.testsPassed} fail=${r.testsFailed}${r.reason ? ' reason=' + r.reason : ''})`);
    if (!r.passed) console.log(r.output.split('\n').slice(-12).join('\n'));
    await rm(dir, { recursive: true, force: true });
  }

  // 2. Scaffold fails (the agent has work to do).
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-scaffold-${tier}-`));
    await writeAll(dir, { 'package.json': PACKAGE_JSON, ...scaffoldSrc(tier), ...cumulativeTests(tier) });
    const r = await runNodeTests(dir, protectedMap(tier), 60000);
    ok(!r.passed, `scaffold fails as expected (pass=${r.testsPassed} fail=${r.testsFailed})`);
    await rm(dir, { recursive: true, force: true });
  }

  // 3. Tamper detection on the newest test file.
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-tamper-${tier}-`));
    await writeAll(dir, { 'package.json': PACKAGE_JSON, ...goldenSrcAfter(tier), ...cumulativeTests(tier) });
    const newest = cumulativeTestPaths(tier).slice(-1)[0];
    await writeFile(join(dir, newest), '// tampered\n', 'utf-8');
    const r = await runNodeTests(dir, protectedMap(tier), 60000);
    ok(!r.passed && r.reason === 'tests-modified', `tamper detected on ${newest}`);
    await rm(dir, { recursive: true, force: true });
  }
}

// ── micro-CRM suite (scored, building) ────────────────────────────────────────
for (const task of MICROCRM_TASKS) {
  console.log(`\nmicrocrm · ${task.id}`);
  const protectedFiles = {};
  for (const p of task.protectedPaths) protectedFiles[p] = task.scaffold[p];

  // 1. Reference (base for crm-build, full for extends) passes the task's tests.
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-${task.id}-ref-`));
    await writeAll(dir, microcrmReferenceFor(task));
    const r = await runNodeTests(dir, protectedFiles, 120000);
    ok(r.passed, `reference passes (pass=${r.testsPassed} fail=${r.testsFailed}${r.reason ? ' reason=' + r.reason : ''})`);
    if (!r.passed) console.log(r.output.split('\n').slice(-15).join('\n'));
    await rm(dir, { recursive: true, force: true });
  }

  // 2. Scaffold (no work done yet) fails — the agent has the feature to build.
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-${task.id}-scaffold-`));
    await writeAll(dir, task.scaffold);
    const r = await runNodeTests(dir, protectedFiles, 120000);
    ok(!r.passed, `scaffold fails as expected (reason=${r.reason})`);
    await rm(dir, { recursive: true, force: true });
  }

  // 3. Tamper detection on the spec test file.
  {
    const dir = await mkdtemp(join(tmpdir(), `bench-${task.id}-tamper-`));
    await writeAll(dir, microcrmReferenceFor(task));
    await writeFile(join(dir, task.protectedPaths[0]), '// tampered\n', 'utf-8');
    const r = await runNodeTests(dir, protectedFiles, 120000);
    ok(!r.passed && r.reason === 'tests-modified', `tamper detected on ${task.protectedPaths[0]}`);
    await rm(dir, { recursive: true, force: true });
  }
}

console.log(`\n${failures === 0 ? 'ALL GOOD' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
