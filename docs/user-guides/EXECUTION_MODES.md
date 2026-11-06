# Execution Modes

Jiva operates in two distinct modes. You can switch between them with a CLI flag or environment variable.

## General Mode (Default)

```bash
jiva chat
```

A two-agent pipeline for complex, multi-step tasks:

- **Manager Agent** — plans, decomposes, and synthesizes results.
- **Worker Agent** — executes subtasks using configured MCP servers.
- **Client Agent** — validates the final response.

Best for: open-ended exploration, multi-tool workflows, tasks that require synthesis across multiple sources.

## Code Mode (`--code`)

```bash
jiva chat --code
jiva run "Refactor auth module" --code
```

A single streaming loop optimized for software engineering:

- Direct model → tools → model loop (no inter-agent overhead).
- Tools run in-process (no subprocess overhead).
- Multi-strategy edit engine handles whitespace and indentation drift.
- LSP integration surfaces compiler errors after every file edit.
- Optional `--plan` mode shows a structured plan before any file is modified.

Best for: coding, refactoring, debugging, file manipulation, anything that benefits from immediate compiler feedback.

## Plan Mode (`--plan`)

```bash
jiva chat --code --plan
```

When combined with `--code`, each message goes through a two-phase flow:

1. **Plan phase** (read-only): exploration with `glob`, `grep`, `read_file`. No edits allowed.
2. **Approval gate**: REPL shows the plan and asks `Implement this plan? [Y/n]`.
3. **Implementation phase**: full tool set available; model knows it is implementing an approved plan.

## Choosing a Mode

| Scenario | Mode |
|---|---|
| "What changed in the last 5 commits?" | General |
| "Refactor the auth module" | Code (`--code`) |
| "Build a REST API with SQLite" | Code (`--code --plan`) |
| "Find and summarize all TODO comments" | General or Code |
| "Deploy to Cloud Run" | General (uses MCP tools) |
