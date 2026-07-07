# jiva-core Integration

Jivam does not bundle jiva-core. It dynamically loads the globally installed npm package at runtime. This means:

- Users must have `npm install -g jiva-core` before Jivam can start
- Updating jiva-core globally is sufficient — no Jivam rebuild needed
- The integration layer is entirely in `server/jiva-runner.ts`

> For anything touching jiva-core's own internals (agent logic, model
> routing, config schema) rather than just how Jivam calls into it, also
> check `~/dev/Jiva/docs/` — that's the canonical reference for jiva-core
> itself, and fixes there require `npm link` + a rebuild before Jivam picks
> them up. See `../CLAUDE.md`.

---

## Runtime Resolution

### `augmentPath()` (`server/path-helper.ts`)

The OS may launch Jivam with a minimal PATH that excludes npm's global bin
directory (this mattered a lot for the old packaged-Electron-app case; it
still matters for launchd/Task Scheduler-launched background services, whose
environment is more minimal than an interactive shell). `augmentPath()` fixes
this by spawning the user's login shell:

```typescript
const loginPath = execSync(`${shell} -l -c 'echo $PATH'`).toString().trim()
process.env.PATH = loginPath
```

This runs before any `execSync` or `import()` calls that depend on npm being
on PATH. Also see `../CLAUDE.md` — the `--install` background-service setup
(`macWriteLaunchAgent`/`winRegisterTask`) separately bakes an augmented PATH
into the LaunchAgent plist / Scheduled Task, for the same underlying reason.

### `resolveJivaCoreEntryPath()` (`server/jiva-runner.ts`)

Finds the jiva-core ESM entry point:

1. `npm root -g` → e.g. `/usr/local/lib/node_modules` → checks for `jiva-core/package.json`
2. Fallback: `~/.npm-global/lib/node_modules/jiva-core/package.json` (common Linux setup)
3. Fallback: `./node_modules/jiva-core/package.json` (development / local install)

Reads `package.json` → follows the `"exports"` or `"main"` field to get the entry file path.

### Dynamic ESM Import

```typescript
const { DualAgent, ConversationManager, MCPServerManager } =
  await import(pathToFileURL(entryPath).href)
```

This is a true ESM dynamic import — no CommonJS `require()`. jiva-core is an
ESM-only package; Jivam's own server bundle is CJS
(see `vite.server.config.ts`), so `pathToFileURL(...).href` is required for
correct resolution on Windows too.

---

## Configuration

Config is read via `readConfig()` in `server/config-manager.ts`, which reads
from `getJivamConfigPath()` — **Jivam's own** config path
(`~/.jivam/config.json`), separate from jiva-core CLI's own config. See
[overview.md](overview.md) for the migration behavior between the two.

The config shape relevant to jiva-core:

```typescript
{
  models: {
    reasoning: {
      provider?: string
      apiKey?: string
      endpoint?: string
      defaultModel?: string
      useHarmonyFormat?: boolean
      reasoningEffortStrategy?: 'api_param' | 'system_prompt' | 'both'
      hasVision?: boolean   // reasoning model has native vision — see below
    }
    multimodal?: { endpoint, apiKey, defaultModel }   // optional, separate captioning model
  }
  mcpServers?: Record<string, MCPServerConfig>
  workspaceDir?: string
}
```

### Vision-capable reasoning models (`hasVision`)

jiva-core previously assumed vision required a dedicated `multimodal`-typed
model, routing images through a caption-then-forward pipeline. A `hasVision`
boolean was added so a `reasoning`-typed model can declare native vision
support and receive image content directly — no separate multimodal model
config needed. If a provider's reasoning model itself supports vision (e.g.
some Groq/Krutrim vision-enabled models), set `hasVision: true` on
`models.reasoning` instead of configuring `models.multimodal`. Jivam's
`server/routes/config.ts` provider presets don't currently set this
automatically for any preset — check there before assuming a given preset
does the right thing.

---

## DualAgent

`DualAgent` is jiva-core's primary agent class. JivaRunner wraps it:

| JivaRunner method | DualAgent call | Notes |
|-------------------|----------------|-------|
| `initialize()` | `new DualAgent(config)` | Constructs with model config, persona, directive |
| `chat(prompt, onPhase)` | `agent.chat(prompt)` | Streams phase events via callback |
| `resetConversation()` | `agent.resetConversation()` | Clears in-memory conversation state |
| `loadConversation(id)` | `agent.loadConversation(id)` | Loads from `~/.jiva/conversations/<id>.json` |
| `saveConversation()` | `agent.saveConversation()` | Saves to `~/.jiva/conversations/` |
| `switchPersona(name)` | `agent.cleanup()` + `new DualAgent(...)` | Full re-init with new persona dir |
| `cleanup()` | `agent.cleanup()` | Closes MCP connections, frees resources |

---

## Directive Injection

Before each agent initialization, `server/directive-manager.ts` writes a
directive file to `~/.jiva/jiva-directive.md`. This file contains:

- Today's date (so the agent always knows the current date)
- Any custom user instructions configured for the active persona

jiva-core reads this file as a system-level context injection, so the
directive takes effect on every conversation without needing to be in the
message history.

**Known jiva-core bug already fixed** (see `../CLAUDE.md` for the full
story): jiva-core's `ManagerAgent.getSystemMessages()` used to append the
directive as a *second* system-role message, which some providers (Krutrim's
Qwen3.6) reject outright. Fixed in jiva-core by merging the directive into
the single system message instead. If a "System message must be at the
beginning" error resurfaces, check for a similar double-system-message
pattern in whichever agent class is failing.

---

## Persona System

Personas live in `~/.jiva/personas/<name>/`. Each persona directory may contain:

- `.jiva-plugin/plugin.json` — manifest with `name`, `description`, `tags`
- `CLAUDE.md` or `SKILL.md` — persona instructions read by jiva-core
- Custom tools, skills, or resource files

`server/persona-manager.ts` handles:
- `listPersonas()` — scans `~/.jiva/personas/`, reads manifests, returns `PersonaInfo[]`
- `activatePersona(name)` — writes `~/.jiva/active-persona.txt` (fallback if CLI unavailable)
- `getActivePersona()` — reads from config's `activePersona` field, falls back to `active-persona.txt`

---

## MCP Server Management

MCP (Model Context Protocol) servers extend the agent with external tools. They are configured in `config.mcpServers`:

**Stdio server** (local process):
```json
{
  "myServer": {
    "command": "node",
    "args": ["/path/to/server.js"],
    "env": { "API_KEY": "..." },
    "enabled": true
  }
}
```

**HTTP server** (remote):
```json
{
  "remoteServer": {
    "url": "http://localhost:8080/mcp",
    "enabled": true
  }
}
```

`MCPServerManager` (jiva-core) manages connections. JivaRunner exposes these
live operations (backing `server/routes/mcp.ts` — see
[api-contract.md](api-contract.md)):

| Method | Description |
|--------|-------------|
| `getMCPServerStatus()` | Current connection state + tool count for each server |
| `getMCPTools()` | All tools grouped by server name |
| `addMCPServer(name, config)` | Add and connect a new server at runtime |
| `removeMCPServer(name)` | Disconnect and remove a server at runtime |
| `toggleMCPServer(name, enabled)` | Enable/disable without removing |
| `reconnectMCPServer(name)` | Force reconnect a failed server |

Config changes are written to disk immediately via `writeConfig()` so they persist across restarts.
