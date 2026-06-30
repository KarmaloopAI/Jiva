/**
 * The micro-CRM specification handed to the agent. It pins the exact module
 * contract the hidden test suite depends on (entry file, exported factory, the
 * built-in `node:http` + `node:sqlite` stack) and then enumerates every endpoint
 * with its status codes and response shapes. Ambiguity here would unfairly fail a
 * competent model, so the spec mirrors the test expectations precisely.
 */

export const MICROCRM_SPEC = `Build a small REST API for a "micro CRM" using ONLY Node.js built-in modules — no npm install, no external packages.

STACK (mandatory):
- HTTP server: the built-in \`node:http\` module.
- Database: the built-in \`node:sqlite\` module (import { DatabaseSync } from 'node:sqlite').
- The project is an ES module (package.json has "type": "module").

MODULE CONTRACT (the test suite imports exactly this):
- Create the file src/app.js.
- Export a function: \`export function createApp(dbPath = ':memory:')\`.
- createApp must create the database (initialise the schema if needed) and return a
  Node http.Server created with http.createServer(handler). DO NOT call .listen() —
  the caller starts it. Each call to createApp uses its own database connection.
- All request and response bodies are JSON. Always set Content-Type: application/json
  (except for 204 responses, which have no body).

DATA MODEL:
- contact: { id (auto int), name (string, required, non-empty), email (string, required,
  unique, must look like an email), company (string or null), created_at (ISO string) }
- deal: { id (auto int), contact_id (int), title (string, required, non-empty),
  amount (number >= 0, default 0), stage (one of "lead" | "qualified" | "won" | "lost",
  default "lead"), created_at (ISO string) }

ENDPOINTS:

Contacts:
- POST /contacts → create. 201 with the created contact. 400 if name or email missing/invalid.
  409 if the email already exists. 400 if the request body is not valid JSON.
- GET /contacts → 200 with { data: [...contacts], total }. Supports:
    ?q=<text>   case-insensitive substring match on name OR email
    ?limit=&?offset=   pagination; "total" is the FULL count ignoring limit/offset.
- GET /contacts/:id → 200 with the contact, or 404.
- PATCH /contacts/:id → partial update (any subset of name/email/company). 200 with the
  updated contact. 404 if not found. 400 if a provided field is invalid. 409 if the new
  email belongs to another contact.
- DELETE /contacts/:id → 204 (no body), or 404. Deleting a contact also deletes its deals.

Deals:
- POST /contacts/:id/deals → create a deal for that contact. 201 with the created deal
  (stage defaults to "lead", amount defaults to 0). 404 if the contact does not exist.
  400 if title is missing, amount is negative, or stage is not one of the four allowed values.
- GET /contacts/:id/deals → 200 with { data: [...deals], total } for that contact only.
- GET /deals → 200 with { data: [...deals], total }. Supports ?stage=<stage> to filter.
- GET /deals/summary → 200 with { summary: { lead: { count, totalAmount }, qualified: {...},
  won: {...}, lost: {...} } } — every stage present, zeros when there are no deals.
- PATCH /deals/:id → partial update (title/amount/stage). 200 with the updated deal, or 404.
  400 on invalid amount/stage.

Anything else (unknown path) → 404 with a JSON body.

GOAL: make the hidden test suite in test/api.test.mjs pass. Run it with: node --test
Do NOT modify anything under test/. Implement everything in src/.`;

/**
 * The extend tasks scaffold a WORKING base API (src/app.js) and ask the agent to add
 * one harder feature. Each prompt pins the precise contract its hidden test depends on.
 */
const EXTEND_PREAMBLE =
  'src/app.js already contains a working micro-CRM REST API (contacts + deals) built on ' +
  'node:http + node:sqlite, exporting createApp(dbPath). Extend it — do not rewrite it, and ' +
  'keep all existing behaviour working. Run the tests with: node --test. Do NOT modify test/.';

export const MICROCRM_BULK_SPEC = `${EXTEND_PREAMBLE}

Add an ATOMIC bulk deal endpoint:
- POST /contacts/:id/deals/bulk with body { deals: [ { title, amount?, stage? }, ... ] }.
- 404 if the contact does not exist.
- 400 if "deals" is missing, not an array, or empty.
- Validate every deal with the same rules as a single deal (title required & non-empty,
  amount a number >= 0, stage one of lead/qualified/won/lost). If ANY item is invalid,
  respond 400 and insert NOTHING (the operation must be all-or-nothing / atomic).
- On success → 201 with { data: [...createdDeals], total }. Each created deal applies the
  same defaults as the single-deal endpoint (stage "lead", amount 0).
Make test/bulk.test.mjs pass.`;

export const MICROCRM_QUERY_SPEC = `${EXTEND_PREAMBLE}

Upgrade GET /deals with filtering, sorting and pagination metadata:
- ?minAmount= and ?maxAmount= filter by amount (inclusive). A non-numeric value → 400.
- ?stage= filters by stage (already supported); all filters combine with AND.
- ?sort=<field>:<dir> where field is one of amount | created_at | id and dir is asc | desc.
  Any other field or direction → 400. Default order is by id ascending.
- ?limit= and ?offset= paginate. The response is { data, total, hasMore } where "total" is
  the FULL count of rows matching the filters (ignoring limit/offset) and "hasMore" is true
  when there are more rows after the current page (offset + data.length < total).
Make test/query.test.mjs pass.`;

export const MICROCRM_STATS_SPEC = `${EXTEND_PREAMBLE}

Add a per-contact analytics endpoint:
- GET /contacts/:id/stats → 404 if the contact does not exist, else 200 with:
  { totalDeals, totalValue, wonValue, winRate, weightedPipeline }
  where:
    - totalDeals  = number of deals for the contact
    - totalValue  = sum of all deal amounts
    - wonValue    = sum of amounts of deals whose stage is "won"
    - winRate     = wonDeals / totalDeals (0 when there are no deals), rounded to 4 decimals
    - weightedPipeline = sum over deals of amount * P(stage), rounded to 2 decimals, where
      P = { lead: 0.1, qualified: 0.4, won: 1.0, lost: 0.0 }
  A contact with no deals returns all zeros.
Make test/stats.test.mjs pass.`;

export const MICROCRM_IDEMPOTENCY_SPEC = `${EXTEND_PREAMBLE}

Add idempotency to contact creation via the "Idempotency-Key" request header:
- POST /contacts with an Idempotency-Key header: the FIRST request with a given key creates
  the contact as normal (201) and remembers the key.
- A REPEAT request with the SAME key must NOT create a duplicate — return the originally
  created contact with status 200 (even if the new request body differs; do not validate or
  conflict-check it).
- Different keys create different contacts. Requests with no Idempotency-Key behave exactly
  as before (each creates a contact). The key store may be in-memory (per createApp instance).
Make test/idempotency.test.mjs pass.`;
