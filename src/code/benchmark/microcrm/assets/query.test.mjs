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

// Seed one contact with deals of known amounts/stages.
async function seed(base) {
  const c = await req(base, 'POST', '/contacts', { name: 'A', email: `a${Math.random().toString(36).slice(2)}@x.com` });
  const id = c.body.id;
  const deals = [
    { title: 'd1', amount: 100, stage: 'lead' },
    { title: 'd2', amount: 200, stage: 'qualified' },
    { title: 'd3', amount: 300, stage: 'won' },
    { title: 'd4', amount: 400, stage: 'won' },
  ];
  for (const d of deals) await req(base, 'POST', `/contacts/${id}/deals`, d);
  return id;
}

test('minAmount filters deals', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?minAmount=300');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 2);
    assert.ok(r.body.data.every((d) => d.amount >= 300));
  }));

test('maxAmount filters deals', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?maxAmount=200');
    assert.equal(r.body.total, 2);
    assert.ok(r.body.data.every((d) => d.amount <= 200));
  }));

test('minAmount + maxAmount form a range', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?minAmount=200&maxAmount=300');
    assert.deepEqual(r.body.data.map((d) => d.amount).sort((a, b) => a - b), [200, 300]);
  }));

test('sort=amount:desc orders descending', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?sort=amount:desc');
    assert.deepEqual(r.body.data.map((d) => d.amount), [400, 300, 200, 100]);
  }));

test('sort=amount:asc orders ascending', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?sort=amount:asc');
    assert.deepEqual(r.body.data.map((d) => d.amount), [100, 200, 300, 400]);
  }));

test('invalid sort field → 400', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?sort=banana:asc');
    assert.equal(r.status, 400);
  }));

test('filters combine with stage', () =>
  withServer(async (base) => {
    await seed(base);
    const r = await req(base, 'GET', '/deals?stage=won&minAmount=350');
    assert.equal(r.body.total, 1);
    assert.equal(r.body.data[0].amount, 400);
  }));

test('pagination returns hasMore and a full filtered total', () =>
  withServer(async (base) => {
    await seed(base);
    const page1 = await req(base, 'GET', '/deals?limit=2&offset=0&sort=amount:asc');
    assert.equal(page1.body.total, 4);
    assert.equal(page1.body.data.length, 2);
    assert.equal(page1.body.hasMore, true);
    const page2 = await req(base, 'GET', '/deals?limit=2&offset=2&sort=amount:asc');
    assert.equal(page2.body.hasMore, false);
  }));
