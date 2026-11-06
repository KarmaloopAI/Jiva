import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runToolBatch,
  partitionCalls,
  conflicts,
  EXCLUSIVE,
  READS_ALL,
  readsPath,
  writesPath,
  resolveToolExecutionSettings,
  type ScheduledCall,
  type ToolAccess,
} from './tool-scheduler.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function call(index: number, access: ToolAccess, ms: number, log: string[], fail = false): ScheduledCall<string> {
  return {
    index,
    id: `c${index}`,
    name: `t${index}`,
    access,
    async run() {
      log.push(`start ${index}`);
      await sleep(ms);
      log.push(`end ${index}`);
      if (fail) throw new Error(`boom ${index}`);
      return `r${index}`;
    },
  };
}

test('conflict rules', () => {
  assert.equal(conflicts(readsPath('a'), readsPath('a')), false);
  assert.equal(conflicts(readsPath('a'), writesPath('a')), true);
  assert.equal(conflicts(writesPath('a'), writesPath('b')), false);
  assert.equal(conflicts(writesPath('a'), writesPath('a')), true);
  assert.equal(conflicts(READS_ALL, writesPath('a')), true);
  assert.equal(conflicts(READS_ALL, readsPath('a')), false);
  assert.equal(conflicts(EXCLUSIVE, readsPath('a')), true);
});

test('partition keeps order and splits on conflicts / exclusive calls', () => {
  const p = (accesses: ToolAccess[]) =>
    partitionCalls(accesses.map((access, i) => ({ access, i }))).map((g) => g.map((c) => c.i));

  assert.deepEqual(p([readsPath('a'), readsPath('b'), READS_ALL]), [[0, 1, 2]]);
  assert.deepEqual(p([writesPath('a'), writesPath('b')]), [[0, 1]]);
  assert.deepEqual(p([writesPath('a'), readsPath('a')]), [[0], [1]]);
  assert.deepEqual(p([readsPath('a'), EXCLUSIVE, readsPath('b'), readsPath('c')]), [[0], [1], [2, 3]]);
  assert.deepEqual(p([EXCLUSIVE, EXCLUSIVE]), [[0], [1]]);
  assert.deepEqual(p([READS_ALL, writesPath('x'), readsPath('y')]), [[0], [1, 2]]);
  // parallel disabled → one call per group
  assert.deepEqual(
    partitionCalls([readsPath('a'), readsPath('b')].map((access, i) => ({ access, i })), false).map((g) => g.map((c) => c.i)),
    [[0], [1]],
  );
});

test('independent calls overlap; results come back in call order', async () => {
  const log: string[] = [];
  const { outcomes, stats } = await runToolBatch([
    call(0, readsPath('a'), 60, log),
    call(1, readsPath('b'), 10, log),
    call(2, READS_ALL, 30, log),
  ]);
  assert.deepEqual(outcomes.map((o) => o.result), ['r0', 'r1', 'r2']);
  // all three started before any finished
  assert.deepEqual(log.slice(0, 3), ['start 0', 'start 1', 'start 2']);
  assert.equal(stats.groups, 1);
  assert.equal(stats.maxGroupSize, 3);
  assert.ok(stats.wallMs < stats.serialMs, `${stats.wallMs} < ${stats.serialMs}`);
});

test('a conflicting call waits for the previous group', async () => {
  const log: string[] = [];
  await runToolBatch([call(0, writesPath('a'), 20, log), call(1, readsPath('a'), 5, log)]);
  assert.deepEqual(log, ['start 0', 'end 0', 'start 1', 'end 1']);
});

test('concurrency cap is respected', async () => {
  let inFlight = 0;
  let peak = 0;
  const calls: ScheduledCall<number>[] = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    id: `c${i}`,
    name: 'r',
    access: READS_ALL,
    async run() {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return i;
    },
  }));
  const { outcomes } = await runToolBatch(calls, { maxConcurrency: 3 });
  assert.equal(peak, 3);
  assert.deepEqual(outcomes.map((o) => o.result), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('one failure does not affect siblings', async () => {
  const log: string[] = [];
  const { outcomes } = await runToolBatch([call(0, readsPath('a'), 5, log, true), call(1, readsPath('b'), 5, log)]);
  assert.match(String(outcomes[0].error), /boom 0/);
  assert.equal(outcomes[1].result, 'r1');
});

test('parallel:false runs strictly sequentially', async () => {
  const log: string[] = [];
  await runToolBatch([call(0, readsPath('a'), 10, log), call(1, readsPath('b'), 1, log)], { parallel: false });
  assert.deepEqual(log, ['start 0', 'end 0', 'start 1', 'end 1']);
});

test('abort skips calls that have not started', async () => {
  const log: string[] = [];
  const ac = new AbortController();
  const first: ScheduledCall<string> = {
    index: 0,
    id: 'c0',
    name: 'x',
    access: EXCLUSIVE,
    async run() {
      ac.abort();
      return 'r0';
    },
  };
  const { outcomes } = await runToolBatch([first, call(1, readsPath('b'), 1, log)], { signal: ac.signal });
  assert.equal(outcomes[0].result, 'r0');
  assert.equal(outcomes[1].skipped, true);
  assert.deepEqual(log, []);
});

test('settings: env overrides config', () => {
  const saved = { ...process.env };
  try {
    delete process.env.JIVA_PARALLEL_TOOLS;
    delete process.env.JIVA_MAX_TOOL_CONCURRENCY;
    assert.deepEqual(resolveToolExecutionSettings(), { parallel: true, maxConcurrency: 8 });
    assert.deepEqual(resolveToolExecutionSettings({ parallel: false, maxConcurrency: 2 }), { parallel: false, maxConcurrency: 2 });
    process.env.JIVA_PARALLEL_TOOLS = 'off';
    process.env.JIVA_MAX_TOOL_CONCURRENCY = '4';
    assert.deepEqual(resolveToolExecutionSettings({ parallel: true }), { parallel: false, maxConcurrency: 4 });
  } finally {
    process.env = saved;
  }
});
