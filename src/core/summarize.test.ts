import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { condenseHistory, COMPACTION_MARKER } from './summarize.js';
import { CodeAgent } from '../code/agent.js';
import { WorkspaceManager } from './workspace.js';
import type { Message } from '../models/base.js';

function fakeOrchestrator() {
  const prompts: string[] = [];
  let depth = 0;
  return {
    prompts,
    o: {
      async chat(opts: { messages: Message[]; purpose?: string }) {
        prompts.push(String(opts.messages[0].content));
        assert.equal(opts.purpose, 'auxiliary');
        return { content: '## Goal\nSUMMARY' };
      },
      beginTurn() { depth++; },
      endTurn() { depth--; return { calls: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0, reasoningTokens: 0, costSource: 'unknown', estimated: false }; },
      getTokenUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, lastPromptTokens: 0, lastTotalTokens: 0, totalCostUsd: 0 }),
    } as any,
  };
}

const exchange = (i: number): Message[] => [
  { role: 'user', content: `question ${i} ${'x'.repeat(200)}` },
  { role: 'assistant', content: `answer ${i} ${'y'.repeat(200)}` },
];

test('condenseHistory: no pinned first exchange, honours target, keeps recent tail verbatim', async () => {
  const { o, prompts } = fakeOrchestrator();
  const history = Array.from({ length: 10 }, (_, i) => exchange(i)).flat(); // 20 messages, no system
  const out = await condenseHistory(history, o, 7);
  assert.equal(out.length, 7); // summary + 6 recent
  assert.match(String(out[0].content), new RegExp(COMPACTION_MARKER.replace(/[[\]]/g, '\\$&')));
  assert.equal(out[1].role, 'user');
  assert.match(String(out[out.length - 1].content), /answer 9/);
  // The first exchange was summarised, not pinned
  assert.ok(!out.some((m) => String(m.content).startsWith('question 0')));
  assert.match(prompts[0], /question 0/);
});

test('condenseHistory keeps leading system/developer messages', async () => {
  const { o } = fakeOrchestrator();
  const history: Message[] = [{ role: 'system', content: 'sys' }, ...Array.from({ length: 6 }, (_, i) => exchange(i)).flat()];
  const out = await condenseHistory(history, o, 6);
  assert.equal(out[0].content, 'sys');
  assert.match(String(out[1].content), /Context compacted/);
});

test('CodeAgent.compact shrinks carried context and reports before/after', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jiva-compact-'));
  const workspace = new WorkspaceManager({ workspaceDir: dir });
  await workspace.initialize();
  const { o } = fakeOrchestrator();
  const agent = new CodeAgent({ orchestrator: o, workspace, lspEnabled: false });
  (agent as any).history = Array.from({ length: 12 }, (_, i) => exchange(i)).flat();
  const r = await agent.compact({ keepMessages: 4 });
  assert.ok(r.afterTokens < r.beforeTokens, JSON.stringify(r));
  assert.equal(r.beforeMessages, 24);
  assert.equal(r.afterMessages, 5);
  assert.equal(agent.getContextSize().messages, 5);
});

test('condenseHistory never grows the context (summary longer than tiny messages)', async () => {
  const o = {
    async chat() { return { content: 'A very long summary. '.repeat(100) }; },
  } as any;
  const tiny: Message[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `w${i}` }) as Message);
  const out = await condenseHistory(tiny, o, 4);
  assert.equal(out, tiny);
});
