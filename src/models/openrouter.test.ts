import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenRouterConfigSchema,
  buildOpenRouterRouting,
  buildOpenRouterHeaders,
  parseSlugList,
  normalizeSlugs,
  isOpenRouterEndpoint,
  isOpenRouterModel,
  parseOpenRouterErrorBody,
  describeOpenRouterHttpError,
  extractRoutingInfo,
  findUnknownSlugs,
  fetchModelProviderEndpoints,
} from './openrouter.js';

test('parseSlugList handles commas, spaces, case and duplicates', () => {
  assert.deepEqual(parseSlugList(' Fireworks, together  DeepInfra/Turbo,fireworks '), [
    'fireworks',
    'together',
    'deepinfra/turbo',
  ]);
  assert.equal(parseSlugList(''), undefined);
  assert.equal(parseSlugList(undefined), undefined);
});

test('normalizeSlugs preserves priority order', () => {
  assert.deepEqual(normalizeSlugs(['b', 'a', 'B']), ['b', 'a']);
});

test('endpoint / model detection', () => {
  assert.equal(isOpenRouterEndpoint('https://openrouter.ai/api/v1/chat/completions'), true);
  assert.equal(isOpenRouterEndpoint('https://api.groq.com/openai/v1/chat/completions'), false);
  assert.equal(isOpenRouterEndpoint('not a url'), false);
  assert.equal(isOpenRouterModel({ endpoint: 'https://example.com/v1', openrouter: {} }), true);
  assert.equal(isOpenRouterModel({ endpoint: 'https://example.com/v1' }), false);
});

test('routing: ranked order + strict fallbacks', () => {
  const r = buildOpenRouterRouting({ providerOrder: ['Fireworks', 'together'], allowFallbacks: false }, false);
  assert.deepEqual(r.provider, { order: ['fireworks', 'together'], allow_fallbacks: false });
  assert.equal(r.models, undefined);
});

test('routing: require_parameters defaults on only when tools are present', () => {
  assert.equal(buildOpenRouterRouting({}, true).provider?.require_parameters, true);
  assert.equal(buildOpenRouterRouting({}, false).provider, undefined);
  // Explicit config wins both ways
  assert.equal(buildOpenRouterRouting({ requireParameters: false }, true).provider?.require_parameters, false);
  assert.equal(buildOpenRouterRouting({ requireParameters: true }, false).provider?.require_parameters, true);
});

test('routing: full policy maps to OpenRouter field names', () => {
  const r = buildOpenRouterRouting(
    {
      only: ['a'],
      ignore: ['b'],
      sort: 'throughput',
      dataCollection: 'deny',
      zdr: true,
      quantizations: ['fp8'],
      maxPrice: { prompt: 1, completion: 2 },
      modelFallbacks: ['anthropic/claude-sonnet-4.5'],
    },
    false,
  );
  assert.deepEqual(r.provider, {
    only: ['a'],
    ignore: ['b'],
    sort: 'throughput',
    data_collection: 'deny',
    zdr: true,
    quantizations: ['fp8'],
    max_price: { prompt: 1, completion: 2 },
  });
  assert.deepEqual(r.models, ['anthropic/claude-sonnet-4.5']);
});

test('schema rejects providerOrder together with sort', () => {
  const bad = OpenRouterConfigSchema.safeParse({ providerOrder: ['a'], sort: 'price' });
  assert.equal(bad.success, false);
  assert.equal(OpenRouterConfigSchema.safeParse({ providerOrder: ['a'] }).success, true);
  assert.equal(OpenRouterConfigSchema.safeParse({ sort: 'price' }).success, true);
});

test('headers carry attribution defaults and overrides', () => {
  assert.equal(buildOpenRouterHeaders(undefined)['X-Title'], 'Jiva');
  const h = buildOpenRouterHeaders({ referer: 'https://x.test', title: 'App' });
  assert.equal(h['HTTP-Referer'], 'https://x.test');
  assert.equal(h['X-Title'], 'App');
});

test('error body parsing', () => {
  assert.equal(parseOpenRouterErrorBody({ choices: [] }), undefined);
  const e = parseOpenRouterErrorBody({
    error: { code: 429, message: 'slow down', metadata: { provider_name: 'Fireworks' } },
  });
  assert.deepEqual(e, { code: 429, message: 'slow down', providerName: 'Fireworks' });
  assert.deepEqual(parseOpenRouterErrorBody({ error: 'boom' }), { message: 'boom' });
});

test('HTTP error descriptions keep "(NNN)" and add guidance', () => {
  const m402 = describeOpenRouterHttpError(402, 'no credits', undefined);
  assert.match(m402, /API error \(402\)/);
  assert.match(m402, /credits/i);
  const m503 = describeOpenRouterHttpError(503, 'x', { providerOrder: ['nope'], allowFallbacks: false });
  assert.match(m503, /API error \(503\)/);
  assert.match(m503, /"order":\["nope"\]/);
  assert.equal(describeOpenRouterHttpError(500, 'x', undefined), 'API error (500): x');
});

test('routing info extraction', () => {
  assert.deepEqual(extractRoutingInfo({ model: 'm', provider: 'Together' }), { model: 'm', provider: 'Together' });
  assert.equal(extractRoutingInfo({}), undefined);
});

test('findUnknownSlugs accepts base slugs of variant endpoints', () => {
  const eps = [{ slug: 'deepinfra/turbo', name: 'DeepInfra' }, { slug: 'together', name: 'Together' }];
  assert.deepEqual(findUnknownSlugs(['deepinfra', 'together', 'typo'], eps), ['typo']);
});

test('fetchModelProviderEndpoints is advisory and tolerant', async () => {
  const ok = (async () =>
    new Response(
      JSON.stringify({ data: { endpoints: [{ provider_name: 'Together', tag: 'together' }, { name: 'Deep Infra' }] } }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const eps = await fetchModelProviderEndpoints('openai/gpt-oss-120b', 'k', ok);
  assert.deepEqual(eps?.map((e) => e.slug), ['together', 'deep-infra']);

  const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchModelProviderEndpoints('a/b', undefined, notFound), undefined);
  const boom = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  assert.equal(await fetchModelProviderEndpoints('a/b', undefined, boom), undefined);
  assert.equal(await fetchModelProviderEndpoints('no-slash', undefined, ok), undefined);
});
