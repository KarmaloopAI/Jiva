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

## A third repo: `~/dev/JivamAI/` — the public website

`~/dev/JivamAI/` (`KarmaloopAI/JivamAI` on GitHub) is the public marketing
site at `jivamai.com` — a Jekyll site (see `_config.yml`, `CNAME`) deployed via
GitHub Pages. It is **not** part of the Jivam or jiva-core codebases and has no
`CLAUDE.md` of its own; this section is the pointer to remember it exists and
how to keep it in sync.

**The install scripts are duplicated on purpose, and must be kept in sync.**
`~/dev/JivamAI/install.sh` and `~/dev/JivamAI/install.ps1` are mirrored copies
of this repo's `scripts/install.sh` / `scripts/install.ps1`, hosted directly on
the website (`https://jivamai.com/install.sh`, `https://jivamai.com/install.ps1`)
so the public one-liner (`curl -fsSL https://jivamai.com/install.sh | bash`)
has **no dependency on GitHub raw-content URLs or on this repo being public**.
Whenever `scripts/install.sh` or `scripts/install.ps1` changes here, copy the
updated file over to `~/dev/JivamAI/` verbatim except for the usage-comment
header (which points at `jivamai.com`, not `raw.githubusercontent.com`), then
commit and push in the JivamAI repo separately. The download page
(`~/dev/JivamAI/download.html`) describes the install flow step-by-step — if
the script's actual behavior changes (new steps, different flags, macOS vs.
Windows differences), update that page's step list to match, since it's meant
to describe exactly what the script does, not just link to it.

**The site no longer distributes per-platform Electron binaries.** It used to
(a `_data/downloads.yml` populated by a GitHub Actions workflow that watched
GitHub Releases for `.dmg`/`.exe`/`.AppImage` assets), from before Jivam's
Electron-to-PWA migration (see the main "What Jivam is" section above). That
data file and workflow were removed since `npm run build` in this repo no
longer produces those artifacts at all — don't recreate them. The download
page now only ever links to the install script and to
`https://github.com/KarmaloopAI/Jivam/releases` for release notes.

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

**`code-runner.ts` used to read model config from the wrong place entirely —
watch for this pattern reappearing.** `jiva-runner.ts` (chat mode) has always
deliberately read the reasoning model config from Jivam's own
`~/.jivam/config.json` via `readConfig()` (see the comment right above where
it does this) — never from jiva-core's own internal `configManager`
singleton, which is populated by jiva-core's *own* CLI setup wizard (`jiva
setup`/`jiva config`), a config file a Jivam-only user (who never touches the
`jiva` CLI directly) would never have populated. `code-runner.ts` (code mode)
didn't follow this pattern — it called jiva-core's own
`configManager.getReasoningModel()` and `configManager.validateConfig()`
directly, silently reading a completely different, likely-empty config file.
This meant every field the Jivam UI writes (`defaultMaxTokens`,
`reasoningEffortStrategy`, `maxRequestsPerMinute`, `hasVision`, whatever
comes next) worked in Chat mode but had **zero effect in Code mode** — not
because of a passthrough bug, but because Code mode wasn't even looking at
the file those settings were saved to. Fixed by making `code-runner.ts`
mirror `jiva-runner.ts` exactly: `readConfig()` from `./config-manager`, same
`apiKey` presence check, same field passthrough into `createKrutrimModel()`.
If a future jiva-core integration point (a new mode, a new agent type) reads
model config, make sure it goes through Jivam's own `readConfig()` — never
jiva-core's `configManager` singleton, which Jivam does not keep in sync.

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
`com.apple.Safari.WebApp.<uuid>` bundle ID.
- The File menu item is **`"Add to Dock…"` with a trailing Unicode ellipsis**
  (`…`, not three periods) — worth knowing if you ever reference it in UI copy
  or docs, even though we no longer script clicking it (see below).
- **The final "Add" confirmation panel cannot be scripted, on purpose.**
  Exhaustively confirmed via `System Events` UI-tree traversal across every
  process (including the "Web App" helper process that momentarily owns the
  window) — it never appears as an accessible element anywhere. This is the
  same category as Touch ID/Apple Pay confirmations: Apple deliberately
  excludes it from the Accessibility API since installing an app is
  security-sensitive. **Don't try to bypass this again** — it's a wall, not a
  bug.
- **Safari overwrites a same-named bundle in place** rather than picking a new
  name — if you're diffing directory contents to detect "did a new bundle
  appear", diff by `Info.plist` **mtime**, not by "is this a new filename",
  or you'll miss legitimate overwrites of a stale bundle from a prior run
  (this was a real, shipped bug — see git history on `develop` for the fix).

**We used to drive the File > Add to Dock… click ourselves via AppleScript/
System Events — don't go back to that.** It worked, but only after the user
granted **Accessibility permission** (not "Automation") to the calling
process (Terminal, etc.) — System Settings → Privacy & Security →
Accessibility; missing permission surfaced as `osascript is not allowed
assistive access (-1719)`. It also required Safari to be frontmost via
System Events specifically (`tell application "System Events" to tell
process "Safari" to set frontmost to true` — plain `tell application "Safari"
to activate` left the menu item disabled). Since the confirmation panel can
never be scripted anyway (previous point), all that Accessibility-gated
automation was ever buying us was skipping one menu click — and when the
permission wasn't granted fast enough, the whole install silently fell back
to a Chrome/Edge/Brave `--app=` wrapper, undermining the Safari-first
strategy for exactly the users who hit the permission prompt. Current
approach: `jivam --install` just opens a plain Safari tab (`tell application
"Safari" to open location ...` — needs only the lightweight, rarely-denied
Automation permission, not Accessibility) at
`http://localhost:7842/?installGuide=safari-dock`. The page itself detects
that query param and shows an in-app graphical walkthrough (`AddToDockGuide`
in `src/App.tsx`) telling the user to click File > Add to Dock… themselves.
Meanwhile `jivam --install` polls `findSafariWebAppBundle()` in the
background (up to 2 minutes) for the resulting bundle, falling back to a
plain `--app=` wrapper only if nothing appears in that window. Safari is
also now the default first choice everywhere else Jivam opens a window
(`openAppWindow`, the fallback `.app` wrapper's launcher script) — Chrome/
Edge/Brave are fallbacks, not the primary path, a reversal of the original
Electron-era assumption that Chrome's `--app=` gave the best experience.

**Windows follows the same playbook as Safari: guide, don't automate.**
`jivam --install` used to try to force-create the app automatically on
Windows too, and it had the same class of problem as the old Safari
System Events approach — silent failures tied to permissions (Node install
via winget/MSI triggering a UAC prompt that a non-admin account can't
approve at all, for example). Current approach (`installEdgeAppGuide` in
`server/index.ts`): open a plain Edge tab at
`http://localhost:7842/?installGuide=edge-app` — Edge ships on every Windows
install by default, so there's no browser-detection chain needed — and let
the page itself (`AddToDockGuide` in `src/App.tsx`, shared with the Safari
flow via an `InstallGuideKind` union) show where to click: the install icon
in Edge's address bar, with the ⋯ → Apps → "Install this site as an app"
route as a documented fallback for older Edge layouts. `jivam --install`
polls `findEdgePwaShortcut()` (Start Menu `.lnk` files, matched by name and
mtime — the Windows equivalent of `findSafariWebAppBundle`'s Info.plist
diffing) for up to 2 minutes, falling back to a plain Edge-tab shortcut
wrapper only if nothing appears. **No Chrome/Brave fallback chain on
Windows** — Edge's guaranteed presence removes the need for one, unlike
macOS where Safari's absence is theoretically possible.

**Node.js version parsing bug (fixed, worth remembering the shape of it):**
`scripts/install.sh` used to strip the `v` prefix and pre-release suffix
from `node --version` with `${NODE_VER//[^0-9.]*/}` — this looks like a
regex but bash parameter-expansion patterns are **glob** patterns, where
`*` is a standalone "match anything" wildcard, not a quantifier tied to the
preceding character class. So `[^0-9.]*` matched "one non-digit char
followed by literally anything" and wiped the entire version string,
leaving `MAJOR` empty every time. An empty string in `[ -lt ]` numeric
context evaluates as `0` in bash, so the script always concluded Node was
too old and tried to reinstall/upgrade — even when e.g. v24 was already
installed. Fixed with plain `${NODE_VER#v}` (prefix strip, not glob
substitution). If you ever need to parse a version string in bash again,
default to `#`/`%` prefix/suffix stripping, not `//pattern/repl` — the glob
semantics are a trap that looks like it should work like regex and doesn't.
Also: the threshold itself was stale — jiva-core's `package.json` requires
Node `>=20`, but both install scripts only checked `>=18`. Both now check
`>=20` (and Jivam's own `package.json` now declares the same `engines`
constraint).

**winget/choco on Windows generally need elevation — don't claim otherwise.**
Verified via web research (see PR history around this note): Node's official
winget package (`OpenJS.NodeJS.LTS`) installs machine-wide, which typically
triggers a UAC prompt; a standard (non-admin) account can't approve that at
all. Chocolatey is even more explicit about it — most packages require an
elevated shell. `install.ps1` tries winget first (now checking `$LASTEXITCODE`
instead of blindly assuming success), but the real fix is the fallback: a
portable Node.js build, downloaded as a plain zip and extracted into
`%LOCALAPPDATA%\Jivam\node`, added to the **User** (not Machine) PATH via
`[Environment]::SetEnvironmentVariable(...,'User')`. That's a pure per-user
filesystem + registry operation — no installer, no UAC, works for any
account. If you're ever tempted to reach for choco in this script, remember
the portable-zip approach is the one that's actually guaranteed to work
without admin rights.

**The setup/check screen (`SetupScreen.tsx`) is deliberately not a 3-step
gate anymore.** It used to require Node.js, jiva-core, *and* config checks
to all pass in sequence before showing anything else — but by the time this
screen can even load, Node and jiva-core are already installed and running
(that's how the user got here via `scripts/install.sh`/`install.ps1`), so
treating them as steps to click through was pure friction for the common
case. They're now a quiet safety net (a red banner) that only appears if
one of them is actually broken; the API key form (`ModelSetupStep`) is the
main, prominent content. Also: `App.tsx` used to `return <SetupScreen />`
early, which meant `AddToDockGuide` — driven by a URL param, unrelated to
setup state — never got a chance to render for a first-run user stuck on
setup. Fixed by hoisting `AddToDockGuide` outside the `setupDone` branching
entirely, rendered unconditionally in `App()`'s final return. If you add
another screen-state branch to `App()` in the future, make sure anything
similarly state-independent (URL-param-driven overlays, WS-driven banners)
stays outside the branch, not nested inside one arm of it.

**Chrome's CDP `PWA.install` domain exists and is genuinely real** (not a
hallucination — confirmed via Chromium's own docs and a live test), but as of
Chrome 149 (mid-2026) it's still gated to Dev/Canary channel only, never
shipped to stable. Not viable for real users today. Don't re-attempt this
without first checking whether Google has shipped it to stable — search for
current status before spending time on it again.

**Background service architecture**: the Jivam server now runs persistently
via a macOS `launchd` LaunchAgent (`~/Library/LaunchAgents/ai.karmaloop.jivam.plist`,
`RunAtLoad` + `KeepAlive`) or, on Windows, a self-restarting PowerShell
supervisor launched from the user's own Startup folder — **not** a Scheduled
Task, see the next note for why — started by `jivam --install`. This
eliminates the old "click Dock icon before server is up → blank page" race
entirely, since the server is (almost) always already running by the time
any icon is clicked. Managed via `jivam start/stop/restart/status`. The
actual Dock/Desktop icon is now just a thin launcher — it assumes the server
is already up and only opens a browser window; server startup responsibility
moved entirely to the OS service manager. See `server/index.ts`:
`macWriteLaunchAgent`, `macServiceControl`, `winSetupStartupService`,
`winServiceControl`.

**Windows Scheduled Tasks with a logon trigger need admin — don't use them
for "no elevation needed" background services.** This used to register a
`JivamServer` Scheduled Task via `schtasks /Create /XML` with a
`<LogonTrigger>` and `RunLevel: LeastPrivilege`, expecting the low run level
to keep it elevation-free. It didn't — verified via research (multiple
independent sources agree): creating a task with a **logon trigger**
specifically requires `SeCreateGlobalPrivilege`, which only administrators
hold, completely independent of the task's own run level. A standard
account gets a flat "Access is denied" trying to register it — this is
almost certainly why background-service setup was silently failing/
requiring elevation for non-admin Windows users. Time-based triggers don't
have this restriction, only logon/startup/workstation-unlock triggers do,
which is exactly the trigger type a "start at login" service needs, so
there's no LeastPrivilege-compatible way to make this work via Task
Scheduler. Current fix: skip Task Scheduler entirely. `winSetupStartupService`
writes a small self-restarting PowerShell supervisor
(`%LOCALAPPDATA%\Jivam\jivam-service.ps1`) and points a shortcut in the
user's own Startup folder (`%APPDATA%\...\Start Menu\Programs\Startup\`) at
it — Windows auto-launches everything there at logon, and placing a file in
your own Startup folder is a plain per-user filesystem operation with zero
privilege requirements. The supervisor records its own PID
(`jivam-service.pid`) so `jivam stop`/`restart` can `taskkill /PID <pid> /T
/F` (killing the whole tree — supervisor + the jivam server it spawned), and
loops re-launching `jivam --server-only` a few seconds after any exit as the
RestartOnFailure equivalent. If you're ever tempted to reach for `schtasks`
again for anything that needs to survive without an admin account, remember
this restriction is about the trigger type, not anything you can configure
around in the task definition.

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
