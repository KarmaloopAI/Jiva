# Cloud Mode Architecture

## Overview

Cloud mode lets users run Jivam without a local `jiva-core` install. Auth is
handled by Supabase; chat inference runs on a Google Cloud Run deployment
(`https://jiva-hdjcuspt2a-uc.a.run.app`).

Cloud mode is architected to support two hosts:
- **Electron desktop** — a separate `BrowserWindow` loaded with `?mode=cloud`
- **Web (jivamai.com)** — the same React app served statically, no Electron layer

The abstraction that makes this work is `src/lib/cloud-api.ts`.

---

## Implementation Status

### Done ✓

| Area | File(s) | What was done |
|------|---------|---------------|
| Separate cloud window | `electron/main.ts` | `createCloudWindow()` opens a new `BrowserWindow` at `?mode=cloud`; clicking the cloud icon in TopBar fires `cloud:open-window` IPC |
| Cloud window detection | `src/store/auth.store.ts` | `isCloudWindow` reads URL param at module load; `isCloudMode` is permanently `true` in the cloud window |
| Auth store | `src/store/auth.store.ts` | Zustand store: `signIn`, `signUp`, `signOut`, `restoreSession`; session persisted to `localStorage` under key `jivam-cloud-session` |
| Sign-in UI | `src/components/setup/CloudSignIn.tsx` | Email/password form, sign-in / create account toggle, loading spinner, error display |
| Supabase auth (Electron) | `electron/cloud-auth.ts` | Fetch-based, no SDK: `cloudSignIn`, `cloudSignUp`, `cloudSignOut`, `initCloudSession` |
| API shim | `src/lib/cloud-api.ts` | `cloudApiSignIn/Up/Out/Init` — Electron delegates to IPC; web calls Supabase/Cloud Run directly |
| Cloud runner | `electron/cloud-runner.ts` | `CloudRunner` class: SSE streaming (`/api/chat/stream`) with non-streaming fallback (`/api/chat`). Configures via `configure(userId, sessionId)` |
| IPC routing | `electron/ipc-handlers.ts` | `jiva:send-message` checks `cloudRunner.isActive()` and routes accordingly; phase/log events sent to `event.sender` (not hardcoded main window) |
| IPC surface | `electron/preload.ts` + `src/types/electron.d.ts` | `window.electron.cloud.{openWindow, signIn, signUp, signOut, init}` |
| App.tsx routing | `src/App.tsx` | Cloud window without `cloudUser` shows `<CloudSignIn>`; skips local preflight and `startServer()` |
| TopBar | `src/components/layout/TopBar.tsx` | Cloud icon directly calls `openWindow()` (no dropdown in local mode); cloud mode shows badge with email + sign-out dropdown |
| Code tab guard | `src/components/code/CodeChatView.tsx` | "Local install required" overlay when `isCloudMode` |

### Known Broken / Untested ✗

| Issue | File | Notes |
|-------|------|-------|
| **Chat does not work end-to-end** | `electron/cloud-runner.ts` | ~~FIXED~~ `cloudRunner.startInit()` is called in `cloud:init` handler before the async HTTP call. `jiva:send-message` detects cloud senders via `event.sender.getURL().includes('mode=cloud')` and calls `cloudRunner.waitUntilReady(30_000)` if not yet active. Cloud Run cold starts up to 30s are handled. |
| **Supabase email confirmation** | `electron/cloud-auth.ts` + `src/lib/cloud-api.ts` | If the Supabase project has email confirmation enabled, `cloudSignUp` returns the user object at top-level with no `access_token`. This is handled defensively now (`data.user ?? data`), but the UX shows no "check your email" message — user just sees the app with an unconfigured session |
| **Session restoration** | `src/store/auth.store.ts` | `restoreSession()` fires and forgets `cloudApiInit`. If the cloud runner is never actually configured before a chat message, the message silently routes to the local runner |
| **Sign-out in cloud window** | `src/store/auth.store.ts` | `signOut` clears `localStorage` and calls `cloudApiSignOut`. But `cloudRunner.deactivate()` is called from `ipc-handlers.ts cloud:sign-out` — this path works. What doesn't work: the `cloudSignOut` IPC handler in `ipc-handlers.ts` passes no `accessToken` (it just calls `cloudRunner.deactivate()`), so Supabase session is not actually revoked server-side |
| **Activity log in cloud window** | `electron/cloud-runner.ts` | `onLog` is called with `Tool: ${msg}` for every SSE `status` event. Whether the Cloud Run backend actually emits these is untested |
| **Splash screen timing** | `src/App.tsx` | `showSplash` is set to `false` by the init effect before the user signs in. After sign-in, `showSplash` is already `false` — AppShell should render. This was still causing "Connecting to Jivam..." in testing; root cause not fully confirmed |

---

## Architecture Diagram

```
USER CLICKS CLOUD ICON (TopBar, local window)
         │
         ▼
window.electron.cloud.openWindow()
         │
         ▼ IPC: cloud:open-window
electron/main.ts createCloudWindow()
         │
         ▼
New BrowserWindow loads index.html?mode=cloud
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
                          →  IPC: cloud:sign-in / cloud:sign-up
                          →  electron/cloud-auth.ts cloudSignIn/Up()
                          →  POST Supabase /auth/v1/token or /signup
  2. set({ cloudUser })   ← immediately (non-blocking)
  3. cloudApiInit()       → fire-and-forget
                          → window.electron.cloud.init()
                          → IPC: cloud:init
                          → electron/ipc-handlers.ts
                          → initCloudSession() POST /api/session on Cloud Run
                          → cloudRunner.configure(userId, sessionId)
         │
         ▼ cloudUser is set
App.tsx  →  isCloudMode && cloudUser  →  render <AppShell>
         │
         ▼ User sends a chat message
jiva.store.sendMessage()
  →  window.electron.jiva.sendMessage()
  →  IPC: jiva:send-message
  →  ipc-handlers.ts
  →  cloudRunner.isActive() ? cloudRunner.chat() : jivaRunner.chat()
  →  POST https://jiva-hdjcuspt2a-uc.a.run.app/api/chat/stream (SSE)
  →  SSE events → jiva:phase-update + jiva:jiva-log → sender window
```

---

## Key Files

```
src/
  lib/cloud-api.ts          Environment shim (Electron IPC vs. direct fetch)
  store/auth.store.ts       Cloud auth state (Zustand)
  components/
    setup/CloudSignIn.tsx   Sign-in / create account form
    layout/TopBar.tsx       Cloud icon → openWindow(); cloud badge when signed in
    code/CodeChatView.tsx   "Local only" overlay in cloud mode
  App.tsx                   Cloud window routing: sign-in guard, skip local setup

electron/
  main.ts                   createCloudWindow(), ipcMain.handle('cloud:open-window')
  cloud-auth.ts             Supabase fetch wrapper (Electron-side)
  cloud-runner.ts           HTTP/SSE client to Cloud Run
  ipc-handlers.ts           cloud:sign-in/up/out/init handlers; jiva:send-message routing
  preload.ts                window.electron.cloud.* IPC bridge
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
