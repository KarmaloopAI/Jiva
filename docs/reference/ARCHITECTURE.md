# Jiva Architecture Overview

Jiva is built around a single `IAgent` interface that is satisfied by two concrete implementations: `DualAgent` (general mode) and `CodeAgent` (code mode). Both share the same model orchestrator, workspace manager, conversation manager, and storage provider.

## High-Level Design

```
User Request
    │
    ▼
┌─────────────────┐
│  CLI / HTTP     │  (agent-agnostic interface)
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
DualAgent  CodeAgent
(General)  (Code)
```

Both agents implement `IAgent` and are interchangeable in application code. The CLI REPL, HTTP session manager, and chat routes all program to `IAgent`.

## General Mode — DualAgent

A three-stage pipeline designed for complex, multi-step tasks:

```
User Request
    ↓
Manager Agent    — plans, decomposes, synthesizes
    ↓
Worker Agent     — executes subtasks with MCP tools
    ↓
Client Agent     — validates results
    ↓
Response
```

- **Manager** produces a structured plan before any execution.
- **Worker** executes subtasks using any configured MCP server (filesystem, browser, shell, etc.).
- **Client** validates the final response against the original request.
- Three separate LLM calls per turn; tool execution via MCP subprocesses.

## Code Mode — CodeAgent

A single streaming loop optimized for software engineering:

```
User Request
    ↓
CodeAgent
    loop until done or maxIterations:
        LLM call with tool definitions (JSON Schema)
        ↓
        Tool execution (in-process, no subprocess)
        ↓
        LSP feedback after file edits
    ↓
Response
```

- One LLM endpoint per loop iteration.
- Tools run inside the same Node.js process (direct `fs` access, no JSON serialization overhead).
- Multi-strategy edit engine (`edit_file`) handles whitespace drift and indentation inconsistencies.
- Per-path async mutex (`FileLock`) serializes concurrent edits to the same file.
- Doom-loop detection: if the same tool is called with the same arguments 3 times in a row, a correction message is injected.
- Context compaction (`ConversationManager.condense()`) triggers automatically when history approaches the model's context limit.

## Shared Components

| Component | Purpose |
|---|---|
| `ModelOrchestrator` | Routes to reasoning / multimodal models; handles fallback |
| `MCPServerManager` | Starts and manages MCP server subprocesses |
| `WorkspaceManager` | Workspace isolation, directive loading |
| `ConversationManager` | History, save/restore, condensing |
| `StorageProvider` | Abstract storage (local, GCS, etc.) |

## Source Map

```
src/
├── core/
│   ├── agent-interface.ts     # IAgent
│   ├── agent.ts               # DualAgent
│   ├── code-agent.ts          # CodeAgent
│   ├── orchestrator.ts        # ModelOrchestrator
│   ├── workspace-manager.ts   # WorkspaceManager
│   ├── conversation-manager.ts # ConversationManager
│   └── storage-provider.ts    # StorageProvider
├── interfaces/
│   ├── cli/                   # CLI REPL, commands
│   └── http/                  # HTTP/WebSocket server
└── code/
    ├── agent.ts               # CodeAgent entry point
    ├── file-lock.ts           # Per-path async mutex
    ├── tools/                 # read, edit, write, glob, grep, bash, spawn
    └── lsp/                   # Language server integration
```

For the full code-mode deep dive, see [Code Mode Architecture](CODE_MODE.md).
