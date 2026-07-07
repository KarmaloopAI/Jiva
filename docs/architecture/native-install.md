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

## Windows — Task Scheduler

**Implementation:** `server/index.ts` — `winFindJivamBin()`,
`winRegisterTask()`, `winServiceControl()`.

- Task name `JivamServer`, registered via `schtasks /Create /XML` (a
  generated task definition, not command-line flags — needed for
  `RestartOnFailure`, which has no `schtasks`-flag equivalent).
- Logon trigger, `RestartOnFailure` (1 min interval, 999 retries), hidden
  execution (no console window flash).
- Managed via `schtasks /Run` / `/End` (`jivam start`/`stop`), and `/End`
  then `/Run` for `restart`.

## Update checks move to the background service

The old wrapper script ran `npm install -g jivamai jiva-core` on every icon
click (throttled to once/day via a stamp file). Now that the server is
persistent, that doesn't make sense — instead, the `--server-only` process
itself checks once every 24h (`scheduleUpdateCheck()` in `server/index.ts`)
whether a newer `jivamai` version is published; if so, it runs the update and
exits, letting `KeepAlive`/`RestartOnFailure` bring it back up running the
new code.

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
2. Polls for the resulting bundle (by `Info.plist` content + mtime, not by
   filename — Safari overwrites a same-named bundle in place) for up to 60s.
3. If found, adds that bundle to the Dock via `defaults write
   com.apple.dock persistent-apps -array-add` + `killall Dock`.
4. If not found within 60s (user didn't click "Add", or pre-Sonoma, or
   permission denied), falls back to `macCreateFallbackWrapper()` — a
   minimal `.app` that just opens Chrome/Edge/Brave `--app=` or Safari, no
   server-start logic needed (the background service already covers that).

### Windows — Desktop + Start Menu shortcuts

`runInstallWindows()` creates a `.bat` (opens Chrome/Edge `--app=` or default
browser) wrapped in a `.vbs` launcher (`wscript.exe //B`, so no console
window flashes), with `.lnk` shortcuts on the Desktop and in the Start Menu
pointing at the `.vbs`. Icon is converted from `public/icon-512.png` to
`.ico` via PowerShell + `System.Drawing`.

---

## CLI commands

| Command | Effect |
|---------|--------|
| `jivam` | Foreground: start server + open browser window (dev/manual use) |
| `jivam --install` | Set up background service + Dock/Desktop icon |
| `jivam --server-only` | Foreground server, no browser window, with the daily update-check timer — this is what the background service actually runs |
| `jivam start` | Start the background service |
| `jivam stop` | Stop the background service |
| `jivam restart` | Restart the background service |
| `jivam status` | Report whether the background service is running (+ PID) |
