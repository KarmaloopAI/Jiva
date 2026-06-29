/**
 * Canonical "taskstore" library fixtures.
 *
 * A single evolving Node library is the substrate for the whole benchmark. Each
 * tier's scaffold is the canonical (golden) state of the prior tiers plus the
 * new failing test(s). These helpers are the single source of truth for that
 * golden state, so the suite stays DRY and the tiers genuinely build on one
 * another.
 *
 * Layout in the workspace:
 *   package.json        { "type": "module" }
 *   src/index.js        public entry (single file for tiers 1-4, re-export after)
 *   src/model.js        mutation functions (after the tier-5 refactor)
 *   src/query.js        read functions (after the tier-5 refactor)
 *   src/storage.js      serialize/deserialize (after tier 7)
 *   test/tNN.test.mjs   cumulative node:test files
 */

import type { TaskFile } from './types.js';

export const PACKAGE_JSON = JSON.stringify({ name: 'taskstore', type: 'module', private: true }, null, 2) + '\n';

// ---------------------------------------------------------------------------
// Function source snippets (correct + buggy variants)
// ---------------------------------------------------------------------------

const createTaskFn = `export function createTask(title) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error('title is required');
  }
  return { title, done: false, priority: 'normal', due: null };
}`;

const addTaskFn = `export function addTask(list, title) {
  const task = createTask(title);
  const nextId = list.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;
  return [...list, { ...task, id: nextId }];
}`;

/** Tier-8 planted bug: length-based id collides after a removal. */
const addTaskBuggyFn = `export function addTask(list, title) {
  const task = createTask(title);
  // BUG: uses list length for the id, which collides after a removal.
  const nextId = list.length + 1;
  return [...list, { ...task, id: nextId }];
}`;

const removeTaskFn = `export function removeTask(list, id) {
  return list.filter((t) => t.id !== id);
}`;

const listTasksFn = `export function listTasks(list) {
  return [...list];
}`;

const toggleTaskFn = `export function toggleTask(list, id) {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}`;

/** Tier-3 planted bug: treats id as an array index. */
const toggleTaskBuggyFn = `export function toggleTask(list, id) {
  // BUG: treats id as an array index instead of matching task.id.
  return list.map((t, index) => (index === id ? { ...t, done: !t.done } : t));
}`;

const setPriorityFn = `const PRIORITIES = ['low', 'normal', 'high'];
export function setPriority(list, id, priority) {
  if (!PRIORITIES.includes(priority)) {
    throw new Error('invalid priority: ' + priority);
  }
  return list.map((t) => (t.id === id ? { ...t, priority } : t));
}`;

const tasksByPriorityFn = `export function tasksByPriority(list, priority) {
  return list.filter((t) => t.priority === priority);
}`;

const sortTasksFn = `export function sortTasks(list, options = {}) {
  const by = options.by || 'due';
  if (by !== 'due') throw new Error('unsupported sort key: ' + by);
  // Array.prototype.sort is stable in Node, so equal keys keep their order.
  return [...list].sort((a, b) => {
    const av = a.due ?? null;
    const bv = b.due ?? null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // tasks without a due date sort last
    if (bv === null) return -1;
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
}`;

const storageFns = `export function serialize(list) {
  return JSON.stringify(list);
}

export function deserialize(str) {
  const data = JSON.parse(str);
  if (!Array.isArray(data)) throw new Error('expected an array');
  return data;
}`;

// ---------------------------------------------------------------------------
// Golden src builders
// ---------------------------------------------------------------------------

/** Single-file `src/index.js` containing every function up to `tier` (<=4). */
function singleFileSrc(tier: number, opts: { buggyToggle?: boolean } = {}): TaskFile {
  const parts = [createTaskFn];
  if (tier >= 2) parts.push(addTaskFn, removeTaskFn, listTasksFn);
  if (opts.buggyToggle) parts.push(toggleTaskBuggyFn);
  else if (tier >= 3) parts.push(toggleTaskFn);
  if (tier >= 4) parts.push(setPriorityFn, tasksByPriorityFn);
  return { 'src/index.js': parts.join('\n\n') + '\n' };
}

/** Multi-file layout (after the tier-5 refactor). */
function multiFileSrc(opts: { sort?: boolean; storage?: boolean; buggyAdd?: boolean } = {}): TaskFile {
  const model = [
    createTaskFn,
    opts.buggyAdd ? addTaskBuggyFn : addTaskFn,
    removeTaskFn,
    toggleTaskFn,
    setPriorityFn,
  ].join('\n\n') + '\n';

  const query = [listTasksFn, tasksByPriorityFn, ...(opts.sort ? [sortTasksFn] : [])].join('\n\n') + '\n';

  const reexports = [`export * from './model.js';`, `export * from './query.js';`];
  if (opts.storage) reexports.push(`export * from './storage.js';`);

  const files: TaskFile = {
    'src/model.js': model,
    'src/query.js': query,
    'src/index.js': reexports.join('\n') + '\n',
  };
  if (opts.storage) files['src/storage.js'] = storageFns + '\n';
  return files;
}

/**
 * Canonical golden source state *after* a tier is completed. Used both as the
 * baseline scaffold for the next tier and (by the harness self-test) as a
 * "known-good" set of files a mock agent can write to prove the verifier works.
 */
export function goldenSrcAfter(tier: number): TaskFile {
  switch (tier) {
    case 0:
      return {};
    case 1:
      return singleFileSrc(1);
    case 2:
      return singleFileSrc(2);
    case 3:
      return singleFileSrc(3);
    case 4:
      return singleFileSrc(4);
    case 5:
      return multiFileSrc();
    case 6:
      return multiFileSrc({ sort: true });
    case 7:
    case 8:
      return multiFileSrc({ sort: true, storage: true });
    default:
      throw new Error(`no golden state for tier ${tier}`);
  }
}

/** The scaffolded (pre-agent) src state for a given tier — golden(N-1) plus any planted bug. */
export function scaffoldSrc(tier: number): TaskFile {
  switch (tier) {
    case 1:
      return {}; // nothing yet — the agent creates src/index.js from scratch
    case 2:
      return singleFileSrc(1);
    case 3:
      return singleFileSrc(2, { buggyToggle: true }); // planted toggle bug
    case 4:
      return singleFileSrc(3);
    case 5:
      return singleFileSrc(4);
    case 6:
      return multiFileSrc();
    case 7:
      return multiFileSrc({ sort: true });
    case 8:
      return multiFileSrc({ sort: true, storage: true, buggyAdd: true }); // planted add bug
    default:
      throw new Error(`no scaffold for tier ${tier}`);
  }
}
