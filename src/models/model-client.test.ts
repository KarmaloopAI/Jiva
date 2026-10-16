import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ModelClient, parseUsage, type ModelClientConfig } from './model-client.js';
import { modelClientConfigFromStored } from './client-config.js';
import { OPENROUTER_ENDPOINT } from './openrouter.js';

const tool = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object' as const, properties: { path: { type: 'string' } } },
};

function client(over: Partial<ModelClientConfig> = {}) {
  return new ModelClient({
    endpoint: OPENROUTER_ENDPOINT,
    apiKey: 'sk-test',
    model: 'openai/gpt-oss-120b',
    type: 'reasoning',
    ...over,
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return handler(String(url), init);
  }) as typeof fetch;
  return calls;
}

const okBody = (extra: object = {}) =>
  new Response(
    JSON.stringify({
      model: 'openai/gpt-oss-120b',
      provider: 'Fireworks',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0012 },
      ...extra,
    }),
    { status: 200 },
  );

test('OpenRouter body carries ranked provider order, fallbacks and require_parameters with tools', () => {
  const c = client({ openrouter: { providerOrder: ['fireworks', 'together'], allowFallbacks: false } });
  const { requestBody } = c.buildRequestBody(
    { messages: [{ role: 'user', content: 'x' }], tools: [tool], reasoningEffort: 'high' },
    true,
  );
  assert.deepEqual(requestBody.provider, {
    order: ['fireworks', 'together'],
    allow_fallbacks: false,
    require_parameters: true,
  });
  assert.deepEqual(requestBody.reasoning, { effort: 'high' });
  assert.equal(requestBody.reasoning_effort, undefined);
  // no "Reasoning: x" system message injected on OpenRouter by default
  assert.equal(requestBody.messages[0].role, 'user');
});

test('routing fields are never sent to non-OpenRouter endpoints', () => {
  const c = new ModelClient({
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: 'k',
    model: 'm',
    type: 'reasoning',
    reasoningEffortStrategy: 'api_param',
    defaultReasoningEffort: 'high',
    openrouter: undefined,
  });
  const { requestBody } = c.buildRequestBody({ messages: [{ role: 'user', content: 'x' }], tools: [tool] }, true);
  assert.equal(requestBody.provider, undefined);
  assert.equal(requestBody.models, undefined);
  assert.equal(requestBody.reasoning_effort, 'high');
  assert.equal(requestBody.reasoning, undefined);
});

test('model fallbacks go to `models`; reasoning_details stripped for non-OpenRouter', () => {
  const or = client({ openrouter: { modelFallbacks: ['b/m'] } });
  const msg = {
    role: 'assistant' as const,
    content: null,
    tool_calls: [],
    reasoning_details: [{ type: 'reasoning.text', text: 't' }],
  };
  const a = or.buildRequestBody({ messages: [msg] }, true).requestBody;
  assert.deepEqual(a.models, ['b/m']);
  assert.equal(a.messages[0].reasoning_details.length, 1);

  const other = new ModelClient({ endpoint: 'https://x.test/v1', apiKey: 'k', model: 'm', type: 'reasoning' });
  const b = other.buildRequestBody({ messages: [msg] }, true).requestBody;
  assert.equal('reasoning_details' in b.messages[0], false);
});

test('chat(): sends attribution headers + parses served-by, cost and usage', async () => {
  const calls = stubFetch(() => okBody());
  const res = await client({ headers: { 'X-Custom': '1' } }).chat({ messages: [{ role: 'user', content: 'x' }] });
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h['X-Title'], 'Jiva');
  assert.ok(h['HTTP-Referer']);
  assert.equal(h['X-Custom'], '1');
  assert.equal(h['Authorization'], 'Bearer sk-test');
  assert.deepEqual(res.routing, { model: 'openai/gpt-oss-120b', provider: 'Fireworks' });
  assert.equal(res.usage?.cost, 0.0012);
  assert.equal(res.usage?.totalTokens, 15);
});

test('chat(): user headers cannot override Authorization', async () => {
  const calls = stubFetch(() => okBody());
  await client({ headers: { Authorization: 'Bearer evil' } }).chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal((calls[0].init.headers as any)['Authorization'], 'Bearer sk-test');
});

test('chat(): HTTP 200 with error body becomes a ModelError (non-retryable code)', async () => {
  stubFetch(() => new Response(JSON.stringify({ error: { code: 402, message: 'no credits' } }), { status: 200 }));
  await assert.rejects(
    () => client().chat({ messages: [{ role: 'user', content: 'x' }] }),
    /API error \(402\): no credits/,
  );
});

test('chat(): 402 is not retried and carries credit guidance', async () => {
  const calls = stubFetch(() => new Response('{"error":{"message":"x"}}', { status: 402 }));
  await assert.rejects(() => client().chat({ messages: [{ role: 'user', content: 'x' }] }), /credits/i);
  assert.equal(calls.length, 1);
});

test('chat(): streamed response captures served-by, reasoning_details and mid-stream error', async () => {
  const sse = (events: object[]) =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });

  stubFetch(() =>
    sse([
      { model: 'm', provider: 'Together', choices: [{ delta: { content: 'he', reasoning_details: [{ i: 1 }] } }] },
      { choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.5 } },
    ]),
  );
  const res = await client().chat({ messages: [{ role: 'user', content: 'x' }], stream: true });
  assert.equal(res.content, 'hello');
  assert.deepEqual(res.routing, { model: 'm', provider: 'Together' });
  assert.deepEqual(res.reasoningDetails, [{ i: 1 }]);
  assert.equal(res.usage?.cost, 0.5);

  stubFetch(() =>
    sse([{ choices: [{ delta: { content: 'par' } }] }, { error: { code: 400, message: 'boom' }, choices: [{ finish_reason: 'error' }] }]),
  );
  await assert.rejects(
    () => client().chat({ messages: [{ role: 'user', content: 'x' }], stream: true }),
    /API error \(400\): boom/,
  );
});

test('parseUsage maps OpenRouter detail fields', () => {
  assert.deepEqual(
    parseUsage({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      cost: 0.1,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 5 },
    }),
    { promptTokens: 1, completionTokens: 2, totalTokens: 3, cost: 0.1, cachedTokens: 4, reasoningTokens: 5 },
  );
  assert.equal(parseUsage(undefined), undefined);
});

test('modelClientConfigFromStored carries routing/headers and respects roles', () => {
  const stored = {
    endpoint: OPENROUTER_ENDPOINT,
    apiKey: 'k',
    defaultModel: 'a/b',
    useHarmonyFormat: false,
    defaultMaxTokens: 100,
    openrouter: { providerOrder: ['x'] },
    headers: { 'X-A': '1' },
  };
  const r = modelClientConfigFromStored(stored, 'reasoning');
  assert.equal(r.model, 'a/b');
  assert.deepEqual(r.openrouter, { providerOrder: ['x'] });
  assert.equal(r.defaultMaxTokens, 100);
  const m = modelClientConfigFromStored(stored, 'multimodal');
  assert.deepEqual(m.openrouter, { providerOrder: ['x'] });
  assert.equal(m.defaultMaxTokens, undefined);
});
