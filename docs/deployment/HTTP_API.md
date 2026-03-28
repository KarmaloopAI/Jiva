# Jiva HTTP & WebSocket API Reference

Jiva ships a full HTTP/WebSocket server for multi-tenant, cloud-native deployments (e.g. Cloud Run). All stateful agent sessions are backed by a `StorageProvider` — either a local filesystem or a GCS bucket.

**Start locally:**
```bash
npm run serve          # default port 8080
PORT=9000 npm run serve
```

**Cloud Run entry-point:** `src/interfaces/http/index.ts`

---

## Authentication

All `/api` routes require one of:

| Mode | Header |
|------|--------|
| JWT | `Authorization: Bearer <jwt>` |
| Auth-disabled (dev/Cloud Run with `AUTH_DISABLED=true`) | `x-tenant-id: <tenant>` (used as tenantId directly) |

Every authenticated request carries an implicit **session identity** — `tenantId` (from auth) and `sessionId` (from header or auto-generated). Sessions are isolated per `tenantId:sessionId` pair.

Optional session header: `x-session-id: <your-session-id>` (auto-generated UUID if omitted).

Health check endpoints (`/health`, `/health/ready`) are unauthenticated.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen host |
| `AUTH_DISABLED` | `false` | Skip JWT validation; use `x-tenant-id` header |
| `JIVA_STORAGE_PROVIDER` | auto | `local` or `gcp-bucket` |
| `JIVA_GCP_BUCKET` | — | GCS bucket name (required when `gcp-bucket`) |
| `MAX_CONCURRENT_SESSIONS` | `100` | Max simultaneous agent sessions |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | Session idle timeout (30 min) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `JIVA_CODE_MODE` | `false` | Use CodeAgent instead of DualAgent for all sessions |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |

---

## REST API

### Health

#### `GET /health`
Basic liveness check. Always returns `200` (no auth required).

```json
{ "status": "ok", "timestamp": "2026-03-28T10:00:00.000Z" }
```

#### `GET /health/ready`
Readiness check — verifies storage provider is reachable.

```json
{ "status": "ready", "storage": "GCPBucketProvider" }
```

---

### Sessions

#### `POST /api/session`
Create or restore a session. Returns session metadata.

**Response:**
```json
{
  "success": true,
  "session": {
    "sessionId": "abc123",
    "tenantId": "my-tenant",
    "createdAt": "2026-03-28T10:00:00.000Z",
    "lastActivityAt": "2026-03-28T10:00:00.000Z",
    "messageCount": 0,
    "status": "active"
  }
}
```

#### `GET /api/session/:sessionId`
Get info for an existing session. Returns `404` if not found.

#### `GET /api/sessions`
List all active sessions for the authenticated tenant.

```json
{
  "success": true,
  "sessions": [ { ...SessionInfo }, ... ],
  "count": 2
}
```

#### `DELETE /api/session/:sessionId`
Destroy a session and persist its final state. Clears in-memory state and cancels the idle timer.

#### `GET /api/stats`
Aggregate session stats across all tenants (admin use).

```json
{
  "success": true,
  "stats": { "total": 5, "byTenant": { "tenant-a": 3, "tenant-b": 2 } }
}
```

---

### Chat

#### `POST /api/chat`
Send a message to the agent. Waits for the full response (synchronous).

**Request:**
```json
{ "message": "What files are in the workspace?" }
```

**Response:**
```json
{
  "success": true,
  "response": "The workspace contains...",
  "iterations": 3,
  "toolsUsed": ["read_file", "glob"],
  "plan": { "subtasks": [...], "reasoning": "..." }
}
```
`plan` is only present in DualAgent mode.

#### `POST /api/chat/stream`
Same as `/api/chat` but uses **Server-Sent Events (SSE)** to stream status updates.

**Response content-type:** `text/event-stream`

**Events emitted in order:**
```
event: status
data: {"message":"Processing request..."}

event: response
data: {"content":"...","iterations":3,"toolsUsed":[...]}

event: done
data: {"success":true}
```

On error:
```
event: error
data: {"message":"..."}
```

**Example (curl):**
```bash
curl -N -X POST https://your-host/api/chat/stream \
  -H "x-tenant-id: my-tenant" \
  -H "Content-Type: application/json" \
  -d '{"message": "List all TypeScript files"}'
```

#### `POST /api/chat/stop`
Stop an ongoing agent turn. The agent finishes its current model call / tool execution, then exits the loop and returns `[Task stopped by user]` to the caller.

Safe to call mid-stream or concurrently with a running `/api/chat` request.

**Response:**
```json
{ "success": true, "message": "Stop signal sent — agent will halt after current step" }
```

Returns `404` if there is no active session for the tenant/session pair.

#### `GET /api/chat/history`
Return the full in-memory conversation history for the current session.

```json
{
  "success": true,
  "history": [ { "role": "user", "content": "..." }, ... ],
  "count": 6
}
```

#### `DELETE /api/chat/history`
Clear conversation history by destroying and recreating the session.

---

## WebSocket API

Connect at `ws[s]://<host>/ws?token=<jwt>` (or pass token via `Authorization` header on the upgrade request).

### Client → Server Messages

| `type` | Fields | Description |
|--------|--------|-------------|
| `message` | `content: string` | Send a chat message |
| `ping` | — | Keepalive ping |
| `stop` | — | Stop the current agent turn (cooperative) |

**Examples:**
```json
{ "type": "message", "content": "Analyse this codebase" }
{ "type": "ping" }
{ "type": "stop" }
```

### Server → Client Messages

| `type` | Fields | Description |
|--------|--------|-------------|
| `status` | `message: string`, optional `sessionInfo` | Connection status, session ready, stop ack |
| `response` | `content`, `iterations`, `toolsUsed`, optional `plan` | Agent's final response |
| `error` | `message: string` | Processing or auth error |
| `pong` | — | Ping reply |

**Connection flow:**
1. Upgrade → auth validated
2. `status: "Connected to Jiva"`
3. `status: "Session ready"` (with `sessionInfo`)
4. Send `{ type: "message", content: "..." }`
5. Receive `status: "Processing..."`
6. Receive `response: { content, iterations, toolsUsed }`

### Heartbeat
The server pings all clients every 30 seconds. Dead connections (no `pong` within 30 s) are terminated automatically.

**Example (Node.js):**
```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080/ws?token=YOUR_JWT');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'message', content: 'Hello Jiva!' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'response') console.log('Agent:', msg.content);
});

// To stop a running turn:
ws.send(JSON.stringify({ type: 'stop' }));
```

---

## Tenant Configuration

Jiva reads per-tenant model configuration from the storage provider at session start. For GCS, the layout is:

```
gs://<JIVA_GCP_BUCKET>/
  <tenantId>/
    config.json          ← model config (see below)
    jiva-directive.md    ← optional workspace directive
    conversations/       ← auto-saved conversation history
```

**`config.json` example:**
```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.sarvam.ai/v1/chat/completions",
      "apiKey": "your-key",
      "model": "sarvam-105b",
      "type": "reasoning",
      "useHarmonyFormat": false,
      "reasoningEffortStrategy": "api_param",
      "defaultMaxTokens": 8192
    },
    "multimodal": {
      "endpoint": "https://cloud.olakrutrim.com/v1/chat/completions",
      "apiKey": "your-key",
      "model": "Ola-S1-Pro",
      "type": "multimodal"
    }
  }
}
```

See [`docs/guides/CONFIGURATION.md`](../guides/CONFIGURATION.md) for the full configuration schema and [`docs/deployment/CLOUD_RUN_DEPLOYMENT.md`](./CLOUD_RUN_DEPLOYMENT.md) for Cloud Run setup.

---

## Stopping a Running Agent

An agent turn can be stopped cooperatively from any interface:

| Interface | How |
|-----------|-----|
| **REST** | `POST /api/chat/stop` |
| **WebSocket** | Send `{ "type": "stop" }` |
| **CLI** | Press **Ctrl+C** once while the agent is running |

The stop is *cooperative* — the agent finishes the current model call (or tool execution) before exiting. This ensures no half-written files or dangling state. The response content will be `[Task stopped by user]`. The agent resets automatically for the next `chat()` call.
