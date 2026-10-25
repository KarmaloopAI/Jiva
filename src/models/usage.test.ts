import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TokenTracker } from './token-tracker.js';
import { parsePricing, resolveModelPrice, computeCost, clearPricingCache } from './pricing.js';
import { ModelClient } from './model-client.js';
import { ConversationManager, turnTokenUsage } from '../core/conversation-manager.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearPricingCache(); });

test('turns aggregate calls; nested turns share the outer accumulator', () => {
  const t = new TokenTracker();
  t.beginTurn();
  t.record({ promptTokens: 100, completionTokens: 10, cost: 0.01, costSource: 'provider', cachedTokens: 40 });
  t.beginTurn(); // nested (e.g. agent turn inside a host Deep Run turn)
  t.record({ promptTokens: 50, completionTokens: 5, cost: 0.005, costSource: 'provider' });
  const inner = t.endTurn();
  assert.equal(inner.calls, 2); // still the shared accumulator
  t.record({ promptTokens: 10, completionTokens: 1, cost: 0.001, costSource: 'provider' }, undefined, undefined, 'auxiliary');
  const outer = t.endTurn();
  assert.equal(outer.calls, 3);
  assert.equal(outer.promptTokens, 160);
  assert.equal(outer.cachedTokens, 40);
  assert.ok(Math.abs((outer.costUsd ?? 0) - 0.016) < 1e-9);
  assert.equal(outer.costSource, 'provider');
  // the next turn starts fresh
  t.beginTurn();
  assert.equal(t.endTurn().calls, 0);
});

test('one unpriced call makes the turn cost unknown; estimates are flagged', () => {
  const t = new TokenTracker();
  t.beginTurn();
  t.record({ promptTokens: 10, completionTokens: 2, cost: 0.001, costSource: 'catalog' });
  t.record(undefined, [{ role: 'user', content: 'hello world' }], 'hi'); // no usage → estimated, no cost
  const u = t.endTurn();
  assert.equal(u.costUsd, undefined);
  assert.equal(u.costSource, 'unknown');
  assert.equal(u.estimated, true);
});

test('auxiliary calls do not overwrite lastPromptTokens', () => {
  const t = new TokenTracker();
  t.record({ promptTokens: 5000, completionTokens: 100 });
  t.record({ promptTokens: 30, completionTokens: 5 }, undefined, undefined, 'auxiliary');
  assert.equal(t.getSnapshot().lastPromptTokens, 5000);
  assert.equal(t.getSnapshot().promptTokens, 5030);
});

test('parsePricing handles OpenRouter per-token and Together per-million shapes', () => {
  assert.deepEqual(parsePricing({ prompt: '0.00000015', completion: '0.0000006' }), { promptPerM: 0.15, completionPerM: 0.6 });
  assert.deepEqual(parsePricing({ input: 0.88, output: 1.2 }), { promptPerM: 0.88, completionPerM: 1.2 });
  assert.equal(parsePricing({ hourly: 1 }), undefined);
  assert.equal(parsePricing(undefined), undefined);
});

test('price resolution: catalog, then config, else unknown', async () => {
  const catalog = (async () => new Response(JSON.stringify({ data: [{ id: 'm1', pricing: { input: 1, output: 2 } }] }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await resolveModelPrice('https://x.test/v1/chat/completions', 'm1', 'k', undefined, catalog), { promptPerM: 1, completionPerM: 2, source: 'catalog' });
  clearPricingCache();
  const none = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await resolveModelPrice('https://y.test/v1/chat/completions', 'm2', 'k', { promptPerM: 3, completionPerM: 4 }, none), { promptPerM: 3, completionPerM: 4, source: 'config' });
  clearPricingCache();
  assert.equal(await resolveModelPrice('https://z.test/v1/chat/completions', 'm3', 'k', undefined, none), undefined);
});

test('computeCost bills cached prompt tokens at the cached rate', () => {
  const c = computeCost({ promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 500_000 }, { promptPerM: 2, completionPerM: 10, cachedPromptPerM: 0.5 });
  assert.equal(c, 500_000 * 2 / 1e6 + 500_000 * 0.5 / 1e6 + 10);
});

test('ModelClient: provider cost kept; otherwise priced from catalog; otherwise unknown', async () => {
  let calls = 0;
  globalThis.fetch = (async (url: any) => {
    calls++;
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'priced', pricing: { input: 1, output: 3 } }] }), { status: 200 });
    }
    const body = { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const mk = (model: string) => new ModelClient({ endpoint: 'https://prov.test/v1/chat/completions', apiKey: 'k', model, type: 'reasoning' });
  const priced = await mk('priced').chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(priced.usage?.costSource, 'catalog');
  assert.equal(priced.usage?.cost, (1000 * 1 + 500 * 3) / 1e6);
  const unpriced = await mk('mystery').chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(unpriced.usage?.costSource, 'unknown');
  assert.equal(unpriced.usage?.cost, undefined);
  assert.ok(calls >= 3);
});

test('saved conversation totals add per-turn usage (no quadratic inflation)', async () => {
  const store = new Map<string, any>();
  const provider = {
    async saveConversation(c: any) { store.set(c.metadata.id, JSON.parse(JSON.stringify(c))); },
    async loadConversation(id: string) { return store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : null; },
  } as any;
  const cm = new ConversationManager(provider);
  const msgs: any[] = [{ role: 'user', content: 'hi' }];
  for (let i = 0; i < 3; i++) {
    await cm.autoSave(msgs, '/ws', undefined, 'code', turnTokenUsage({ promptTokens: 100, completionTokens: 10, totalTokens: 110, costUsd: 0.01 }));
  }
  const saved = [...store.values()][0];
  assert.equal(saved.metadata.totalTokens, 330);
  assert.ok(Math.abs(saved.metadata.totalCostUsd - 0.03) < 1e-9);
});
