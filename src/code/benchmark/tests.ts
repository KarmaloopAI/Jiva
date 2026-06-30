/**
 * Cumulative node:test files for the benchmark suite.
 *
 * Tier N's workspace contains every test file test1..testN, so the verifier
 * catches regressions in earlier tiers (critical for the tier-5 refactor and
 * the tier-8 debug task). All tests import the library through `../src/index.js`
 * except the tier-5 structural test, which deliberately imports the split
 * modules to force the refactor.
 *
 * The agent must NOT modify any of these files (see BenchmarkTask.protectedPaths).
 */

import type { TaskFile } from './types.js';

const TEST_FILES: Record<number, { path: string; content: string }> = {
  1: {
    path: 'test/t01.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/index.js';

test('createTask sets the title and defaults done to false', () => {
  const t = createTask('Buy milk');
  assert.equal(t.title, 'Buy milk');
  assert.equal(t.done, false);
});

test('createTask rejects empty or blank titles', () => {
  assert.throws(() => createTask(''));
  assert.throws(() => createTask('   '));
});
`,
  },
  2: {
    path: 'test/t02.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, removeTask, listTasks } from '../src/index.js';

test('addTask appends a task with an incrementing id', () => {
  let list = [];
  list = addTask(list, 'a');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 1);
  list = addTask(list, 'b');
  assert.equal(list.length, 2);
  assert.equal(list[1].id, 2);
});

test('addTask does not mutate the input list', () => {
  const original = [];
  const next = addTask(original, 'a');
  assert.equal(original.length, 0);
  assert.equal(next.length, 1);
});

test('removeTask removes the task with the given id', () => {
  let list = addTask(addTask(addTask([], 'a'), 'b'), 'c'); // ids 1,2,3
  list = removeTask(list, 2);
  assert.deepEqual(list.map((t) => t.id), [1, 3]);
});

test('listTasks returns all tasks', () => {
  const list = addTask(addTask([], 'a'), 'b');
  assert.equal(listTasks(list).length, 2);
});
`,
  },
  3: {
    path: 'test/t03.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, toggleTask } from '../src/index.js';

test('toggleTask flips done for the task with the matching id', () => {
  let list = addTask(addTask([], 'a'), 'b'); // ids 1,2
  list = toggleTask(list, 2);
  assert.equal(list.find((t) => t.id === 1).done, false);
  assert.equal(list.find((t) => t.id === 2).done, true);
});

test('toggleTask toggles back to false when called twice', () => {
  let list = addTask([], 'a'); // id 1
  list = toggleTask(list, 1);
  list = toggleTask(list, 1);
  assert.equal(list.find((t) => t.id === 1).done, false);
});
`,
  },
  4: {
    path: 'test/t04.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, setPriority, tasksByPriority } from '../src/index.js';

test('new tasks default to normal priority', () => {
  const list = addTask([], 'a');
  assert.equal(list[0].priority, 'normal');
});

test('setPriority updates the priority of the matching task', () => {
  let list = addTask(addTask([], 'a'), 'b'); // ids 1,2
  list = setPriority(list, 2, 'high');
  assert.equal(list.find((t) => t.id === 2).priority, 'high');
  assert.equal(list.find((t) => t.id === 1).priority, 'normal');
});

test('setPriority rejects an invalid priority', () => {
  const list = addTask([], 'a');
  assert.throws(() => setPriority(list, 1, 'urgent'));
});

test('tasksByPriority filters by priority', () => {
  let list = addTask(addTask([], 'a'), 'b');
  list = setPriority(list, 1, 'high');
  assert.equal(tasksByPriority(list, 'high').length, 1);
  assert.equal(tasksByPriority(list, 'normal').length, 1);
});
`,
  },
  5: {
    path: 'test/t05.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';
import * as query from '../src/query.js';
import * as index from '../src/index.js';

test('model module exposes the mutation functions', () => {
  for (const fn of ['createTask', 'addTask', 'removeTask', 'toggleTask', 'setPriority']) {
    assert.equal(typeof model[fn], 'function', 'model.' + fn);
  }
});

test('query module exposes the read functions', () => {
  for (const fn of ['listTasks', 'tasksByPriority']) {
    assert.equal(typeof query[fn], 'function', 'query.' + fn);
  }
});

test('index re-exports the full public API', () => {
  for (const fn of ['createTask', 'addTask', 'removeTask', 'toggleTask', 'setPriority', 'listTasks', 'tasksByPriority']) {
    assert.equal(typeof index[fn], 'function', 'index.' + fn);
  }
});
`,
  },
  6: {
    path: 'test/t06.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTasks } from '../src/index.js';

const mk = (id, due) => ({ id, title: 't' + id, done: false, priority: 'normal', due });

test('sorts by due date ascending', () => {
  const list = [mk(1, '2026-03-01'), mk(2, '2026-01-01'), mk(3, '2026-02-01')];
  assert.deepEqual(sortTasks(list, { by: 'due' }).map((t) => t.id), [2, 3, 1]);
});

test('places tasks without a due date last', () => {
  const list = [mk(1, null), mk(2, '2026-01-01'), mk(3, undefined)];
  const ids = sortTasks(list, { by: 'due' }).map((t) => t.id);
  assert.equal(ids[0], 2);
  assert.deepEqual(ids.slice(1).sort(), [1, 3]);
});

test('is stable for equal due dates', () => {
  const list = [mk(1, '2026-01-01'), mk(2, '2026-01-01'), mk(3, '2026-01-01')];
  assert.deepEqual(sortTasks(list, { by: 'due' }).map((t) => t.id), [1, 2, 3]);
});

test('does not mutate the input list', () => {
  const list = [mk(2, '2026-02-01'), mk(1, '2026-01-01')];
  sortTasks(list, { by: 'due' });
  assert.deepEqual(list.map((t) => t.id), [2, 1]);
});
`,
  },
  7: {
    path: 'test/t07.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, setPriority, serialize, deserialize } from '../src/index.js';

test('serialize/deserialize round-trips a list preserving all fields', () => {
  let list = addTask(addTask([], 'a'), 'b');
  list = setPriority(list, 1, 'high');
  const restored = deserialize(serialize(list));
  assert.deepEqual(restored, list);
});

test('deserialize rejects JSON that is not an array', () => {
  assert.throws(() => deserialize('{}'));
});
`,
  },
  8: {
    path: 'test/t08.test.mjs',
    content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, removeTask, serialize, deserialize } from '../src/index.js';

test('ids stay unique after a removal and re-add', () => {
  let list = addTask(addTask(addTask([], 'a'), 'b'), 'c'); // ids 1,2,3
  list = removeTask(list, 2); // ids 1,3
  list = addTask(list, 'd');
  const ids = list.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.join(','));
});

test('ids stay unique after a serialize round-trip and add', () => {
  let list = addTask(addTask(addTask([], 'a'), 'b'), 'c');
  list = removeTask(list, 2);
  list = deserialize(serialize(list));
  list = addTask(list, 'e');
  const ids = list.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.join(','));
});
`,
  },
};

/** All test files for tiers 1..tier (cumulative). */
export function cumulativeTests(tier: number): TaskFile {
  const files: TaskFile = {};
  for (let t = 1; t <= tier; t++) {
    const entry = TEST_FILES[t];
    if (entry) files[entry.path] = entry.content;
  }
  return files;
}

/** Paths of all test files for tiers 1..tier (the protected set). */
export function cumulativeTestPaths(tier: number): string[] {
  return Object.keys(cumulativeTests(tier));
}
