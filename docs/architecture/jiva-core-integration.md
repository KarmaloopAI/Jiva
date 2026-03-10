# jiva-core Integration

Jivam does not bundle jiva-core. It dynamically loads the globally installed npm package at runtime. This means:

- Users must have `npm install -g jiva-core` before Jivam can start
- Updating jiva-core globally is sufficient — no Jivam rebuild needed
- The integration layer is entirely in `electron/jiva-runner.ts`

---

## Runtime Resolution

### `augmentPath()`

In a packaged Electron app, the OS launches the process with a minimal PATH that often excludes npm's global bin directory. `augmentPath()` fixes this by spawning the user's login shell:

```typescript
const loginPath = execSync(`${shell} -l -c 'echo $PATH'`).toString().trim()
process.env.PATH = loginPath
```

This runs before any `execSync` or `import()` calls that depend on npm being on PATH.

### `resolveJivaCoreEntryPath()`

Finds the jiva-core ESM entry point:

1. `npm root -g` → e.g. `/usr/local/lib/node_modules` → checks for `jiva-core/package.json`
2. Fallback: `~/.npm-global/lib/node_modules/jiva-core/package.json` (common Linux setup)
3. Fallback: `./node_modules/jiva-core/package.json` (development / local install)

Reads `package.json` → follows the `"exports"` or `"main"` field to get the entry file path.

### Dynamic ESM Import

```typescript
const { DualAgent, ConversationManager, MCPServerManager } = await import(entryPath)
```

This is a true ESM dynamic import — no CommonJS `require()`. jiva-core is an ESM-only package.

---

## Configuration

Config is read via `readConfig()` in `electron/config-manager.ts`, which reads from `getJivaConfigPath()` — the platform-specific location where jiva-core stores its `config.json`.

The config shape relevant to jiva-core:

```typescript
{
  models: {
    reasoning: {
      provider?: string     // e.g. 'anthropic', 'openai'
      apiKey?: string
      endpoint?: string
      model?: string
      useHarmonyFormat?: boolean
    }
  }
  mcpServers?: Record<string, MCPServerConfig>
  workspaceDir?: string
}
```

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

Before each agent initialization, `electron/directive-manager.ts` writes a directive file to `~/.jiva/jiva-directive.md`. This file contains:

- Today's date (so the agent always knows the current date)
- Any custom user instructions configured for the active persona

jiva-core reads this file as a system-level context injection, so the directive takes effect on every conversation without needing to be in the message history.

---

## Persona System

Personas live in `~/.jiva/personas/<name>/`. Each persona directory may contain:

- `.jiva-plugin/plugin.json` — manifest with `name`, `description`, `tags`
- `CLAUDE.md` or `SKILL.md` — persona instructions read by jiva-core
- Custom tools, skills, or resource files

`electron/persona-manager.ts` handles:
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

`MCPServerManager` (jiva-core) manages connections. JivaRunner exposes these live operations:

| Method | Description |
|--------|-------------|
| `getMCPServerStatus()` | Current connection state + tool count for each server |
| `getMCPTools()` | All tools grouped by server name |
| `addMCPServer(name, config)` | Add and connect a new server at runtime |
| `removeMCPServer(name)` | Disconnect and remove a server at runtime |
| `toggleMCPServer(name, enabled)` | Enable/disable without removing |
| `reconnectMCPServer(name)` | Force reconnect a failed server |

Config changes are written to disk immediately via `writeConfig()` so they persist across restarts.
