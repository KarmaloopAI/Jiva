# Jiva Documentation

> Autonomous AI agent for the terminal and cloud. Works with any OpenAI-compatible model provider. Two execution modes: a general-purpose two-agent system (Manager + Worker) for complex tasks, and a code-optimized single-loop engine with LSP integration for software engineering.

---

## For First-Time Users

| What you need | Where to go |
|---|---|
| Install and run in 30 seconds | [Getting Started → Quick Start](getting-started/QUICK_START.md) |
| Understand the two execution modes | [User Guides → Execution Modes](user-guides/EXECUTION_MODES.md) |
| Configure your model provider | [User Guides → Configuration](user-guides/CONFIGURATION.md) |
| Use OpenRouter with ranked providers | [User Guides → OpenRouter](user-guides/OPENROUTER.md) |
| Try the benchmark suite | [User Guides → Benchmarking](user-guides/BENCHMARK.md) |
| Learn REPL commands and skills | [User Guides → Skills & Personas](user-guides/SKILLS.md) |

---

## For Developers & Contributors

| What you need | Where to go |
|---|---|
| Build from source | [Developer Guides → Build & Dev Workflow](developer-guides/BUILD.md) |
| Understand the architecture | [Reference → Architecture](reference/ARCHITECTURE.md) |
| Deep dive into code mode | [Reference → Code Mode](reference/CODE_MODE.md) |
| Use Jiva programmatically | [Configuration → Programmatic Configuration](user-guides/CONFIGURATION.md#programmatic-configuration) and [examples/programmatic-usage.ts](../examples/programmatic-usage.ts) |
| Contribute guidelines | [Developer Guides → Contributing](developer-guides/CONTRIBUTING.md) |

---

## For Operators & DevOps

| What you need | Where to go |
|---|---|
| Deploy to Google Cloud Run | [Deployment → Cloud Run](deployment/CLOUD_RUN_DEPLOYMENT.md) |
| Understand multi-tenant isolation | [Deployment → Cloud Run Implementation](deployment/CLOUD_RUN_IMPLEMENTATION.md) |
| Configure authentication & secrets | [Deployment → Cloud Run Deployment](deployment/CLOUD_RUN_DEPLOYMENT.md#authentication) and [HTTP API → Authentication](deployment/HTTP_API.md#authentication) |
| Call the HTTP / WebSocket API | [Deployment → HTTP API](deployment/HTTP_API.md) |

---

## Reference & Deep Dives

- [Architecture Overview](reference/ARCHITECTURE.md) — Manager/Worker pipeline, CodeAgent loop, LSP integration
- [Code Mode Architecture](reference/CODE_MODE.md) — Single-loop engine, multi-strategy edit, file locking, doom-loop detection
- [Configuration Guide](user-guides/CONFIGURATION.md) — Full `config.json` schema, provider examples, environment variables
- [Benchmark Suite](user-guides/BENCHMARK.md) — `taskstore` (baseline) and `microcrm` (capability) suites
- [Skills & Personas](user-guides/SKILLS.md) — `SKILL.md` format, persona bundles, slash commands
- [Parallel Tool Execution](reference/TOOL_EXECUTION.md) — How independent tool calls run concurrently, configuration, measured impact
- [Agentic Pipeline](reference/AGENTIC_PIPELINE.md) — Deterministic-gather → bounded-AI → deterministic-output pattern
- [Agent Spawning](reference/AGENT_SPAWNING.md) — Sub-agents with personas
- [Harnesses](user-guides/HARNESSES.md) — Evaluator-based task validation
- [HTTP API](deployment/HTTP_API.md) — REST and WebSocket endpoints
- [Release Notes](release-notes/CHANGELOG.md) — Consolidated version history

---

## Documentation Structure

```
docs/
├── README.md                 # This file — entry point for all audiences
├── getting-started/          # First-time users (install, quick start, first commands)
├── user-guides/              # End-user guides (modes, config, skills, troubleshooting)
├── developer-guides/         # Contributors (build, workflow, contributing)
├── deployment/               # Production deployment (Cloud Run, HTTP API, implementation notes)
├── reference/                # Deep technical docs (architecture, code mode, pipelines, spawning)
├── architecture/             # Design notes and implementation history (personas, filesystem access, ...)
└── release-notes/            # Version history (consolidated changelog + per-release details)
```

---

## Quick Navigation by Audience

### I am a new user
1. Read [Quick Start](getting-started/QUICK_START.md)
2. Read [Execution Modes](user-guides/EXECUTION_MODES.md)
3. Run `jiva setup` and `jiva benchmark`

### I am a software engineer using code mode
1. Read [Quick Start](getting-started/QUICK_START.md)
2. Read [Code Mode Architecture](reference/CODE_MODE.md)
3. Read [Configuration Guide](user-guides/CONFIGURATION.md)
4. Read [Benchmark Suite](user-guides/BENCHMARK.md)

### I am deploying to production
1. Read [Cloud Run Deployment](deployment/CLOUD_RUN_DEPLOYMENT.md)
2. Read [HTTP API](deployment/HTTP_API.md)
3. Read [Cloud Run Implementation](deployment/CLOUD_RUN_IMPLEMENTATION.md)

### I am contributing code
1. Read [Build & Dev Workflow](developer-guides/BUILD.md)
2. Read [Contributing](developer-guides/CONTRIBUTING.md)
3. Read [Architecture Overview](reference/ARCHITECTURE.md)

---

## Project Overview

**Jiva** (`jiva-core` on npm) is an autonomous AI agent that operates in two distinct modes:

- **General Mode** (`jiva chat`) — A two-agent pipeline (Manager plans, Worker executes with MCP tools) designed for complex, multi-step tasks that require exploration, synthesis, and external tool use.
- **Code Mode** (`jiva chat --code`) — A single streaming loop optimized for software engineering. Tools run in-process (no subprocess overhead), with tight LSP integration for immediate compiler feedback after every file edit.

Both modes share the same `IAgent` interface, the same model orchestrator, and the same workspace/conversation managers. Switching between them requires only a CLI flag or environment variable.

Supported providers: **Krutrim**, **Groq**, **Sarvam**, **OpenRouter**, **OpenAI**, and any **OpenAI-compatible** endpoint. The setup wizard auto-fills endpoint, model name, and tool format based on your selection.

---

## Need Help?

- **Issues:** [GitHub Issues](https://github.com/KarmaloopAI/Jiva/issues)
- **Repository:** [github.com/KarmaloopAI/Jiva](https://github.com/KarmaloopAI/Jiva)
- **npm:** [jiva-core](https://www.npmjs.com/package/jiva-core)
- **License:** MIT
