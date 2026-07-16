# Native Install: Background Service + Dock/Desktop Icon

`jivam --install` sets up two independent things: a persistent background
service (so the server is always running) and a native-feeling launch icon
(Dock on macOS, Desktop/Start Menu on Windows). This doc explains both and
why they're separate concerns. See `../CLAUDE.md` for hard-won debugging
notes on this subsystem — read that first if something here seems to
contradict what you're seeing on a real machine.

---

## Why a background service at all

Originally, the Dock/Desktop icon itself was responsible for starting the
server if it wasn't already running (a wrapper script: check if reachable,
spawn `jivam` if not, wait, then open the browser). This worked but had a
real race: if the user clicked the icon and the server took a few seconds to
boot, they'd see a broken/blank page.

The fix: run the server persistently via the OS's own service manager, so by
the time any icon is clicked, the server has almost certainly already been
running for a while. The icon is now a *thin* launcher — it just opens a
browser window and assumes the server is up.

## macOS — launchd LaunchAgent

**Implementation:** `server/index.ts` — `macFindJivamBin()`,
`macWriteLaunchAgent()`, `macServiceControl()`.

- Plist written to `~/Library/LaunchAgents/ai.karmaloop.jivam.plist`,
  label `ai.karmaloop.jivam`.
- `ProgramArguments`: the resolved `jivam` binary path + `--server-only`
  (server only, no browser window — see CLI dispatch in `server/index.ts`).
- `RunAtLoad: true`, `KeepAlive: true` — starts at login, auto-restarts on
  any exit (crash or otherwise).
- `StandardOutPath`/`StandardErrorPath` → `~/.jivam/jivam.log`.
- Managed via `launchctl bootstrap`/`bootout`/`kickstart`/`print` (the
  modern API, not the deprecated `load`/`unload`) — see `macServiceControl()`
  for the exact commands behind `jivam start/stop/restart/status`.

**Why `KeepAlive: true` and not `SuccessfulExit: false`:** the intent is
"the server should always be running unless the user explicitly stopped it."
`jivam stop` uses `launchctl bootout`, which unloads the job from launchd
entirely — so KeepAlive never even gets a chance to fight a deliberate stop.
Using an exit-code-based KeepAlive dict would only complicate reasoning
about restarts without adding real safety.

## Windows — Startup-folder supervisor (not Task Scheduler)

**Implementation:** `server/index.ts` — `winFindJivamBin()`,
`winSetupStartupService()`, `winServiceControl()`.

This used to be a Scheduled Task (`JivamServer`, logon trigger,
`RestartOnFailure`) — the obvious equivalent of the macOS LaunchAgent. It
doesn't work for a script that promises "no admin needed": creating a task
with a **logon trigger** specifically requires `SeCreateGlobalPrivilege`,
which only administrators hold, regardless of the task's own run level
(`LeastPrivilege` doesn't help — this is a trigger-type restriction, not a
privilege-level one). A standard Windows account gets a flat "Access is
denied" trying to register it.

Current approach: a small self-restarting PowerShell supervisor script
(`%LOCALAPPDATA%\Jivam\jivam-service.ps1`), launched via a shortcut in the
current user's own Startup folder (`%APPDATA%\...\Start Menu\Programs\
Startup\Jivam Server.lnk`). Windows runs everything in that folder
automatically at every logon — a pure per-user filesystem operation, no
privilege of any kind required.

- The supervisor loop records its own PID to
  `%LOCALAPPDATA%\Jivam\jivam-service.pid` on start, then loops running
  `jivam --server-only`, restarting it 5s after any exit — the Startup-folder
  equivalent of `RestartOnFailure`.
- `jivam stop`/`restart` read that PID and run `taskkill /PID <pid> /T /F`
  (`/T` kills the whole process tree — the supervisor *and* the jivam server
  process it spawned).
- `jivam start` re-launches the same VBScript wrapper the Startup shortcut
  points to (`jivam-service-launcher.vbs`, which runs the `.ps1` hidden via
  `wscript.exe //B`, matching the no-console-flash pattern already used for
  the Desktop/Start Menu app launcher elsewhere in this file).
- `jivam status` checks whether the recorded PID is still alive via
  `tasklist /FI "PID eq <pid>"`.

## Update checks move to the background service

The old wrapper script ran `npm install -g jivamai jiva-core` on every icon
click (throttled to once/day via a stamp file). Now that the server is
persistent, that doesn't make sense — instead, the `--server-only` process
runs `server/updater.ts`'s `scheduleUpdateChecks()`: a check 30s after
startup, then every 6h, against `registry.npmjs.org/jivamai/latest`.

Detection and applying are deliberately split. Checking is silent — it just
broadcasts an `idle`/`available` status over WebSocket so the UI can show a
non-intrusive "update available" banner (`UpdateBanner` in
`src/components/UpdateModal.tsx`). Nothing gets installed until the user
explicitly clicks Update, which hits `POST /api/system/update-apply`
(`applyUpdate()` in `server/updater.ts`): that spawns a **detached** `npm
install -g jivamai jiva-core` child process (deliberately not run in-process
— on Windows, a running process's own script files can be locked in ways
POSIX isn't, so overwriting them out from under the process executing them
isn't worth risking), and once it exits successfully, broadcasts a
`restarting` status and calls `process.exit(0)`, letting
`KeepAlive`/the Windows supervisor loop bring the process back up running the
new code. The frontend (`src/store/updater.store.ts`) treats the WebSocket
disconnect that follows as expected, not an error — it quietly polls
`GET /api/version` until the server answers again, then shows a cancellable
"reloading in 3s" countdown before calling `window.location.reload()`. This
replaced an earlier version of `scheduleUpdateCheck()` that checked once a
day and, if newer, silently ran the update and killed the process with zero
user visibility — the wrong shape for a real update experience.

---

## The Dock/Desktop icon itself

### macOS — Safari "Add to Dock" (preferred), plain wrapper (fallback)

Chrome's `--app=URL` flag cannot give a genuinely separate, single-instance
Dock icon — it shares Chrome's own bundle ID, so macOS can't distinguish an
"app window" from a regular browser window (see `../CLAUDE.md` for the full
explanation of why this is a hard OS-level limitation, not a bug in our
launcher).

The real fix is Safari's native "Add to Dock" (macOS Sonoma+), which creates
a genuinely separate `.app` bundle
(`com.apple.Safari.WebApp.<uuid>` bundle ID) with real single-instance
click-to-focus behavior. `jivam --install`:

1. Drives Safari via AppleScript/System Events to trigger
   `File > Add to Dock…` (see `installSafariAddToDock()` in
   `server/index.ts` — and **definitely** read `../CLAUDE.md` before
   touching this function; there are several non-obvious gotchas already
   discovered and documented there: the exact menu item name, the
   frontmost-focus requirement, the Accessibility permission, and why the
   final confirmation click can never be automated).
2. Polls for the resulting bundle by exact path (`~/Applications/Jivam.app`
   or `~/Applications/Safari Apps/Jivam.app`) + `Info.plist` mtime freshness,
   for up to 2 minutes. This used to also pattern-match the plist's raw
   content for `com.apple.Safari.WebApp` and `<string>Jivam</string>`, but
   that was fragile in practice — exact formatting/whitespace varies by
   macOS version, so it produced false negatives on real Safari-written
   plists even when the bundle plainly existed on disk. Safari always names
   the bundle after the page title ("Jivam"), so checking those two exact
   paths directly is both simpler and correct.
3. If found, adds that bundle to the Dock via `defaults write
   com.apple.dock persistent-apps -array-add` + `killall Dock`.
4. If not found within 2 minutes (user hasn't clicked "Add" yet, or
   pre-Sonoma, or permission denied), **there is no fallback wrapper** — no
   Chrome/Edge/Brave `--app=` window gets created. That approach used to
   exist (`macCreateFallbackWrapper()`) but was removed outright: those
   windows share the browser's own bundle ID rather than getting a genuinely
   separate, single-instance Dock icon (see `../CLAUDE.md`), so a lesser
   wrapper wasn't worth creating. The background service is already running
   regardless — `runInstall()` just logs that Jivam is reachable at
   `http://localhost:7842` and that the user can finish "File > Add to
   Dock…" whenever they like, or re-run `jivam --install`.

### Windows — Desktop + Start Menu shortcuts

`runInstallWindows()` creates a `.bat` that opens a plain Edge tab (no
`--app=` mode — Edge ships by default on every Windows install, so there's no
Chrome/Brave fallback chain needed) wrapped in a `.vbs` launcher (`wscript.exe
//B`, so no console window flashes), with `.lnk` shortcuts on the Desktop and
in the Start Menu pointing at the `.vbs`. Icon is converted from
`public/icon-512.png` to `.ico` via PowerShell + `System.Drawing`.

---

## CLI commands

| Command | Effect |
|---------|--------|
| `jivam` | If the background service is already running: report its status and open the UI after a 5s beat (doesn't try to bind the port again). Otherwise: start the server in the foreground + open a browser window. |
| `jivam --install` | Set up background service + Dock/Desktop icon |
| `jivam --server-only` | Foreground server, no browser window, with the update-check schedule — this is what the background service actually runs |
| `jivam start` | Start the background service |
| `jivam stop` | Stop the background service |
| `jivam restart` | Restart the background service |
| `jivam status` | Report whether the background service is running (+ PID) |
| `jivam --version`, `-v` | Print the installed version |
| `jivam --help`, `-h` | Show usage |

Any other/unrecognized argument now prints an "Unknown option" error + usage
and exits 1, rather than falling through to `server.listen()` — which used to
crash with an unhandled `EADDRINUSE` exception (and take the WebSocketServer
down with it) whenever the background service was already running on the
port. That fall-through used to catch a bare `jivam` invocation too, since
there was no "is it already running?" check of any kind before trying to
bind.
