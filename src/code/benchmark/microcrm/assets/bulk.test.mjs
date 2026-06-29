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

test('bulk create inserts all deals (201) and returns them', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals/bulk`, { deals: [{ title: 'a', amount: 1 }, { title: 'b', amount: 2 }, { title: 'c' }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.length, 3);
    assert.equal(r.body.total, 3);
  }));

test('bulk for unknown contact → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts/99999/deals/bulk', { deals: [{ title: 'a' }] });
    assert.equal(r.status, 404);
  }));

test('bulk with empty array → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals/bulk`, { deals: [] });
    assert.equal(r.status, 400);
  }));

test('bulk with non-array deals → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals/bulk`, { deals: 'nope' });
    assert.equal(r.status, 400);
  }));

test('bulk with one invalid item → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals/bulk`, { deals: [{ title: 'ok' }, { title: '' }] });
    assert.equal(r.status, 400);
  }));

test('bulk is atomic — an invalid item inserts NOTHING', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', `/contacts/${c.body.id}/deals/bulk`, { deals: [{ title: 'ok', amount: 10 }, { title: 'bad', amount: -1 }] });
    const list = await req(base, 'GET', `/contacts/${c.body.id}/deals`);
    assert.equal(list.body.total, 0);
  }));
