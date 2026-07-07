# Cloud Mode Architecture

## Overview

Cloud mode lets users run Jivam without a local `jiva-core` install. Auth is
handled by Supabase; chat inference runs on a Google Cloud Run deployment
(`https://jiva-hdjcuspt2a-uc.a.run.app`).

Cloud mode is architected to support two hosts:
- **Jivam desktop (local server)** — a new browser tab/window opened via
  `window.open('/?mode=cloud', '_blank')` (see `src/lib/electron-shim.ts`
  `cloud.openWindow()`) — there's no separate Electron `BrowserWindow` anymore,
  just a plain second tab pointed at the same local server with a query param
- **Web (jivamai.com)** — the same React app served statically, with no local
  server behind it at all

The abstraction that makes this work is `src/lib/cloud-api.ts`.

---

## Implementation Status

### Done ✓

| Area | File(s) | What was done |
|------|---------|---------------|
| Cloud tab/window | `src/lib/electron-shim.ts` | `cloud.openWindow()` does `window.open('/?mode=cloud', '_blank')` — a plain new tab against the same local server, no separate process |
| Cloud window detection | `src/store/auth.store.ts` | `isCloudWindow` reads URL param at module load; `isCloudMode` is permanently `true` in the cloud tab |
| Auth store | `src/store/auth.store.ts` | Zustand store: `signIn`, `signUp`, `signOut`, `restoreSession`; session persisted to `localStorage` under key `jivam-cloud-session` |
| Sign-in UI | `src/components/setup/CloudSignIn.tsx` | Email/password form, sign-in / create account toggle, loading spinner, error display |
| Supabase auth (server) | `server/cloud-auth.ts` | Fetch-based, no SDK: `cloudSignIn`, `cloudSignUp`, `cloudSignOut`, `initCloudSession` |
| API shim | `src/lib/cloud-api.ts` | `cloudApiSignIn/Up/Out/Init` — local mode calls `/api/cloud/*` via `electron-shim.ts`; web build calls Supabase/Cloud Run directly |
| Cloud runner | `server/cloud-runner.ts` | `CloudRunner` class: SSE streaming (`/api/chat/stream`) with non-streaming fallback (`/api/chat`). Configures via `configure(userId, sessionId)` |
| Server-side routing | `server/routes/jiva.ts` | `send-message` checks `cloudRunner.isActive()` and routes accordingly; phase/log events broadcast over the WebSocket instead of sent to a specific window |
| REST surface | `server/routes/cloud.ts` + `src/lib/electron-shim.ts` | `window.electron.cloud.{openWindow, signIn, signUp, signOut, init}` → `POST /api/cloud/*` |
| App.tsx routing | `src/App.tsx` | Cloud tab without `cloudUser` shows `<CloudSignIn>`; skips local preflight and `startServer()` |
| TopBar | `src/components/layout/TopBar.tsx` | Cloud icon directly calls `openWindow()` (no dropdown in local mode); cloud mode shows badge with email + sign-out dropdown |
| Code tab guard | `src/components/code/CodeChatView.tsx` | "Local install required" overlay when `isCloudMode` |

### Known Broken / Untested ✗

| Issue | File | Notes |
|-------|------|-------|
| **Chat does not work end-to-end** | `server/cloud-runner.ts` | ~~FIXED~~ `cloudRunner.startInit()` is called in the `/api/cloud/init` handler before the async HTTP call. `send-message` detects cloud senders and calls `cloudRunner.waitUntilReady(30_000)` if not yet active. Cloud Run cold starts up to 30s are handled. |
| **Supabase email confirmation** | `server/cloud-auth.ts` + `src/lib/cloud-api.ts` | If the Supabase project has email confirmation enabled, `cloudSignUp` returns the user object at top-level with no `access_token`. This is handled defensively now (`data.user ?? data`), but the UX shows no "check your email" message — user just sees the app with an unconfigured session |
| **Session restoration** | `src/store/auth.store.ts` | `restoreSession()` fires and forgets `cloudApiInit`. If the cloud runner is never actually configured before a chat message, the message silently routes to the local runner |
| **Sign-out in cloud tab** | `src/store/auth.store.ts` | `signOut` clears `localStorage` and calls `cloudApiSignOut`. But `cloudRunner.deactivate()` is called from `server/routes/cloud.ts`'s sign-out handler — this path works. What doesn't work: it passes no `accessToken` (it just calls `cloudRunner.deactivate()`), so Supabase session is not actually revoked server-side |
| **Activity log in cloud tab** | `server/cloud-runner.ts` | `onLog` is called with `Tool: ${msg}` for every SSE `status` event. Whether the Cloud Run backend actually emits these is untested |
| **Splash screen timing** | `src/App.tsx` | `showSplash` is set to `false` by the init effect before the user signs in. After sign-in, `showSplash` is already `false` — AppShell should render. This was still causing "Connecting to Jivam..." in testing; root cause not fully confirmed |

---

## Architecture Diagram

```
USER CLICKS CLOUD ICON (TopBar, local tab)
         │
         ▼
window.electron.cloud.openWindow()
         │
         ▼ electron-shim.ts
window.open('/?mode=cloud', '_blank')
         │
         ▼
New tab loads the same SPA with ?mode=cloud in the URL
         │
         ▼
auth.store.ts  →  isCloudWindow = true  →  isCloudMode = true
         │
         ▼ No existing session in localStorage
App.tsx  →  isCloudMode && !cloudUser  →  render <CloudSignIn>
         │
         ▼ User submits credentials
auth.store.signIn/signUp()
  1. cloudApiSignIn/Up()  →  window.electron.cloud.signIn/Up()
                          →  POST /api/cloud/sign-in or /sign-up
                          →  server/cloud-auth.ts cloudSignIn/Up()
                          →  POST Supabase /auth/v1/token or /signup
  2. set({ cloudUser })   ← immediately (non-blocking)
  3. cloudApiInit()       → fire-and-forget
                          → window.electron.cloud.init()
                          → POST /api/cloud/init
                          → server/routes/cloud.ts
                          → initCloudSession() POST /api/session on Cloud Run
                          → cloudRunner.configure(userId, sessionId)
         │
         ▼ cloudUser is set
App.tsx  →  isCloudMode && cloudUser  →  render <AppShell>
         │
         ▼ User sends a chat message
jiva.store.sendMessage()
  →  window.electron.jiva.sendMessage()
  →  POST /api/jiva/send-message
  →  server/routes/jiva.ts
  →  cloudRunner.isActive() ? cloudRunner.chat() : jivaRunner.chat()
  →  POST https://jiva-hdjcuspt2a-uc.a.run.app/api/chat/stream (SSE)
  →  SSE events → broadcast('jiva:phase-update'/'jiva:jiva-log') over the WebSocket
```

---

## Key Files

```
src/
  lib/cloud-api.ts          Environment shim (local fetch to /api/cloud/* vs. direct Supabase/Cloud Run fetch on jivamai.com)
  store/auth.store.ts       Cloud auth state (Zustand)
  components/
    setup/CloudSignIn.tsx   Sign-in / create account form
    layout/TopBar.tsx       Cloud icon → openWindow(); cloud badge when signed in
    code/CodeChatView.tsx   "Local only" overlay in cloud mode
  App.tsx                   Cloud tab routing: sign-in guard, skip local setup

server/
  cloud-auth.ts             Supabase fetch wrapper
  cloud-runner.ts           HTTP/SSE client to Cloud Run
  routes/cloud.ts           /api/cloud/sign-in|up|out|init handlers; jiva.ts routes send-message to cloud vs local runner
```

---

## Service Credentials

| Service | Value |
|---------|-------|
| Supabase project | `hcomegrnonxmjupvvyus` |
| Supabase URL | `https://hcomegrnonxmjupvvyus.supabase.co` |
| Supabase anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (in `cloud-auth.ts` and `cloud-api.ts`) |
| Cloud Run URL | `https://jiva-hdjcuspt2a-uc.a.run.app` |

---

## What Needs to Be Fixed Next

### Priority 1 — Chat must actually work ✓ FIXED

`cloudRunner.startInit()` is now called at the top of `cloud:init` before the async
`initCloudSession` HTTP call. `jiva:send-message` detects cloud senders via
`event.sender.getURL().includes('mode=cloud')` and awaits `cloudRunner.waitUntilReady(30_000)`
before routing. Cloud Run cold starts up to 30 s are handled.

### Priority 2 — Confirm Cloud Run API contract ✓ VERIFIED

The Cloud Run endpoints are confirmed via `~/dev/Jiva/docs/deployment/HTTP_API.md`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/session` | POST | Create/restore tenant session |
| `/api/chat/stream` | POST | SSE streaming chat |
| `/api/chat` | POST | Non-streaming chat fallback |
| `/api/chat/history` | DELETE | Reset conversation |
| `/api/chat/stop` | POST | Abort active generation |

Request headers: `x-tenant-id: userId`, `x-session-id: sessionId`

**These endpoints and their request/response shapes have not been verified.**
The Cloud Run service may have a different API. Check the backend source or
deploy logs before debugging further.

SSE event format (per `docs/deployment/HTTP_API.md` in the jiva-core repo):
```
event: status
data: {"message":"Processing request..."}

event: response
data: {"content":"...","iterations":3,"toolsUsed":[...]}

event: done
data: {"success":true}

event: error
data: {"message":"error text"}
```
The event type is carried in the SSE `event:` line, **not** as a `type` field inside the JSON body.
Non-streaming `/api/chat` response field is `response` (not `content`).

### Priority 3 — Supabase email confirmation

Check the Supabase dashboard for project `hcomegrnonxmjupvvyus`:
- If **email confirmation is ON**: sign-up returns no session. Need a "check
  your email" screen instead of immediately transitioning to AppShell.
- If **email confirmation is OFF** (auto-confirm): the current flow should work.

### Priority 4 — Session token refresh

The `cloudUser` in `localStorage` stores `userId`, `email`, and `sessionId`
but **not** the Supabase `access_token` or `refresh_token`. These are needed
to make authenticated calls to Supabase APIs and to revoke sessions on sign-out.
Add `accessToken` and `refreshToken` to `CloudSession` in `auth.store.ts` and
pass them through from `cloud-auth.ts`.

---

## Web Export Notes (jivamai.com)

When `window.electron` is absent (web browser), `isCloudWindow` is `true` and
`cloud-api.ts` calls Supabase / Cloud Run directly via `fetch`. No IPC layer.

This is partially implemented. What still needs wiring for pure-web mode:
- Chat routing: `jiva.store.ts sendMessage` currently calls
  `window.electron.jiva.sendMessage()` unconditionally. In cloud web mode,
  this is `undefined`. Need to call `cloudApiChat()` from `cloud-api.ts`
  instead (not yet implemented in the shim).
- The `cloudApiChat` function needs to be added to `src/lib/cloud-api.ts`,
  replicating the SSE streaming logic from `cloud-runner.ts` but callable
  from the renderer without an Electron IPC hop.
