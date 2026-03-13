# Jiva

[![npm version](https://img.shields.io/npm/v/jiva-core.svg)](https://www.npmjs.com/package/jiva-core)
[![License](https://img.shields.io/github/license/KarmaloopAI/Jiva.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/KarmaloopAI/Jiva.svg?style=social&label=Star)](https://github.com/KarmaloopAI/Jiva)

Jiva is an autonomous AI agent for the terminal and cloud. It works with any OpenAI-compatible model provider and supports two execution modes — a general-purpose two-agent system (Manager + Worker) for complex tasks, and a code-optimized single-loop engine with LSP integration for software engineering.

## Demo

![Demo](jiva-new-demo.gif)

---

## Installation

```bash
npm install -g jiva-core
jiva setup
```

The setup wizard prompts for your API endpoint, key, and model name. Jiva works with Krutrim, Groq, OpenAI, Ollama, and any OpenAI-compatible provider.

### Development install

```bash
git clone https://github.com/KarmaloopAI/Jiva.git
cd Jiva
npm install && npm run build && npm link
jiva setup
```

---

## Quick Start

```bash
# General-purpose interactive session
jiva chat

# Code mode — optimized for software engineering tasks
jiva chat --code

# Code mode with plan-then-approve flow
jiva chat --code --plan

# Single prompt
jiva run "What changed in the last 5 commits?"

# Single prompt in code mode
jiva run "Add error handling to the database module" --code
```

### REPL commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/tools` | List active tools |
| `/servers` | Show MCP server status |
| `/save` | Save current conversation |
| `/load` | Resume a saved conversation |
| `/list` | Browse all saved conversations |
| `/reset` | Clear conversation history |
| `/exit` | Exit Jiva |

---

## Execution Modes

### General mode (default)

A two-agent pipeline designed for complex, multi-step tasks:

```
User Request
    ↓
Manager Agent    — plans, decomposes, and synthesizes
    ↓
Worker Agent     — executes subtasks with MCP tools
    ↓
Response
```

The Worker has access to any configured MCP server (filesystem, browser automation, shell commands, etc.). The Manager synthesizes results from all subtasks into a final coherent response. Simple conversational messages are answered directly without executing subtasks.

### Code mode (`--code`)

A single streaming loop optimized for coding tasks:

```
User Request
    ↓
CodeAgent
    loop until done:
        LLM call with tool definitions
        ↓
        Tool execution (in-process, no subprocess)
        ↓
        LSP feedback after file edits
    ↓
Response
```

Code mode reduces latency by eliminating inter-agent overhead and running all file tools directly in the Node.js process. It includes a multi-strategy edit engine that reliably handles indentation drift and whitespace inconsistencies.

**Available tools in code mode:**

| Tool | Description |
|------|-------------|
| `read_file` | Read files with line numbers, list directories |
| `edit_file` | Multi-strategy string replacement (9 strategies) |
| `write_file` | Create or overwrite files |
| `glob` | Find files by pattern |
| `grep` | Regex content search |
| `bash` | Run shell commands |
| `spawn_code_agent` | Delegate a sub-task to a child agent |

**LSP integration:** After each file edit, Jiva notifies the appropriate language server and appends any compiler errors to the tool result. Language servers are auto-detected from your PATH. If none is installed for a given language, the tool continues silently.

```bash
# Install language servers (optional but recommended for code mode)
npm install -g typescript-language-server typescript   # TypeScript / JavaScript
pip install python-lsp-server                          # Python
go install golang.org/x/tools/gopls@latest             # Go
rustup component add rust-analyzer                     # Rust
```

For a complete technical reference see [Code Mode Architecture](docs/architecture/CODE_MODE.md).

---

## Configuration

```bash
# Run setup wizard
jiva setup

# View or update settings interactively
jiva config

# View current configuration and file path
jiva config --show
```

Configuration is stored at `~/.config/jiva-nodejs/config.json` (Linux/macOS) or `%APPDATA%\jiva-nodejs\config.json` (Windows).

### Provider examples

**Krutrim (gpt-oss-120b)**
```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://cloud.olakrutrim.com/v1/chat/completions",
      "apiKey": "kr-...",
      "model": "gpt-oss-120b",
      "type": "reasoning",
      "useHarmonyFormat": true
    }
  }
}
```

**Groq**
```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "apiKey": "gsk_...",
      "model": "openai/gpt-oss-20b",
      "type": "reasoning"
    }
  }
}
```

**Ollama (local)**
```json
{
  "models": {
    "reasoning": {
      "endpoint": "http://localhost:11434/v1/chat/completions",
      "apiKey": "not-needed",
      "model": "llama3.1",
      "type": "reasoning"
    }
  }
}
```

### Code mode configuration

```json
{
  "codeMode": {
    "enabled": true,
    "lsp": { "enabled": true },
    "maxIterations": 50
  }
}
```

Full configuration reference: [Configuration Guide](docs/guides/CONFIGURATION.md)

---

## Directive Files

Create a `jiva-directive.md` in your project root to orient the agent to your codebase:

```markdown
# Purpose
Code review assistant for a Django web application.

# Tasks
- Scan for security vulnerabilities (SQLi, XSS, CSRF)
- Identify performance bottlenecks
- Suggest modern Python best practices

# Constraints
- Only analyze .py files
- Do not modify files without explicit approval

# Context
PostgreSQL backend, GDPR-sensitive user data.
```

Jiva searches for directive files automatically:
1. Path given via `--directive`
2. `jiva-directive.md` in the workspace root
3. `.jiva/directive.md` in the workspace root

---

## MCP Servers (general mode)

General mode uses MCP servers to extend the agent's capabilities. Jiva ships with the filesystem server enabled; additional servers can be added via `jiva config`.

### Recommended servers

**Playwright** — browser automation, web scraping, screenshot capture

```bash
jiva config
# MCP Servers > Add Server
# Name: playwright  Command: npx  Args: @playwright/mcp@latest
```

**Desktop Commander** — shell command execution, process management

```bash
# Name: desktop-commander  Command: npx  Args: -y desktop-commander
```

Other popular servers: GitHub, Postgres, Slack, Google Maps — see [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers).

---

## Cloud Deployment

Jiva can be deployed as a stateless, auto-scaling HTTP/WebSocket service on Google Cloud Run with GCS-backed session persistence and multi-tenant isolation.

```bash
git clone https://github.com/KarmaloopAI/Jiva.git
cd Jiva
./deploy.sh YOUR_PROJECT_ID us-central1
```

The deployment script enables required GCP APIs, creates the GCS bucket, configures IAM roles, and deploys the container. After deployment:

```bash
SERVICE_URL=$(gcloud run services describe jiva --region=us-central1 --format='value(status.url)')

# Health check
curl $SERVICE_URL/health

# Chat via REST
curl -X POST $SERVICE_URL/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: my-session" \
  -d '{"message": "Hello, Jiva!"}'
```

**Code mode in the cloud:**

```bash
gcloud run services update jiva \
  --set-env-vars JIVA_CODE_MODE=true \
  --region us-central1
```

Full guide: [Cloud Run Deployment](docs/deployment/CLOUD_RUN_DEPLOYMENT.md)

---

## Personas and Skills

Jiva supports persona-based skill management, compatible with Claude's Skills/Plugins format:

```bash
jiva persona list
jiva persona activate data-analyst
jiva persona create-skill my-skill --description "Custom capability" --author "Your Name"
```

Skills bundle MCP servers, directives, and model behavior overrides into portable `.skill` files. See [Personas Guide](docs/guides/PERSONAS.md).

---

## Programmatic Usage

```typescript
import { DualAgent, CodeAgent, createKrutrimModel, ModelOrchestrator,
         MCPServerManager, WorkspaceManager, ConversationManager,
         createStorageProvider } from 'jiva-core';

const reasoningModel = createKrutrimModel({
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  apiKey: process.env.API_KEY!,
  model: 'openai/gpt-oss-20b',
  type: 'reasoning',
});
const orchestrator = new ModelOrchestrator({ reasoningModel });
const storageProvider = await createStorageProvider();
const workspace = new WorkspaceManager(storageProvider);
await workspace.initialize();
const conversationManager = new ConversationManager(storageProvider);

// General mode
const mcpManager = new MCPServerManager();
await mcpManager.initialize({
  filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()], enabled: true },
});
const agent = new DualAgent({ orchestrator, mcpManager, workspace, conversationManager });
const response = await agent.chat('What files are in this directory?');
console.log(response.content);
await agent.cleanup();

// Code mode
const codeAgent = new CodeAgent({ orchestrator, workspace, conversationManager, maxIterations: 50, lspEnabled: true });
const codeResponse = await codeAgent.chat('Refactor the auth module to use async/await');
console.log(codeResponse.content);
await codeAgent.cleanup();
```

Both `DualAgent` and `CodeAgent` implement the `IAgent` interface and are interchangeable in application code.

---

## Development

```bash
npm run build        # compile TypeScript
npm run dev          # watch mode
npm run type-check   # type-check without emit
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](docs/guides/QUICKSTART.md) | Get running in 30 seconds |
| [Configuration Guide](docs/guides/CONFIGURATION.md) | All config options and provider examples |
| [Code Mode Architecture](docs/architecture/CODE_MODE.md) | How code mode works internally |
| [Cloud Run Deployment](docs/deployment/CLOUD_RUN_DEPLOYMENT.md) | Production deployment guide |
| [Personas Guide](docs/guides/PERSONAS.md) | Skills and persona system |
| [Troubleshooting](docs/guides/TROUBLESHOOTING.md) | Common issues and fixes |
| [Release Notes](docs/release_notes/) | Version history |

---

## Contributing

Contributions are welcome. Please ensure new features include error handling and that documentation is updated. Open a PR against the `develop` branch.

## License

MIT

## References

- [gpt-oss-120b Model Card](https://huggingface.co/openai/gpt-oss-120b)
- [Harmony Response Format](https://github.com/openai/harmony)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Krutrim Cloud API](https://cloud.olakrutrim.com/)
