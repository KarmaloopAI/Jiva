import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Each test gets a fresh in-memory app on an ephemeral port, so tests are
// independent and a partial implementation still passes the subset it supports.
async function withServer(run) {
  const server = createApp(':memory:');
  await new Promise((res) => server.listen(0, res));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((res) => server.close(res));
  }
}

async function req(base, method, path, body, raw) {
  const init = { method, headers: {} };
  if (raw !== undefined) { init.headers['content-type'] = 'application/json'; init.body = raw; }
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json };
}

const mkContact = (over = {}) => ({ name: 'Ada Lovelace', email: `ada${Math.random().toString(36).slice(2)}@example.com`, company: 'Analytical', ...over });

// ── Contacts: create & validation ─────────────────────────────────────────────
test('POST /contacts creates a contact (201) with id and created_at', () =>
  withServer(async (base) => {
    const c = mkContact();
    const r = await req(base, 'POST', '/contacts', c);
    assert.equal(r.status, 201);
    assert.ok(Number.isInteger(r.body.id));
    assert.equal(r.body.name, c.name);
    assert.equal(r.body.email, c.email);
    assert.ok(typeof r.body.created_at === 'string' && r.body.created_at.length > 0);
  }));

test('POST /contacts without name → 400', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts', { email: 'x@y.com' });
    assert.equal(r.status, 400);
  }));

test('POST /contacts without email → 400', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts', { name: 'No Email' });
    assert.equal(r.status, 400);
  }));

test('POST /contacts with malformed email → 400', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts', { name: 'Bad', email: 'not-an-email' });
    assert.equal(r.status, 400);
  }));

test('POST /contacts with duplicate email → 409', () =>
  withServer(async (base) => {
    const c = mkContact();
    assert.equal((await req(base, 'POST', '/contacts', c)).status, 201);
    const r = await req(base, 'POST', '/contacts', c);
    assert.equal(r.status, 409);
  }));

test('POST /contacts with malformed JSON body → 400', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts', undefined, '{ not json');
    assert.equal(r.status, 400);
  }));

// ── Contacts: read ─────────────────────────────────────────────────────────────
test('GET /contacts/:id returns the contact (200)', () =>
  withServer(async (base) => {
    const created = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'GET', `/contacts/${created.body.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, created.body.id);
  }));

test('GET /contacts/:id unknown → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'GET', '/contacts/99999');
    assert.equal(r.status, 404);
  }));

test('GET /contacts returns { data, total }', () =>
  withServer(async (base) => {
    await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'GET', '/contacts');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.equal(r.body.total, 2);
    assert.equal(r.body.data.length, 2);
  }));

test('GET /contacts?q= filters by name or email substring', () =>
  withServer(async (base) => {
    await req(base, 'POST', '/contacts', mkContact({ name: 'Grace Hopper', email: 'grace@navy.mil' }));
    await req(base, 'POST', '/contacts', mkContact({ name: 'Alan Turing', email: 'alan@bletchley.uk' }));
    const r = await req(base, 'GET', '/contacts?q=Hopper');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.data[0].name, 'Grace Hopper');
  }));

test('GET /contacts?limit=&offset= paginates while total reflects the full count', () =>
  withServer(async (base) => {
    for (let i = 0; i < 5; i++) await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'GET', '/contacts?limit=2&offset=0');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
    assert.equal(r.body.total, 5);
  }));

// ── Contacts: update & delete ──────────────────────────────────────────────────
test('PATCH /contacts/:id updates a field (200)', () =>
  withServer(async (base) => {
    const created = await req(base, 'POST', '/contacts', mkContact({ company: 'Old' }));
    const r = await req(base, 'PATCH', `/contacts/${created.body.id}`, { company: 'New Co' });
    assert.equal(r.status, 200);
    assert.equal(r.body.company, 'New Co');
  }));

test('PATCH /contacts/:id to an existing email → 409', () =>
  withServer(async (base) => {
    const a = await req(base, 'POST', '/contacts', mkContact());
    const b = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'PATCH', `/contacts/${b.body.id}`, { email: a.body.email });
    assert.equal(r.status, 409);
  }));

test('PATCH /contacts/:id unknown → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'PATCH', '/contacts/99999', { company: 'x' });
    assert.equal(r.status, 404);
  }));

test('DELETE /contacts/:id → 204 then GET → 404', () =>
  withServer(async (base) => {
    const created = await req(base, 'POST', '/contacts', mkContact());
    const del = await req(base, 'DELETE', `/contacts/${created.body.id}`);
    assert.equal(del.status, 204);
    const r = await req(base, 'GET', `/contacts/${created.body.id}`);
    assert.equal(r.status, 404);
  }));

test('DELETE /contacts/:id unknown → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'DELETE', '/contacts/99999');
    assert.equal(r.status, 404);
  }));

// ── Deals ──────────────────────────────────────────────────────────────────────
test('POST /contacts/:id/deals creates a deal (201) defaulting stage to "lead"', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'Big deal', amount: 1000 });
    assert.equal(r.status, 201);
    assert.equal(r.body.stage, 'lead');
    assert.equal(r.body.amount, 1000);
    assert.equal(r.body.contact_id, c.body.id);
  }));

test('POST deal for unknown contact → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'POST', '/contacts/99999/deals', { title: 'x' });
    assert.equal(r.status, 404);
  }));

test('POST deal without title → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals`, { amount: 10 });
    assert.equal(r.status, 400);
  }));

test('POST deal with invalid stage → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'x', stage: 'banana' });
    assert.equal(r.status, 400);
  }));

test('POST deal with negative amount → 400', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const r = await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'x', amount: -5 });
    assert.equal(r.status, 400);
  }));

test('GET /contacts/:id/deals lists only that contact’s deals', () =>
  withServer(async (base) => {
    const a = await req(base, 'POST', '/contacts', mkContact());
    const b = await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', `/contacts/${a.body.id}/deals`, { title: 'A1' });
    await req(base, 'POST', `/contacts/${a.body.id}/deals`, { title: 'A2' });
    await req(base, 'POST', `/contacts/${b.body.id}/deals`, { title: 'B1' });
    const r = await req(base, 'GET', `/contacts/${a.body.id}/deals`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
  }));

test('GET /deals?stage= filters by stage', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'won1', stage: 'won', amount: 100 });
    await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'lead1', stage: 'lead' });
    const r = await req(base, 'GET', '/deals?stage=won');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].stage, 'won');
  }));

test('PATCH /deals/:id updates the stage (200)', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    const d = await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'x', stage: 'lead' });
    const r = await req(base, 'PATCH', `/deals/${d.body.id}`, { stage: 'won' });
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, 'won');
  }));

test('GET /deals/summary aggregates count and totalAmount per stage', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'w1', stage: 'won', amount: 100 });
    await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'w2', stage: 'won', amount: 250 });
    const r = await req(base, 'GET', '/deals/summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.summary.won.count, 2);
    assert.equal(r.body.summary.won.totalAmount, 350);
    assert.equal(r.body.summary.lead.count, 0);
  }));

test('DELETE contact cascades to its deals', () =>
  withServer(async (base) => {
    const c = await req(base, 'POST', '/contacts', mkContact());
    await req(base, 'POST', `/contacts/${c.body.id}/deals`, { title: 'd1', stage: 'won', amount: 10 });
    await req(base, 'DELETE', `/contacts/${c.body.id}`);
    const r = await req(base, 'GET', '/deals');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 0);
  }));

test('unknown route → 404', () =>
  withServer(async (base) => {
    const r = await req(base, 'GET', '/nope');
    assert.equal(r.status, 404);
  }));
