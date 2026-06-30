import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const STAGES = ['lead', 'qualified', 'won', 'lost'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      company TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'lead',
      created_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );
  `);

  const getContact = (id) => db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) ?? null;
  const getDeal = (id) => db.prepare('SELECT * FROM deals WHERE id = ?').get(id) ?? null;

  function validateContact(b, requireAll) {
    if (requireAll || b.name !== undefined) {
      if (typeof b.name !== 'string' || b.name.trim() === '') return 'name is required';
    }
    if (requireAll || b.email !== undefined) {
      if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) return 'a valid email is required';
    }
    return null;
  }
  function validateDeal(b, requireAll) {
    if (requireAll || b.title !== undefined) {
      if (typeof b.title !== 'string' || b.title.trim() === '') return 'title is required';
    }
    if (b.amount !== undefined) {
      if (typeof b.amount !== 'number' || Number.isNaN(b.amount) || b.amount < 0) return 'amount must be a number >= 0';
    }
    if (b.stage !== undefined) {
      if (!STAGES.includes(b.stage)) return 'invalid stage';
    }
    return null;
  }

  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid json')); }
      });
      req.on('error', reject);
    });

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method;

    try {
      if (parts[0] === 'contacts') {
        if (parts.length === 1 && method === 'POST') {
          let body;
          try { body = await readBody(req); } catch { return send(res, 400, { error: 'invalid json' }); }
          const err = validateContact(body, true);
          if (err) return send(res, 400, { error: err });
          try {
            const info = db
              .prepare('INSERT INTO contacts (name, email, company, created_at) VALUES (?, ?, ?, ?)')
              .run(body.name, body.email, body.company ?? null, new Date().toISOString());
            return send(res, 201, getContact(Number(info.lastInsertRowid)));
          } catch (e) {
            if (String(e.message).includes('UNIQUE')) return send(res, 409, { error: 'email already exists' });
            throw e;
          }
        }
        if (parts.length === 1 && method === 'GET') {
          const q = url.searchParams.get('q');
          const limit = Math.max(0, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50);
          const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
          let where = '';
          const args = [];
          if (q) { where = 'WHERE name LIKE ? OR email LIKE ?'; args.push('%' + q + '%', '%' + q + '%'); }
          const total = db.prepare(`SELECT COUNT(*) AS c FROM contacts ${where}`).get(...args).c;
          const data = db.prepare(`SELECT * FROM contacts ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...args, limit, offset);
          return send(res, 200, { data, total });
        }
        if (parts.length === 2) {
          const id = Number(parts[1]);
          const existing = getContact(id);
          if (method === 'GET') return existing ? send(res, 200, existing) : send(res, 404, { error: 'not found' });
          if (method === 'PATCH') {
            if (!existing) return send(res, 404, { error: 'not found' });
            let body;
            try { body = await readBody(req); } catch { return send(res, 400, { error: 'invalid json' }); }
            const err = validateContact(body, false);
            if (err) return send(res, 400, { error: err });
            const name = body.name ?? existing.name;
            const email = body.email ?? existing.email;
            const company = body.company !== undefined ? body.company : existing.company;
            try {
              db.prepare('UPDATE contacts SET name = ?, email = ?, company = ? WHERE id = ?').run(name, email, company, id);
            } catch (e) {
              if (String(e.message).includes('UNIQUE')) return send(res, 409, { error: 'email already exists' });
              throw e;
            }
            return send(res, 200, getContact(id));
          }
          if (method === 'DELETE') {
            if (!existing) return send(res, 404, { error: 'not found' });
            db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
            return send(res, 204);
          }
        }
        if (parts.length === 3 && parts[2] === 'deals') {
          const id = Number(parts[1]);
          const contact = getContact(id);
          if (!contact) return send(res, 404, { error: 'contact not found' });
          if (method === 'POST') {
            let body;
            try { body = await readBody(req); } catch { return send(res, 400, { error: 'invalid json' }); }
            const err = validateDeal(body, true);
            if (err) return send(res, 400, { error: err });
            const info = db
              .prepare('INSERT INTO deals (contact_id, title, amount, stage, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(id, body.title, body.amount ?? 0, body.stage ?? 'lead', new Date().toISOString());
            return send(res, 201, getDeal(Number(info.lastInsertRowid)));
          }
          if (method === 'GET') {
            const data = db.prepare('SELECT * FROM deals WHERE contact_id = ? ORDER BY id').all(id);
            return send(res, 200, { data, total: data.length });
          }
        }
      }

      if (parts[0] === 'deals') {
        if (parts.length === 2 && parts[1] === 'summary' && method === 'GET') {
          const summary = {};
          for (const s of STAGES) summary[s] = { count: 0, totalAmount: 0 };
          const rows = db
            .prepare('SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS totalAmount FROM deals GROUP BY stage')
            .all();
          for (const r of rows) summary[r.stage] = { count: r.count, totalAmount: r.totalAmount };
          return send(res, 200, { summary });
        }
        if (parts.length === 1 && method === 'GET') {
          const stage = url.searchParams.get('stage');
          let where = '';
          const args = [];
          if (stage) { where = 'WHERE stage = ?'; args.push(stage); }
          const data = db.prepare(`SELECT * FROM deals ${where} ORDER BY id`).all(...args);
          return send(res, 200, { data, total: data.length });
        }
        if (parts.length === 2 && method === 'PATCH') {
          const id = Number(parts[1]);
          const existing = getDeal(id);
          if (!existing) return send(res, 404, { error: 'not found' });
          let body;
          try { body = await readBody(req); } catch { return send(res, 400, { error: 'invalid json' }); }
          const err = validateDeal(body, false);
          if (err) return send(res, 400, { error: err });
          const title = body.title ?? existing.title;
          const amount = body.amount ?? existing.amount;
          const stage = body.stage ?? existing.stage;
          db.prepare('UPDATE deals SET title = ?, amount = ?, stage = ? WHERE id = ?').run(title, amount, stage, id);
          return send(res, 200, getDeal(id));
        }
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: 'internal error: ' + (e?.message || String(e)) });
    }
  };

  return http.createServer(handler);
}
