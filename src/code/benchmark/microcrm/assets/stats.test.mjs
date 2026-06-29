import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(run) {
  const server = createApp(':memory:');
  await new Promise((res) => server.listen(0, res));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); } finally { await new Promise((res) => server.close(res)); }
}
async function req(base, method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json };
}
const mkContact = () => ({ name: 'A', email: `a${Math.random().toString(36).slice(2)}@x.com` });

test('stats for unknown contact → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'GET', '/contacts/99999/stats');
    assert.equal(r.status, 404);
  }));

test('stats for a contact with no deals are all zero', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'GET', `/contacts/${c.body.id}/stats`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { totalDeals: 0, totalValue: 0, wonValue: 0, winRate: 0, weightedPipeline: 0 });
  }));

test('totalValue and wonValue sum the right deals', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const id = c.body.id;
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'a', amount: 100, stage: 'won' });
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'b', amount: 50, stage: 'lead' });
    const r = await req(base, 'GET', `/contacts/${id}/stats`);
    assert.equal(r.body.totalDeals, 2);
    assert.equal(r.body.totalValue, 150);
    assert.equal(r.body.wonValue, 100);
  }));

test('winRate is won deals over total deals', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const id = c.body.id;
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'a', amount: 10, stage: 'won' });
    for (const s of ['lead', 'qualified', 'lost']) await req(base, 'POST', `/contacts/${id}/deals`, { title: s, amount: 10, stage: s });
    const r = await req(base, 'GET', `/contacts/${id}/stats`);
    assert.equal(r.body.winRate, 0.25); // 1 of 4
  }));

test('weightedPipeline applies per-stage probabilities (lead .1, qualified .4, won 1, lost 0)', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const id = c.body.id;
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'l', amount: 100, stage: 'lead' });       // 10
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'q', amount: 100, stage: 'qualified' });  // 40
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'w', amount: 100, stage: 'won' });        // 100
    await req(base, 'POST', `/contacts/${id}/deals`, { title: 'x', amount: 100, stage: 'lost' });       // 0
    const r = await req(base, 'GET', `/contacts/${id}/stats`);
    assert.equal(r.body.weightedPipeline, 150);
  }));
