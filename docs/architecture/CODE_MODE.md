# Code Mode Architecture

Code mode is a single-loop execution engine optimized for software engineering tasks. It replaces the Manager → Worker → Client orchestration chain with a direct model → tools → model loop that has lower latency, no inter-agent message overhead, and tight LSP integration for immediate compiler feedback.

## Activation

**CLI**

```bash
# Interactive session
jiva chat --code

# Single prompt
jiva run "refactor auth module" --code

# Disable LSP (useful if no language servers are installed)
jiva chat --code --no-lsp

# Plan-then-approve mode (see below)
jiva chat --code --plan
```

**Config file (persistent)**

```json
{
  "codeMode": {
    "enabled": true,
    "lsp": { "enabled": true },
    "maxIterations": 50
  }
}
```

**Cloud / HTTP deployment**

```bash
JIVA_CODE_MODE=true          # activate code mode
JIVA_CODE_LSP=false          # optional: disable LSP servers
```

---

## Architecture Comparison

### General mode (DualAgent)

```
User
  └─► Manager (plan)
         └─► Worker × N (execute MCP tools)
                └─► Client (validate)
                       └─► Response
```

Three separate LLM calls per turn, tool execution via MCP subprocesses.

### Code mode (CodeAgent)

```
User
  └─► CodeAgent
         loop until done or maxIterations:
           └─► LLM (with tool definitions in JSON Schema)
                 └─► Tool execution (in-process, no subprocess)
                       └─► Result injected into message history
         └─► Response
```

One LLM endpoint per loop iteration, tools run inside the same Node.js process.

---

## Plan Mode (`--plan`)

When `--plan` is passed alongside `--code`, each user message goes through a two-phase flow before any file is modified:

```
User message
    │
    ▼ Phase 1 — Plan (read-only, no side effects)
CodeAgent.plan()
    ├─ glob / grep / read_file  (exploration, up to 12 iterations)
    └─ model outputs structured plan (no edit/write/bash allowed)
    │
    ▼ REPL shows plan + prompts "Implement this plan? [Y/n]"
    │
    ├─ n → message discarded, user can refine and retry
    │
    └─ Y → Phase 2 — Implement
       CodeAgent.chat(original message + approved plan as context)
           ├─ Full tool set available (edit, write, bash, …)
           └─ Model knows it is implementing an approved plan
```

### Plan output format

The model is instructed to produce:

```markdown
## Summary
1–2 sentence overview of the approach

## Files to Change
| File | Action | What changes |
|------|--------|--------------|
| src/auth/index.ts | edit | Extract token validation into validateToken() |
| src/auth/tokens.ts | create | New module with token utilities |

## Implementation Steps
1. Read src/auth/index.ts to understand current shape
2. Extract the inline validation block into a standalone function
…

## Risks & Considerations
- The existing test suite mocks the inline logic; mock locations will shift
```

### Exploration tools available during planning

Only read-only tools are allowed in the plan phase. Attempts to call `edit_file`, `write_file`, or `bash` return an error message explaining the restriction.

| Tool | Allowed in plan phase |
|------|-----------------------|
| `read_file` | Yes |
| `glob` | Yes |
| `grep` | Yes |
| `edit_file` | No |
| `write_file` | No |
| `bash` | No |
| `spawn_code_agent` | No |

### Relationship to general mode planning

DualAgent's ManagerAgent also produces a plan before execution, but it is internal — the user never sees it and cannot veto it. Code mode's `--plan` flag makes the plan visible and gates execution behind explicit approval.

---

## Source Map

```
src/code/
├── agent.ts              # CodeAgent — the main entry point
├── file-lock.ts          # Per-path async mutex for concurrent edits
├── tools/
│   ├── index.ts          # ICodeTool interface + registry
│   ├── read.ts           # read_file / list_directory
│   ├── edit.ts           # Multi-strategy string replacement + LSP
│   ├── write.ts          # write_file (create/overwrite) + LSP
│   ├── glob.ts           # glob — file pattern matching
│   ├── grep.ts           # grep — regex content search
│   ├── bash.ts           # bash — shell command execution
│   └── spawn.ts          # spawn_code_agent — sub-agent delegation
└── lsp/
    ├── language.ts       # File extension → LSP language ID (60+ extensions)
    ├── server.ts         # Spawn language server process from PATH
    ├── client.ts         # JSON-RPC LSP client (vscode-jsonrpc)
    └── manager.ts        # LspManager: lazy init, one client per language
```

---

## CodeAgent Loop

```typescript
class CodeAgent {
  async chat(userMessage: string): Promise<AgentChatResponse> {
    messages = [...history, userMessage]
    for (i = 0; i < maxIterations; i++) {
      if (isLastStep) {
        // Inject stop message, send no tools → force final text response
      }
      response = orchestrator.chatWithFallback({ messages, tools })
      if (!response.toolCalls.length) return response.content   // done
      for each toolCall:
        result = executeCodeTool(toolCall)
        messages.push(toolResult)
      doomLoopCheck()   // 3× same call → inject warning
    }
  }
}
```

**Iteration budget:** 50 by default (vs 10 per subtask in general mode).
**Last-step mechanic:** At 80% of `maxIterations`, a stop message is injected and tools are withheld, forcing the model to emit a final answer rather than starting another tool call.

---

## Tool Execution

All tools implement `ICodeTool`:

```typescript
interface ICodeTool {
  name: string
  description: string
  parameters: object            // JSON Schema
  execute(args, ctx: CodeToolContext): Promise<string>
}

interface CodeToolContext {
  workspaceDir: string
  lsp: LspManager
  signal: AbortSignal
}
```

Tools run **in-process** — no MCP subprocess, no JSON serialization overhead, direct Node.js `fs` access.

### Tool Reference

| Tool | Parameters | Notes |
|------|-----------|-------|
| `read_file` | `path`, `offset?`, `limit?` | Max 2000 lines, 50 KB cap. Returns `cat -n` style output. |
| `list_directory` | `path` | Lists with `[FILE]`/`[DIR]` prefix. |
| `edit_file` | `file_path`, `old_string`, `new_string`, `replace_all?` | 9 replacement strategies (see below). Calls LSP after edit. |
| `write_file` | `file_path`, `content` | Creates or overwrites. Calls LSP after write. |
| `glob` | `pattern`, `cwd?` | Standard glob patterns relative to workspace. |
| `grep` | `pattern`, `path?`, `include_pattern?` | Regex, recursive, max 100 matches. |
| `bash` | `command`, `timeout_ms?` | Max 300 s. Runs in workspace dir. Returns stdout + stderr + exit code. |
| `spawn_code_agent` | `task`, `context?` | Creates a child `CodeAgent` (depth limited to 2 levels). |

### Multi-Strategy Edit

The `edit_file` tool applies 9 replacement strategies in order, stopping at the first match. This handles whitespace drift and indentation inconsistencies that trip up simpler string-replace approaches:

1. `SimpleReplacer` — exact match
2. `LineTrimmedReplacer` — trim each line before comparing
3. `BlockAnchorReplacer` — anchor on first/last line, fuzzy middle
4. `WhitespaceNormalizedReplacer` — collapse whitespace runs
5. `IndentationFlexibleReplacer` — ignore indentation differences
6. `EscapeNormalizedReplacer` — normalize escape sequences
7. `TrimmedBoundaryReplacer` — trim leading/trailing whitespace on block
8. `ContextAwareReplacer` — Levenshtein-distance fuzzy match
9. `MultiOccurrenceReplacer` — handle blocks appearing multiple times

If `old_string` is empty, `edit_file` delegates to `write_file` (create new file).

After every edit or write, the tool calls `lsp.touchFile()` and appends any LSP errors to the tool result.

---

## LSP Integration

Language Server Protocol support gives the agent compiler-level feedback after each file change — the same feedback a developer sees in their editor.

### How It Works

1. After `edit_file` or `write_file`, `LspManager.touchFile(path)` is called.
2. `LspManager` detects the language from the file extension.
3. If no server is running for that language, it spawns one from PATH (lazy init).
4. The LSP client sends `textDocument/didOpen` or `textDocument/didChange`.
5. The client waits up to 3 seconds for `textDocument/publishDiagnostics`.
6. Any errors are formatted and appended to the tool's return value.

### Language Server Detection

The manager auto-detects servers from PATH by trying known command names:

| Language | Server command |
|---------|---------------|
| TypeScript/JavaScript | `typescript-language-server --stdio` |
| Python | `pylsp` or `pyright-langserver --stdio` |
| Go | `gopls` |
| Rust | `rust-analyzer` |
| C/C++ | `clangd` |
| Others | Detected lazily |

If no server is found for a language, the tool continues silently — LSP support degrades gracefully.

### Installing Language Servers

```bash
# TypeScript / JavaScript
npm install -g typescript-language-server typescript

# Python
pip install python-lsp-server        # or: pip install pyright

# Go
go install golang.org/x/tools/gopls@latest

# Rust
rustup component add rust-analyzer
```

---

## File Locking

`FileLock` (`src/code/file-lock.ts`) is a per-path async mutex. When the model emits multiple tool calls in a single response that target the same file, they are serialized through the lock to prevent interleaved writes.

```typescript
// All edits to the same path are queued automatically
await fileLock.withLock(filePath, async () => {
  // read → modify → write
});
```

---

## Sub-Agent Spawning

`spawn_code_agent` creates a child `CodeAgent` with a focused task:

```
Parent CodeAgent
  └─► spawn_code_agent("write unit tests for auth.ts")
         └─► Child CodeAgent (depth=1, shared LspManager)
               └─► reads auth.ts
               └─► writes auth.test.ts
               └─► runs tests via bash
         └─► returns child's final response
```

Child agents share the parent's `LspManager` so LSP servers are not restarted. Nesting is limited to 2 levels (parent → child, no grandchild) to prevent runaway recursion.

---

## Doom Loop Detection

If the model calls the same tool with the same arguments 3 times in a row, CodeAgent injects a correction message:

```
[System] You are repeating the same action without progress.
Stop and reassess. Try a different approach or report what you've found so far.
```

---

## Context Compaction

When the conversation history approaches the model's context limit (configurable threshold), `ConversationManager.condense()` is called automatically. The condensed history replaces the raw turn-by-turn messages and the loop continues. This mirrors general mode's compaction behavior.

---

## Relationship to General Mode

The `IAgent` interface (`src/core/agent-interface.ts`) is satisfied by both `DualAgent` and `CodeAgent`. The CLI REPL, HTTP session manager, and chat routes are all agent-agnostic — they program to `IAgent`.

```
IAgent
├── DualAgent   (general mode — Manager/Worker/Client + MCP)
└── CodeAgent   (code mode   — single loop + in-process tools + LSP)
```

Switching between modes requires only a flag or environment variable; no application-layer code changes are needed.
