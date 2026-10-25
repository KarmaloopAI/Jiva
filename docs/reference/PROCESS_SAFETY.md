# Process Safety — never killing itself

jiva-core runs inside a Node.js process: the `jiva` CLI, the HTTP server, or an app that embeds it, such as Jivam, where jiva-core lives *inside the Jivam server process*. A model that "cleans up" with `pkill node` or `lsof -ti :7842 | xargs kill` would kill that process, and with it the agent that issued the command.

## Two layers

1. **Prompt.** The code-mode and Worker system prompts include a *process safety* paragraph covering:
   - who the agent is: host name, PID, parent PID and protected ports;
   - that it must never kill processes by name or broadly;
   - how to stop things safely: by the specific PID it started, or by its own dev server's port.
2. **Enforcement.** `checkShellCommand()` (`src/core/process-guard.ts`) runs before every shell execution, whatever the model decides. Shell executions are:
   - the code-mode `bash` tool;
   - shell-type MCP tools (`*__shell_exec`, `run_command`, …) in `MCPClient.executeTool`, which covers the Worker, its repair path, code-mode MCP adapters, the evaluator and `ClientAgent`.

   A refused command returns a tool error explaining why and what to do instead. The turn continues.

## What is refused

- Name-based kills of Node/framework processes:
  - `pkill node`, `pkill -f node|npm|npx|tsx|jiva|jivam`, `killall node`;
  - `kill $(pgrep node)`, `pgrep node | xargs kill`, `ps … | grep node | … kill`;
  - `taskkill /IM node.exe`, `Stop-Process -Name node`.
- Kills targeting this process, its parent, or registered extra PIDs, including `kill $PPID`.
- Kills targeting registered ports: `lsof -ti :PORT | xargs kill`, `kill $(lsof -ti :PORT)`, `fuser -k PORT/tcp`, `npx kill-port PORT`.
- Catch-all kills: `kill -9 -1`, `kill 0`, `pkill -u …`.

Targeted management is allowed. For example, `kill 12345`, `lsof -ti :3000 | xargs kill` and `pkill -f vite` all run.

The guard parses commands with a quote-aware splitter. It is a safety net for model mistakes, not a sandbox.

## For embedding apps

Register the host identity once at startup:

```ts
import { registerHostIdentity } from 'jiva-core';
registerHostIdentity({ name: 'MyApp', ports: [8080], extraPids: [supervisorPid] });
```

`process.pid` and `process.ppid` are protected automatically. `getHostIdentity()` returns the current identity.
