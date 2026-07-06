# CLAUDE.md — Working notes for Jivam

This file is for me (Claude) across sessions. It stays in the Jivam repo but is
**never published to npm** (see `.npmignore`). It captures things that aren't
obvious from reading the code cold: architectural decisions, dead ends already
explored, and hard-won debugging findings.

Read this first. Then read `./docs/` in this repo (Jivam) and `~/dev/Jiva/docs/`
(jiva-core) — both are the canonical, deeper reference and are kept up to date
separately from this file. This file is the "why" and "gotchas"; `./docs/` is
the "what" and "how".

## What Jivam is

Jivam is the desktop UI for [Jiva](https://github.com/KarmaloopAI/Jiva)
(npm package `jiva-core`), the autonomous AI agent. Jivam itself publishes to
npm as **`jivamai`** (not `jivam` — npm's spam filter rejected `jivam` as "too
similar to existing package livan"; the CLI binary is still invoked as `jivam`,
only the published package name differs). Repo: `KarmaloopAI/Jivam`.

Jivam used to be an Electron app. It was migrated to a **local Express server +
React PWA frontend** served over `localhost:7842`, installed and run via
`npm install -g jivamai && jivam`. This sidesteps macOS/Windows code-signing
costs entirely — `jivam` just drives the user's already-trusted, already-signed
browser (Chrome/Edge/Brave/Safari) instead of shipping our own unsigned binary.
Full detail: `./docs/architecture/overview.md`.

## Two repos, one mental model

- `~/dev/Jiva/` — `jiva-core`, the agent engine (DualAgent, WorkerAgent,
  ManagerAgent, CodeAgent, ModelOrchestrator, MCP support). Jivam depends on it
  as a global npm package and loads it via dynamic ESM `import()` at runtime
  (see `server/jiva-runner.ts`) — Jivam never bundles jiva-core's source.
- `~/dev/Jivam/` (this repo) — the UI/server wrapper around jiva-core.

Both repos have their own `./docs/` directory — **always check both** before
making non-trivial changes, especially anything touching model config, agent
behavior, or the jiva-core↔Jivam integration boundary (`server/jiva-runner.ts`,
`server/config-manager.ts`). When you fix something that spans both repos
(e.g. a jiva-core bug that Jivam is hitting), fix it in Jiva first, verify with
`npm link` from Jiva into Jivam's global `jiva-core` install, then update
Jivam's docs/code to take advantage.

Git identity for commits in both repos: use the repo's own configured author
(`git log --format="%ae %an" -1` to check — currently
`Abhishek Chatterjee <abhishek@gritsa.com>` for both). **Never** put "Claude"
or "Anthropic" in commit messages, emails, or authorship — this was an
explicit, repeated instruction (asked more than once — treat it as a hard
rule, not a one-off).

**Jiva's branch workflow: `develop` first, always.** New work — including
bug fixes discovered while working on Jivam — goes on `develop`, not `main`.
`main` only receives changes via a `develop → main` PR merge. I got this
wrong once (committed three fixes straight to `main` while debugging
Jivam-triggered issues) and had to cherry-pick them onto `develop` and reset
`main` back to `origin/main` afterward. Default to checking out/creating a
local `develop` branch (tracking `origin/develop`) before starting any Jiva
fix, not `main`, even when `main` is what happens to be checked out already.

## Architecture in one paragraph

`server/index.ts` is an Express app (+ WebSocket via `server/ws.ts`) that
mounts routes under `/api/*` (see `server/routes/`), serves the built React
frontend (`dist/`) as static files in production, and exposes a CLI surface
(`jivam`, `jivam --install`, `jivam start/stop/restart/status`,
`jivam --server-only`). The React app (`src/`) never talks to Electron IPC —
`src/lib/electron-shim.ts` sets `window.electron = electronShim`, implementing
the *same method shape* the old Electron preload API had, but backed by
`fetch()` to `/api/*` and a WebSocket to `/ws` instead. This means most
components/stores never needed to change during the Electron→PWA migration —
only the shim did. When adding a new capability, prefer adding it as an
Express route + a corresponding `electron-shim.ts` method over inventing a new
transport.

## Hard-won findings (don't rediscover these)

**Chrome `--app=URL` cannot give a real single-instance Dock/taskbar icon.**
It runs inside the normal Chrome process/bundle ID, so the OS can't
distinguish it from a regular browser window — clicking the "app" window's
Dock icon and clicking Chrome's Dock icon are indistinguishable to macOS, and
each `--app=` invocation spawns a new window rather than focusing an existing
one. This is a fundamental limitation of the flag, not a bug in our launcher
script. Real fix: Safari's native "Add to Dock" (see below), which creates
a genuinely separate `.app` bundle with its own bundle ID.

**Safari's "Add to Dock" (macOS Sonoma+) is real, native, single-instance
by construction** — it creates `~/Applications/Jivam.app` (or
`~/Applications/Safari Apps/Jivam.app` on some macOS versions — check both;
Safari picks the location) with a genuinely separate
`com.apple.Safari.WebApp.<uuid>` bundle ID. Automating it via AppleScript/
System Events:
- The File menu item is **`"Add to Dock…"` with a trailing Unicode ellipsis**
  (`…`, not three periods) — `menu item "Add to Dock"` silently fails to find
  it.
- It's **disabled unless Safari is frontmost via System Events specifically**
  (`tell application "System Events" to tell process "Safari" to set
  frontmost to true`) — just `tell application "Safari" to activate` isn't
  enough, the menu item stays disabled and the click errors.
- Requires **Accessibility permission** (not "Automation") for the calling
  process (Terminal, etc.) — System Settings → Privacy & Security →
  Accessibility. Missing permission surfaces as `osascript is not allowed
  assistive access (-1719)`.
- **The final "Add" confirmation panel cannot be scripted, on purpose.**
  Exhaustively confirmed via `System Events` UI-tree traversal across every
  process (including the "Web App" helper process that momentarily owns the
  window) — it never appears as an accessible element anywhere. This is the
  same category as Touch ID/Apple Pay confirmations: Apple deliberately
  excludes it from the Accessibility API since installing an app is
  security-sensitive. **Don't try to bypass this again** — it's a wall, not a
  bug. `jivam --install` prompts the user and polls for the resulting bundle
  for up to 60s, falling back to a plain `--app=` wrapper if nothing appears.
- **Safari overwrites a same-named bundle in place** rather than picking a new
  name — if you're diffing directory contents to detect "did a new bundle
  appear", diff by `Info.plist` **mtime**, not by "is this a new filename",
  or you'll miss legitimate overwrites of a stale bundle from a prior run
  (this was a real, shipped bug — see git history on `develop` for the fix).

**Chrome's CDP `PWA.install` domain exists and is genuinely real** (not a
hallucination — confirmed via Chromium's own docs and a live test), but as of
Chrome 149 (mid-2026) it's still gated to Dev/Canary channel only, never
shipped to stable. Not viable for real users today. Don't re-attempt this
without first checking whether Google has shipped it to stable — search for
current status before spending time on it again.

**Background service architecture**: the Jivam server now runs persistently
via a macOS `launchd` LaunchAgent (`~/Library/LaunchAgents/ai.karmaloop.jivam.plist`,
`RunAtLoad` + `KeepAlive`) or a Windows Scheduled Task (`JivamServer`, logon
trigger + `RestartOnFailure`), started by `jivam --install`. This eliminates
the old "click Dock icon before server is up → blank page" race entirely,
since the server is (almost) always already running by the time any icon is
clicked. Managed via `jivam start/stop/restart/status`. The actual Dock/
Desktop icon is now just a thin launcher — it assumes the server is already up
and only opens a browser window; server startup responsibility moved
entirely to the OS service manager. See `server/index.ts`:
`macWriteLaunchAgent`, `macServiceControl`, `winRegisterTask`,
`winServiceControl`.

**Krutrim's stricter models (e.g. Qwen3.6) reject any request where the
system message isn't first/alone.** This was a real bug in **jiva-core**
(`src/core/manager-agent.ts`), not Jivam: `ManagerAgent.getSystemMessages()`
appended the directive as a second `developer`-role message (which becomes a
second `system` message after role conversion) whenever a directive was
configured. Krutrim's `gpt-oss-120b` happened to tolerate two system messages;
Qwen3.6 didn't, throwing `400 System message must be at the beginning`. Fixed
by merging the directive into the single system message instead of appending
a second one — safe because `ManagerAgent` never sends `tools`, so Harmony's
developer-role tool-injection path never applied here anyway. If you see this
error again, check whether the failing code path constructs more than one
leading system/developer message.

**Vision-capable reasoning models**: jiva-core previously assumed vision
*required* a separate `multimodal`-typed model, routing all images through a
caption-then-forward pipeline (`ModelOrchestrator.handleMultimodalRequest`).
Added a `hasVision` boolean flag (on `ModelConfigSchema` /
`ModelClientConfig`) so a `reasoning`- or `tool-calling`-typed model can
declare native vision and receive image content directly, skipping the
captioning detour. **DualAgent and CodeAgent needed zero changes** for this —
both delegate 100% of model calls through
`ModelOrchestrator.chat()`/`chatWithFallback()` and have no vision logic of
their own; fixing the orchestrator's routing was the single correct
integration point. If a future agent class is added, keep this pattern: agents
should never special-case vision — that belongs in the orchestrator.

## npm publishing gotchas

- Publishing requires either 2FA-with-OTP on every `npm publish`, or a
  Granular Access Token with "bypass 2FA" enabled, set via
  `npm config set //registry.npmjs.org/:_authToken <token>` (check `~/.npmrc`
  — stale tokens silently override new ones if you don't overwrite the same
  line).
- `develop` and `main` can drift on package name/version — when something
  works on `main` but fails to publish from `develop` (or vice versa), diff
  `package.json` between branches first. This has already happened once
  (develop branched before the `jivam` → `jivamai` rename landed on main).
- GitHub Actions: push to `develop` → dev-tagged prerelease
  (`x.y.z-dev.<sha>`); creating a GitHub Release on `main` → stable publish.
  Requires an `NPM_TOKEN` repo secret.

## Obfuscation

Jivam is proprietary — production builds are obfuscated (see
`scripts/obfuscate.js` or equivalent in `package.json`'s `build` script) so
`dist/` and `dist-server/` aren't trivially decompiled/readable. When
debugging a production build issue, rebuild locally without the obfuscation
step rather than trying to read obfuscated output — check the build script
for how to disable it (e.g. an env var or separate script target).

## General approach when coding here

1. Check `./docs/architecture/` for the subsystem you're touching before
   assuming Electron-era docs still apply — this repo went through a full
   platform migration; some docs may lag behind the code (check dates/content
   for staleness, and update them when you notice drift, per the standing
   instruction to keep `./docs/` current).
2. Prefer extending `server/routes/*.ts` + `src/lib/electron-shim.ts` +
   a Zustand store over inventing new plumbing.
3. For anything touching jiva-core behavior (agent logic, model routing,
   config schema), go fix it in `~/dev/Jiva/` first, verify with `npm link`,
   then wire up Jivam's side.
4. Test macOS-specific install/Dock/LaunchAgent flows for real — this stuff
   is full of undocumented, non-obvious platform behavior (see "Hard-won
   findings" above) that's easy to get subtly wrong without hands-on testing.
5. Never reference Claude/Anthropic in commit messages, code comments, or
   author fields.
