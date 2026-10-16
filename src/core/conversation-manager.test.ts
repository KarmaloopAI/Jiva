import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationManager } from './conversation-manager.js';

function memoryStorage() {
  const convs = new Map<string, any>();
  return {
    convs,
    provider: {
      async saveConversation(c: any) { convs.set(c.metadata.id, JSON.parse(JSON.stringify(c))); },
      async loadConversation(id: string) { return convs.has(id) ? JSON.parse(JSON.stringify(convs.get(id))) : null; },
    } as any,
  };
}

const slowTitleOrchestrator = (ms: number, title: string) => ({
  async chat() {
    await new Promise((r) => setTimeout(r, ms));
    return { content: title };
  },
}) as any;

const longMsg = 'Please refactor the payment module so that retries are idempotent and logged';

test('saving never waits for LLM title generation; title is patched in afterwards', async () => {
  const { provider, convs } = memoryStorage();
  const cm = new ConversationManager(provider, slowTitleOrchestrator(150, 'Idempotent Payment Retries'));
  const start = Date.now();
  const id = await cm.saveConversation([{ role: 'user', content: longMsg }], '/ws');
  assert.ok(Date.now() - start < 100, 'save returned before the title LLM call finished');
  assert.match(convs.get(id).metadata.title, /^Please refactor/);

  await cm.flushPendingTitles();
  assert.equal(convs.get(id).metadata.title, 'Idempotent Payment Retries');
});

test('a background title never overwrites a newer save or a changed title', async () => {
  const { provider, convs } = memoryStorage();
  const cm = new ConversationManager(provider, slowTitleOrchestrator(80, 'Generated'));
  const id = await cm.saveConversation([{ role: 'user', content: longMsg }], '/ws');
  // A newer save lands while the title is still being generated.
  await cm.saveConversation(
    [{ role: 'user', content: longMsg }, { role: 'assistant', content: 'done' }],
    '/ws',
  );
  await cm.flushPendingTitles();
  const saved = convs.get(id);
  assert.equal(saved.messages.length, 2, 'newer save preserved');
  assert.equal(saved.metadata.title, 'Generated');

  // If the stored title changed meanwhile, the background title is dropped.
  const cm2 = new ConversationManager(provider, slowTitleOrchestrator(50, 'Generated 2'));
  const id2 = await cm2.saveConversation([{ role: 'user', content: longMsg + ' 2' }], '/ws', 'conv-2');
  const stored = convs.get(id2);
  stored.metadata.title = 'User Renamed';
  convs.set(id2, stored);
  await cm2.flushPendingTitles();
  assert.equal(convs.get(id2).metadata.title, 'User Renamed');
});
