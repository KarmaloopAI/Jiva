# Parallel Tool Execution

When a model returns several tool calls in one response, Jiva runs the independent ones **concurrently** and the rest one at a time, in order. This applies to code mode (`CodeAgent`, including plan mode), the general-mode Worker, and the evaluator harness. All of them share one scheduler: `src/core/tool-scheduler.ts`.

## How calls are scheduled

Each tool call declares what it touches:

| Tool | Access | Runs in parallel with… |
|---|---|---|
| `read_file` | reads its path | other reads; writes to *other* files |
| `glob`, `grep` | reads the whole workspace | other reads |
| `edit_file`, `write_file` | writes its path | reads of / writes to *other* files |
| `bash` (read-only command) | reads the whole workspace | other reads |
| `bash` (anything else) | exclusive | nothing — runs alone |
| `spawn_code_agent`, `spawn_agent` | exclusive | nothing |
| MCP tool with `readOnlyHint: true` | reads the whole workspace | other reads |
| Any other MCP tool | exclusive | nothing |
| Evaluator `interact_with_agent` | exclusive | nothing |

The calls are walked **in the order the model issued them** and grouped:

- A group keeps growing while the next call doesn't conflict with anything already in it.
- A conflict (same path written and read or written twice, or `*` against any write) or an exclusive call starts a new group.
- Groups run one after another. Calls within a group run concurrently, capped by `maxConcurrency`.

Nothing is reordered across a conflict:

```
[read a, read b, grep]      → one group, all concurrent
[edit a, edit b]            → one group (different files)
[edit a, read a]            → two groups — the read sees the edit
[read a, bash "npm test"]   → two groups — bash runs alone
```

**Results always come back in call order**, whatever order the calls finished in. That is what providers expect for parallel tool-calling.

One call failing does not affect the others. Every `tool_call_id` always gets a tool response.

### Read-only shell commands

`bash` commands are classified by a conservative allowlist (`src/code/tools/bash-readonly.ts`):

- **Allowed:** `ls`, `cat`, `head`, `tail`, `wc`, `grep`/`rg`, `find` (without `-exec`/`-delete`), `git status|diff|log|show|branch|ls-files|…`, and pipelines made only of these.
- **Always rejected:** redirection, substitution (`$(…)`, backticks, `${…}`), chaining (`;`, `&&`, `||`, `&`), multi-line commands, and Windows.

When in doubt, the command runs alone. The allowlist only affects scheduling; it never blocks a command.

### Loop bookkeeping

Doom-loop detection and the consecutive-read nudge are evaluated **before** dispatch, in call order. Calls after a cutoff are not executed; they get a "Skipped — …" tool response instead.

Instructions for the model are appended **after** the last tool result. These include doom-loop STOP messages, the read-streak nudge, Worker dry-run reminders, and circuit-breaker warnings. This keeps every tool-call group contiguous.

### Cancellation

`CodeAgent.stop()` aborts the turn. Running `bash` commands are killed, and queued calls are skipped with a stub result.

## Configuration

```json
{
  "toolExecution": {
    "parallel": true,
    "maxConcurrency": 8
  }
}
```

| Setting | Where | Default |
|---|---|---|
| `toolExecution.parallel` / `.maxConcurrency` | `~/.jiva/config.json` | `true` / `8` |
| `JIVA_PARALLEL_TOOLS=false`, `JIVA_MAX_TOOL_CONCURRENCY=4` | environment (overrides config) | — |
| `agentConfig.parallelTools` | HTTP per-session (overrides env) | — |
| `jiva benchmark --no-parallel-tools` | benchmark A/B baseline | parallel on |

## Measuring it

Every code-mode turn logs a timing line and returns `timing` on `AgentResponse`:

```
[CodeAgent] Turn timing: total 14527ms, model 14484ms, tools 33ms (parallel saved 75ms, max 9 concurrent)
```

| Field | Meaning |
|---|---|
| `llmMs` / `toolMs` / `totalMs` | Where the turn's wall-clock went |
| `maxCallsPerResponse` | Largest number of tool calls the model issued in one response |
| `maxBatchSize` | Largest number of calls that actually ran concurrently |
| `parallelSavedMs` | Sum of individual call durations minus batch wall time |

The benchmark report aggregates these values: model time, tool time, and time saved.

## What to expect

Parallel execution only helps when **the model issues several calls per response**. This is a model behaviour; Jiva's prompts encourage it, but some models ignore that. On Jiva's own code-mode request, measured via OpenRouter in October 2026:

| Model | Calls per response for "read these 3 files" |
|---|---|
| `z-ai/glm-4.6`, `moonshotai/kimi-k2`, `anthropic/claude-haiku-4.5`, `google/gemini-2.5-flash` | 3 (batched) |
| `openai/gpt-5-mini`, `deepseek/deepseek-chat-v3.1` | mostly 3 / mostly 1 |
| `openai/gpt-oss-120b` (any provider), `qwen/qwen3-coder` | 1 (always sequential) |

The biggest win from batching models is fewer **model round-trips**. In one exploration prompt (7 files plus 2 shell commands), GLM-4.6 finished in 2 iterations, while Qwen3-Coder needed 10.

The scheduler then removes the remaining serial tool time. That matters most for slow tools: shell commands, network MCP tools, and LSP diagnostics after edits. It matters little for in-process file reads, which take milliseconds.

In the taskstore benchmark, model time is about 98% of wall-clock. Further speed-ups there come from the model side: a faster provider, fewer iterations, and prompt caching.

## Related changes that cut latency

- **Async file tools.** `read_file`, `grep` and `glob` use non-blocking `fs.promises`, so concurrent calls genuinely overlap instead of blocking the event loop.
- **LSP outside the file lock.** `edit_file` and `write_file` hold the per-file lock only for read→modify→write. The 150 ms–3 s diagnostics wait happens after release.
- **LSP diagnostics race fixed.** The listener is registered before the file is opened, so a fast language server no longer forces the full 3 s timeout.
- **Non-blocking titles.** A new conversation is saved immediately with a heuristic title. The LLM-generated title is patched in later, in the background.
- **Startup.**
  - Model connectivity checks run concurrently.
  - Code mode only starts the MCP servers it exposes (`codeMode: true` or `--mcp`); HTTP code-mode sessions start none.
  - Persona MCP servers start concurrently.
