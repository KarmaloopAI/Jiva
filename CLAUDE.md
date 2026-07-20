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

**Dynamic model switching is a reinit+reload, not a live setter — jiva-core
doesn't expose one.** `ModelOrchestrator` (jiva-core) holds its
`reasoningModel` as a private field with no public setter, so there's no way
to hot-swap the model inside an already-running `DualAgent`/`CodeAgent`
session without a jiva-core change. `JivaRunner.switchModel()` /
`CodeRunner.switchModel()` work around this by: persisting the new
`defaultModel` to Jivam's own config, capturing the current conversation id,
tearing down and re-initializing the runner (which builds a fresh
`ModelClient` with the new model name), then reloading the captured
conversation so history survives the swap. This is why `CodeRunner` now
caches `lastWorkspaceDir`/`lastMcpServerNames` as instance fields —
`initialize()` itself never retained them, but a reinit needs to reuse the
exact same workspace/MCP servers the session was already running with.

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

**Bash glob-vs-nvm-error install.sh bug, round two: don't source nvm.sh (or
touch `~/.npmrc`) unless Node is actually missing/too old.** `install.sh`
used to unconditionally `source ~/.nvm/nvm.sh` (if present) *before* checking
whether an already-installed Node satisfied the `>=20` requirement. On a
machine with nvm installed but no default alias/version ever explicitly
"used" in that shell, this can leave `node --version` resolving to nothing or
an unexpected value even when a perfectly good Node is on the plain PATH —
tripping the "too old" branch and dragging in nvm's install/upgrade path for
a machine that didn't need any of it. Worse, nvm's own `nvm use`/`nvm
install` refuse outright (`nvm_die_on_prefix`) if `~/.npmrc` pins a `prefix`
and/or `globalconfig` key — common for anyone who's ever run `npm config set
prefix ...` manually (e.g. old Homebrew Node setups) — so a machine in that
state got stuck on an nvm error message instead of just proceeding. Fixed by
checking Node on the **plain PATH first**, before sourcing nvm.sh at all,
and only falling into the nvm path if genuinely needed; when it is needed,
`sanitize_npmrc_for_nvm()` now strips `prefix`/`globalconfig` from
`~/.npmrc` first (backing up to `~/.npmrc.bak`) so nvm can actually do its
job instead of dying on it.

**`findSafariWebAppBundle()`'s Info.plist content-matching was the actual
bug behind "jivam --install doesn't detect a real Dock install."** It
scanned every `.app` in the two candidate directories and pattern-matched
the raw plist XML for the literal substrings `com.apple.Safari.WebApp` and
`<string>Jivam</string>` — which is fragile against real-world formatting/
whitespace variance across macOS versions, and produced false negatives
even when `~/Applications/Jivam.app` plainly existed and was freshly
written. Safari always names the bundle after the page title ("Jivam"), so
the fix is simpler than the thing it replaced: check the two exact known
paths (`~/Applications/Safari Apps/Jivam.app`, `~/Applications/Jivam.app`)
directly, still gated on `Info.plist` mtime freshness (not existence alone)
to avoid false-positiving on a stale bundle from a previous run. If this
kind of "scan and pattern-match file content" detection shows up again for
some other OS-written artifact, prefer matching a known exact path first.

**The Chrome/Edge/Brave `--app=` fallback wrapper is gone from `jivam
--install` entirely — don't reintroduce it.** `macCreateFallbackWrapper()`
used to create a `~/Applications/Jivam.app` wrapper that tried Safari first,
then fell back to Chrome/Edge/Brave `--app=` mode, if Safari's Add to Dock
polling timed out. Removed outright: those windows share the browser's own
bundle ID rather than getting a real, single-instance Dock icon (see the
Chrome `--app=` finding above), so a lesser wrapper was never worth
creating. `runInstall()` now just skips adding anything to the Dock on a
timeout, and tells the user the background service is already running and
reachable directly, with Add to Dock completable whenever they're ready (or
by re-running `jivam --install`). This does *not* touch `openAppWindow()`'s
separate, general-launch Chrome/Edge/Brave fallback (used only if Safari's
own `osascript` call itself throws, which is rare) — that's a different code
path from the install-time wrapper and wasn't part of this fix.

**`jivam`'s CLI dispatch used to fall through to `server.listen()` for
literally anything that wasn't `--install`/a service action — including a
bare `jivam` with no flags at all.** This crashed with an unhandled
`EADDRINUSE` exception (and took the WebSocketServer down with it, per its
own error event) whenever the background service was already running on the
port — which is the common case for anyone who'd already run `jivam
--install`. Fixed with a proper first-class CLI: `--version`/`-v` and
`--help`/`-h` short-circuit immediately; anything else unrecognized prints
an error + usage and exits 1 instead of reaching `server.listen()` at all;
and a bare `jivam` invocation specifically checks `GET /api/version` first —
if something's already listening, it reports status and opens the browser
after a 5s beat without trying to bind the port again, only falling through
to actually starting a foreground server if nothing answered. `--server-only`
and dev mode (`npm run dev`) still always bind directly (that IS the
canonical persistent-service invocation), now backed by a `server.on('error',
...)` handler that turns any remaining `EADDRINUSE` race into a clean error
message instead of an unhandled exception.

**The updater is real now — npm-registry-based, detect-silently/apply-only-
on-click, not the old scheduleUpdateCheck().** The old `scheduleUpdateCheck()`
in `server/index.ts` shelled out to `npm view jivamai version` once a day
and, if newer, silently ran `npm install -g jivamai jiva-core` and killed the
process with zero visibility to the user — no banner, no confirmation, no
indication anything happened besides a brief restart. Replaced with
`server/updater.ts`: `checkForUpdate()` hits
`registry.npmjs.org/jivamai/latest` directly (no `npm view` shell-out) and
only ever broadcasts an `idle`/`available` status over WebSocket — it never
installs anything itself. Actually applying an update requires an explicit
frontend call to `POST /api/system/update-apply`, gated behind a user
clicking "Update" in the UI (`UpdateBanner`/`UpdateModal` in
`src/components/UpdateModal.tsx`, backed by `src/store/updater.store.ts`).
`applyUpdate()` spawns `npm install -g jivamai jiva-core` as a **detached**
child process — deliberately not run in-process, since a running process's
own script files can be locked on Windows in ways POSIX isn't, so
overwriting them out from under the very process executing them isn't worth
the risk — and once that child exits 0, broadcasts `restarting` and calls
`process.exit(0)`, letting the OS-level supervisor (launchd `KeepAlive` /
the Windows PowerShell loop) bring the process back up on the new code. The
frontend must not treat the WebSocket disconnect that follows as an error:
`updater.store.ts` transitions to a `reconnecting` phase and quietly polls
`GET /api/version` (silently swallowing failures — that's the expected state
while the server restarts) until it gets an answer, then shows a cancellable
"reloading in 3s" countdown before calling `window.location.reload()`. If a
future change touches this flow, keep the detect/apply split — silently
auto-applying was the actual UX problem being fixed, not just a missing
progress bar.

**Removed the entire dead `electron/` source tree, `electron-builder.yml`,
and five stale devDependencies (`electron`, `electron-builder`,
`vite-plugin-electron`, `vite-plugin-electron-renderer`, and the
`dependencies`-listed `electron-updater`).** These were genuine leftovers
from before the Electron→PWA migration — confirmed via grep that nothing in
`server/`, `src/`, or any Vite config imported from `electron/` or
referenced `electron-updater`, and `package.json`'s `main`/`scripts` fields
point entirely at `dist-server/index.js`. The most consequential piece
living in there was `electron/updater.ts` (real `electron-updater`
`autoUpdater` wiring) — its API shape (`onAvailable`/`onProgress`/`onReady`/
`quitAndInstall`) is what `src/lib/electron-shim.ts`'s `updater` object and
`AboutTab.tsx`/`App.tsx`'s old `UpdateBanner` were still typed against, as a
permanently-unresolvable stub (`check: () => Promise.resolve()`, no-op
`onAvailable`/etc.) — meaning "Check for Updates" silently did nothing and
the update banner could never appear. Replaced by the real updater described
above. If you ever see `window.electron.updater` typed with
Electron-`autoUpdater`-shaped methods again, that's this exact regression
reappearing — the correct shape is `getStatus`/`check`/`apply`/`onStatus`
against `UpdateStatus` (defined in `src/types/electron.d.ts`, mirrored from
`server/updater.ts`).

**`AddToDockGuide`/`InstallModal` were unreadable in light mode — always
check whether a "fixed dark" component is leaking theme-variable text
colors.** Both modals render on a hardcoded dark background
(`background: 'var(--bg-card, #1a1a2e)'` — note `--bg-card` is never
actually defined anywhere in `index.css`, so this **always** resolves to
the `#1a1a2e` fallback, regardless of theme, by design — it's meant to look
like native dark OS chrome). But the emphasized words ("File", "Add",
"Install", "Jivam") were styled `text-[var(--text)]`, a genuinely
theme-dependent CSS variable. In dark theme `--text` is light — fine. In
**light theme — the default for any user whose OS reports
`prefers-color-scheme: light`** — `--text` is `#1E1B4B` (near-black indigo),
rendered against the always-dark `#1a1a2e` background: unreadable. Fixed by
replacing every theme-variable text color inside these two components
(`text-[var(--text)]`, `text-[var(--text-muted)]`, `text-[var(--text-subtle)]`)
with fixed light values (`text-white`, `text-white/60`, `text-white/40`,
etc.) — matching the pattern `SafariFileMenuMockup`/`EdgeInstallMockup`
already used correctly. If you add new copy to either modal, never use a
`var(--text*)` class there — hardcode a light color instead, since the
modal's own background can never become light-mode-compatible without
undermining the "looks like a native OS menu" illusion these are going for.

**Also added a max-height safeguard (`max-h-[90vh] overflow-y-auto`) to
both modals** — neither had one, so on a short viewport (a small external
monitor, or just a modest window height) the modal could render taller than
the screen with no way to scroll to the confirm/dismiss button. Verified by
resizing to 1024×500: without the fix the content (~920px) would have
overflowed off-screen; with it, the modal caps at 90vh and scrolls
internally.

**`AddToDockGuide`'s platform selection now cross-checks `/api/platform`,
not just the URL param.** The `?installGuide=safari-dock`/`edge-app` query
param is set server-side by whichever of `runInstall()`/`runInstallWindows()`
(or `openAppWindow()`'s platform branches) is actually running — which
branches on Node's own `process.platform`, so in theory it's always correct
by construction. A report came in of Windows showing Safari's File-menu
walkthrough anyway; exhaustive review of every server-side code path that
constructs that URL turned up nothing wrong, so the likely explanation is a
stale/very-old npm-installed version predating the Edge-guide feature
entirely (see the note below about unreleased fixes) rather than a live bug.
Added a belt-and-suspenders fix regardless: `AddToDockGuide` now also fetches
`/api/platform` and, once resolved, lets it override the URL-param-derived
guide kind (`win32` → `edge-app`, `darwin` → `safari-dock`) — so this class
of mismatch literally cannot happen client-side going forward, independent
of whatever caused the original report.

**Reminder: fixes on `develop` don't reach real users until a release is
cut.** Both the "flaky Safari Add-to-Dock detection on some Macs" report and
the "Windows shows Safari instructions" report were investigated at length
before realizing the most likely explanation for each is simply that `npm`'s
published `latest` tag (what `npm install -g jivamai` actually installs) can
be several fixes behind whatever's on `develop` — e.g. the
`findSafariWebAppBundle()` Info.plist-matching fix earlier in this file was
committed to `develop` well before this note but, as of this writing, has
never shipped in a stable release. Before spending a lot of effort chasing a
"user reports X is broken" bug by re-deriving root causes from scratch,
check `npm view jivamai version` / `dist-tags` against what commit that
version actually corresponds to on `main` — the bug may already be fixed and
just waiting on a release.

**File-attach picker "never opens" was a real bug, confirmed by the exact
report — a detached `<input type=file>` doesn't reliably open the native
picker in WebKit.** `pickAndUploadFiles()` in `src/lib/electron-shim.ts`
created the input with `document.createElement('input')` and called
`.click()` on it directly, without ever appending it to the document. This
apparently worked in some contexts but silently did nothing in others —
confirmed the exact reported symptom (click does nothing, no dialog) traces
to this, since installed Safari "Add to Dock" web-app windows run in a
stricter WebKit process (`com.apple.Safari.WebApp.<uuid>`) than a regular
tab. Fixed by appending the input to `document.body` (visually hidden via
fixed positioning off-screen) before calling `.click()`, and removing it
afterward. Also added a `window` `focus` event listener as a cancel-safe
fallback: the input's own `change` event never fires if the user dismisses
the dialog without picking a file, which would otherwise leave the
`pickAndUploadFiles()` promise unresolved forever (and, on a second attempt,
never trip `isProcessingFiles`'s guard either, since that flag is only ever
set *after* a successful pick — worth remembering if this area gets touched
again). If you ever add another programmatic file/native-dialog trigger,
default to attaching the triggering element to the DOM first — don't assume
a detached element's `.click()` is safe across browser engines.

**MCP onboarding wizard (`McpOnboardingModal.tsx`) fires once, gated by
`localStorage['jivam-mcp-onboarding-seen']`, watching `useChatStore`'s
`messages` for the first `role: 'agent', status: 'complete'` entry.** This
means it also fires for existing users on their next message after
upgrading to the version that shipped it (no way to distinguish "genuinely
new user" from "existing user, flag never set" without server-side account
state, which Jivam's local-only architecture doesn't have) — treated as an
acceptable one-time "hey, here's how to level up" tip either way, not a bug.
The three MCP servers it offers (`tavily-mcp`, `html-to-markdown-mcp`,
`@playwright/mcp@latest --browser chrome`) were verified against the
maintainers' own docs before wiring up `window.electron.mcp.addServer()`
calls — worth re-verifying if any of these ever need to change, since a
wrong package name here means real `npx -y <package>` execution, not just a
broken UI. Confirmed encouragingly during testing: a real user's own
already-configured `~/.jivam/config.json` independently used the exact same
`html-to-markdown-mcp` and `@playwright/mcp@latest` packages.

**Code-mode conversation switching didn't update the git panel — two stores
that never talked to each other.** `git.store.ts`'s `workspaceDir` (which
`GitPanel.tsx`/`refresh()` actually read from) is a completely separate piece
of state from `code.store.ts`'s `codeWorkspaceDir` — the only place that ever
called `useGitStore.getState().setWorkspaceDir(...)` was
`WorkspacePickerView.tsx`'s `handleStart()`, i.e. only when a *brand new*
session started. `code.store.ts`'s `loadConversation()` (restoring a
previously-saved conversation, potentially with an entirely different
`workspace` in its metadata) set `codeWorkspaceDir` correctly but never
touched `git.store`, so the git panel kept showing whatever workspace was
last active. Compounding it: `CodePage.tsx`'s `useEffect(() => {
checkIsRepo() }, [isSessionStarted])` only refires on a `false→true` edge —
switching between two conversations that were both already inside an active
session leaves `isSessionStarted` at `true` the whole time, so even a correct
`git.store` sync wouldn't have been picked up by that effect. Fixed by having
`loadConversation()` call `useGitStore.getState().setWorkspaceDir(workspace)`
+ `checkIsRepo()` directly, right after resolving the restored workspace, in
both the v0.3.50+ success path and the pre-v0.3.50 fallback path — not
relying on `CodePage.tsx`'s effect at all. If another cross-store workspace
dependency shows up later, default to having the action that changes the
workspace push the update everywhere it needs to go, rather than relying on
a `useEffect` keyed off a boolean that doesn't change on every workspace
change.

**Auto-updater silently "succeeded" while leaving the old version running —
root cause was an unpinned `npm install -g jivamai` racing the registry's
`latest` dist-tag propagation.** A real report: clicking Update right after
a fresh release showed the normal installing→restarting flow, the server
came back up, and the UI treated that as done — except the server was still
running the *old* version, with no error anywhere. Manually running `npm i
-g jivamai` a bit later worked fine, and retrying the exact same in-app flow
after that also worked — the only thing that differed between the failing
and succeeding attempts was elapsed wall-clock time since the publish. This
is a known npm characteristic: a specific version's tarball becomes
available essentially as soon as it's published, but the mutable `latest`
dist-tag pointer that a bare (unpinned) `npm install -g jivamai` resolves
against can lag behind across the registry's CDN/cache layers for a short
window right after publish — so `npm install -g jivamai` run in that window
can silently resolve back to the previous version and still exit 0 (npm
treats "already satisfies the resolved spec" as success, not a no-op error).
Fixed on two levels: (1) `applyUpdate()` in `server/updater.ts` now pins the
install to the *exact* version `checkForUpdate()` already confirmed exists
(`jivamai@${targetVersion}`) instead of a bare `jivamai`, sidestepping
dist-tag propagation entirely; (2) as defense-in-depth against any other way
this class of bug could recur, it now also reads back the actually-installed
version from disk (`getGlobalPackageVersion()`, via `npm root -g` + reading
that package's own `package.json` — deliberately not another registry call)
and reports a real error instead of declaring success if it doesn't match
the target. The frontend (`updater.store.ts`'s `startReconnectPolling()`)
had the same blind spot from the other end — it treated *any* successful
`/api/version` response after the restart as proof the update worked, never
comparing the returned version against `latestVersion`. Now fixed there too:
a version mismatch after reconnecting surfaces the `error` phase (a real,
readable message in `UpdateModal`) instead of silently reloading into the
same old version. If you touch this flow again, keep both checks — the
backend fix prevents the common cause, the frontend fix prevents *this
category* of failure from ever being silent again, regardless of cause.

**The chat-input status row (disclaimer + Deep Run + model/max-iterations
chip) is one shared component, not two duplicated blocks — keep it that
way.** `ChatInput.tsx` (chat mode) and `CodeChatView.tsx` (code mode) both
show the same trio below their input: a small disclaimer on the left, and on
the right a "Deep Run" pill plus a merged model-name/max-iterations chip
with a diagonal accent-purple split. This started as copy-pasted, near-
identical JSX (written for chat mode first, then hand-carried into code mode
as a separate follow-up request) — the risk of that pattern showed up
immediately: a cosmetic tweak ("black → dark purple" → "actually, match the
Deep Run chip's accent color") landed in `ChatInput.tsx` and had to be
manually reapplied to `CodeChatView.tsx` afterward, which is exactly the
drift this file exists to warn about. Fixed by extracting the whole row into
`src/components/ui/AgentStatusRow.tsx` — a single component taking
`disclaimer`, `deepRun`, `model`, `maxIterations`, and `onOpenSettings`
props — with both `ChatInput.tsx` and `CodeChatView.tsx` now rendering it
with mode-specific copy/state instead of owning their own copy of the JSX.
If asked to change how this row looks or behaves, change it once in
`AgentStatusRow.tsx`; there should never again be two copies of it to keep
in sync by hand. More generally: chat mode and code mode share a lot of
input-area UI shape (the settings popover, the model/max-iterations picker,
the send button) that's still duplicated between the two files as of this
writing — if a future request touches one of those shared pieces, consider
extracting it the same way rather than manually re-applying the same edit
twice. (Note: this repo has no separate `AGENTS.md` — this file *is* the
cross-session working-notes file, for Claude/Codex/any other agent working
here; put long-term notes like this one here.)

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
