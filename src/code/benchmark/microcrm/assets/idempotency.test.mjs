import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(run) {
  const server = createApp(':memory:');
  await new Promise((res) => server.listen(0, res));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); } finally { await new Promise((res) => server.close(res)); }
}
async function req(base, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json };
}
const mkContact = (over = {}) => ({ name: 'A', email: `a${Math.random().toString(36).slice(2)}@x.com`, ...over });

test('repeating a POST with the same Idempotency-Key does not create a duplicate', () =>
  withServer(async (base) => {
    const c = mkContact();
    const first = await req(base, 'POST', '/contacts', c, { 'idempotency-key': 'abc' });
    assert.equal(first.status, 201);
    const second = await req(base, 'POST', '/contacts', c, { 'idempotency-key': 'abc' });
    assert.equal(second.body.id, first.body.id);
    const list = await req(base, 'GET', '/contacts');
    assert.equal(list.body.total, 1);
  }));

test('replay with the same key returns 200 (not a new 201)', () =>
  withServer(async (base) => {
    const c = mkContact();
    await req(base, 'POST', '/contacts', c, { 'idempotency-key': 'k1' });
    const replay = await req(base, 'POST', '/contacts', c, { 'idempotency-key': 'k1' });
    assert.equal(replay.status, 200);
  }));

test('different keys create different contacts', () =>
  withServer(async (base) => {
    await req(base, 'POST', '/contacts', mkContact(), { 'idempotency-key': 'k1' });
    await req(base, 'POST', '/contacts', mkContact(), { 'idempotency-key': 'k2' });
    const list = await req(base, 'GET', '/contacts');
    assert.equal(list.body.total, 2);
  }));

test('no key behaves normally — each POST creates', () =>
  withServer(async (base) => {
    await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', '/contacts', mkContact());
    const list = await req(base, 'GET', '/contacts');
    assert.equal(list.body.total, 2);
  }));

test('replayed key returns the original even if the body changed (no 409)', () =>
  withServer(async (base) => {
    const original = mkContact();
    const first = await req(base, 'POST', '/contacts', original, { 'idempotency-key': 'same' });
    const replay = await req(base, 'POST', '/contacts', mkContact(), { 'idempotency-key': 'same' });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, first.body.id);
    assert.equal(replay.body.email, original.email);
  }));
