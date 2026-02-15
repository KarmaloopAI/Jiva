# Jiva - Versatile Autonomous AI Agent

[![npm version](https://img.shields.io/npm/v/jiva-core.svg)](https://www.npmjs.com/package/jiva-core) [![License](https://img.shields.io/github/license/KarmaloopAI/Jiva.svg)](LICENSE) [![GitHub stars](https://img.shields.io/github/stars/KarmaloopAI/Jiva.svg?style=social&label=Star)](https://github.com/KarmaloopAI/Jiva)

Jiva is a powerful autonomous AI agent with a three-agent architecture (Manager, Worker, Client) powered by gpt-oss-120b with full MCP (Model Context Protocol) support. Deploy as a CLI tool or scale to production on Google Cloud Run.

## Quick Links

- **[Quick Start Guide](docs/guides/QUICKSTART.md)** - Get up and running in 30 seconds
- **[Cloud Run Deployment](docs/deployment/CLOUD_RUN_DEPLOYMENT.md)** - Deploy to production
- **[Configuration Guide](docs/guides/CONFIGURATION.md)** - Detailed configuration and provider setup
- **[Documentation](docs/README.md)** - Complete documentation index
- **[Build Instructions](docs/guides/BUILD.md)** - Detailed setup and development workflow
- **[Troubleshooting](docs/guides/TROUBLESHOOTING.md)** - Common issues and solutions

## Demo

![Demo](jiva-new-demo.gif)

## Features

### Core Capabilities
- **Three-Agent Architecture**: Manager for planning, Worker for execution, Client for quality validation
- **Adaptive Quality Control**: Client agent uses tiered validation (MINIMAL→STANDARD→THOROUGH) based on task complexity
- **Unjustified Failure Detection**: LLM-powered analysis catches agents giving up without trying
- **Cloud-Ready Deployment**: Run on Google Cloud Run with auto-scaling, WebSocket support, and GCS storage
- **Multi-Tenancy**: Per-tenant isolation with authenticated session management
- **Provider Agnostic**: Works with Krutrim, Groq, OpenAI, Ollama, and any OpenAI-compatible API
- **MCP Integration**: Seamless integration with Model Context Protocol servers for extensible tooling
- **Smart Conversations**: Auto-save, restore, and AI-generated titles for all conversations
- **Directive-Based**: Orient agent behavior with custom `jiva-directive.md` files
- **Storage Abstraction**: Local filesystem or cloud storage (GCS, future: S3, Redis)

### v0.3.1 Features
- **Production Deployment**: One-command Cloud Run deployment with GCS persistence
- **Client Agent**: Intelligent validation that ensures work quality and catches false failures
- **HTTP/WebSocket API**: RESTful endpoints and real-time bidirectional communication
- **Authentication**: Firebase Auth, custom JWT, or development mode
- **Session Management**: Auto-scaling agent instances with idle timeout and cleanup
- **Container Orchestration**: Multi-stage Docker builds, health probes, graceful shutdown
- **Personas & Skills**: 100% compatible with Claude's Skills/Plugins system - extend Jiva with domain-specific capabilities

### Personas (Skills & Plugins)

Jiva supports persona-based skill management, fully compatible with Claude's Skills/Plugins system:

```bash
# List available personas
jiva persona list

# Activate a persona
jiva persona activate data-analyst

# Create your own skill
jiva persona create-skill my-skill \
  --description "Custom functionality" \
  --author "Your Name"

# Package and distribute
jiva persona package-skill my-skill
```

**Key Features:**
- **Progressive Disclosure**: Skills load only what's needed (L1→L2→L3)
- **Automatic Routing**: Agent selects skills based on user request
- **Composable**: Bundle skills, commands, agents, and MCP servers
- **Portable**: Same .skill files work on Claude and Jiva

See **[Personas Guide](docs/guides/PERSONAS.md)** for complete documentation.

### v0.2.1 Features
- **Dual-Agent System**: Separate Manager and Worker agents for better task focus and reliability
- **Chain-of-Thought Logging**: Transparent reasoning at INFO level with clean ASCII formatting
- **Robust Error Recovery**: Automatic retry with error feedback for API and tool failures
- **Workspace-Aware Operations**: Smart path resolution for file operations
- **Slash Commands**: Use `/help`, `/load`, `/save`, `/list` for easy conversation management
- **Smart Tool Format Detection**: Auto-detects Harmony vs Standard OpenAI tool calling format

See [release notes](docs/release_notes/) for detailed version history.

## Installation

### Global Install (Recommended)

```bash
npm install -g jiva-core
```

After installation, run the setup wizard:

```bash
jiva setup
```

### Development Install

```bash
git clone https://github.com/KarmaloopAI/Jiva.git
cd jCLI Mode (Local Development)

#### 1. Install Jiva

```bash
npm install -g jiva-core
```

#### 2. First-Time Setup

Run the interactive setup wizard:

```bash
jiva setup
```

You'll be prompted for:
- Krutrim API endpoint (default: `https://cloud.olakrutrim.com/v1/chat/completions`)
- API key for gpt-oss-120b ([Get your API key](https://cloud.olakrutrim.com))
- Optional multimodal model (Llama-4-Maverick-17B)
- MCP server configuration

#### 3. Start Chatting

Launch interactive mode:

```bash
jiva chat
```

**Try these commands:**
```bash
You: /help                    # Show all available commands
You: /servers                 # Check MCP server status
You: /tools                   # List all available tools
You: List files in this directory
You: /save                    # Save this conversation
You: /list                    # View all saved conversations
```

### Cloud Run Mode (Production)

Deploy Jiva as an auto-scaling HTTP/WebSocket service:

#### 1. Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and configured
- Docker installed (for local testing)

#### 2. One-Command Deployment

```bash
git clone https://github.com/KarmaloopAI/Jiva.git
cd jiva
./deploy.sh YOUR_PROJECT_ID us-central1
```

The script automatically:
- Enables required GCP APIs
- Creates GCS bucket for state storage
- Configures service account and IAM roles
- Builds and deploys container to Cloud Run
- Outputs service URL

#### 3. Test Deployment

```bash
SERVICE_URL=$(gcloud run services describe jiva --region=us-central1 --format='value(status.url)')

# Health check
curl $SERVICE_URL/health

# Chat endpoint (with auth bypass for testing)
curl -X POST $SERVICE_URL/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: test-session" \
  -d '{"message": "Hello, Jiva!"}'
```

**Full deployment guide:** [Cloud Run Deployment](docs/deployment/CLOUD_RUN_DEPLOYMENT.md)ry these commands:**
```bash
You: /help                    # Show all available commands
You: /servers                 # Check MCP server status
You: /tools                   # List all available tools
You: List files in this directory
You: /save                    # Save this conversation
You: /list                    # View all saved conversations
```

### 4. Advanced Usage

**View current configuration:**
```bash
jiva config --show
```

**Use a custom configuration file:**
```bash
jiva chat --config ./my-project-config.json
jiva run "analyze code" --config ./team-config.json
```

**Custom workspace and directive:**
```bash
jiva chat --workspace /path/to/project --directive ./project-directive.md
```

**Single command execution:**
```bash
jiva run "Analyze the code in this directory and suggest improvements"
```

**Enable debug mode:**
```bash
jiva chat --debug
```

### 5. Example Workflows

**Code Review:**
```bash
You: Review all TypeScript files and identify potential bugs
Jiva: *Uses filesystem to read files, analyzes code, provides detailed review*
```

**Web Research:**
```bash
You: Open Hacker News and summarize the top 5 articles
Jiva: *Uses playwright to navigate, scrape content, and summarize*
```

**System Administration:**
```bash
You: Check disk usage and list the 10 largest directories
Jiva: *Uses desktop-commander to run du commands and analyze output*
```

**Conversation Management:**
```bash
You: /list                    # Browse previous conversations
You: /load                    # Resume a conversation
# Select from interactive menu with arrow keys
You: Continue where we left off
```

## Configuration

Configuration is stored in your system's config directory (managed by `conf` package).

### View Configuration Location

```bash
jiva config
```

### Manual Configuration

You can also manually edit the config file. Location varies by OS:
- macOS: `~/Library/Preferences/jiva-nodejs/`
- Linux: `~/.config/jiva-nodejs/`
- Windows: `%APPDATA%\jiva-nodejs\`

## Directive Files

Jiva can be oriented with a `jiva-directive.md` file that defines its purpose, tasks, and constraints.

### Example Directive

Create a file called `jiva-directive.md`:

```markdown
# Purpose

You are a code review assistant focused on identifying security vulnerabilities
and suggesting performance improvements in Python projects.

# Tasks

- Scan Python files for common security issues (SQL injection, XSS, etc.)
- Identify performance bottlenecks
- Suggest modern Python best practices
- Check for outdated dependencies

# Constraints

- Only analyze Python files (.py)
- Do not modify code without explicit approval
- Prioritize security issues over style improvements

# Context

This project is a Django web application with a PostgreSQL database.
It handles sensitive user data and must comply with GDPR.
```

Jiva will automatically look for this file in:
1. Path specified with `--directive` flag
2. `jiva-directive.md` in workspace root
3. `.jiva/directive.md` in workspace root

## MCP Servers

Jiva leverages the Model Context Protocol (MCP) to provide extensible tooling. It comes pre-configured with the Filesystem server and makes it easy to add more.

### Default Server: Filesystem

Provides comprehensive file operations across user directories (subject to OS permissions).

- **Status:** ✅ Enabled by default
- **Package:** `@modelcontextprotocol/server-filesystem`
- **Access:** `/Users` (macOS/Linux) or `C:\Users` (Windows)
- **Tools:** read_file, write_file, list_directory, create_directory, and more
- **Details:** See [FILESYSTEM_ACCESS.md](docs/architecture/FILESYSTEM_ACCESS.md)

### Recommended Additional Servers

#### 1. Playwright MCP - Browser Automation

Control real browsers, take screenshots, scrape web content, and automate web interactions.

```bash
# Add Playwright MCP server
jiva config
# Select "MCP Servers" > "Add Server"
# Name: playwright
# Command: npx
# Args: @playwright/mcp@latest
# Enabled: true
```

**Capabilities:**
- 🌐 Navigate to URLs and interact with web pages
- 📸 Take screenshots and extract page content
- 🤖 Automate web forms and workflows
- 🔍 Scrape data from websites
- 📝 Fill forms and click buttons

**Example usage:**
```
You: Open LinkedIn and take a screenshot
Jiva: *Uses playwright to open LinkedIn, waits for load, captures screenshot*
```

#### 2. Desktop Commander - Shell Command Execution

Execute shell commands, manage processes, and interact with the terminal.

```bash
# Add Desktop Commander MCP server
jiva config
# Select "MCP Servers" > "Add Server"
# Name: desktop-commander
# Command: npx
# Args: -y desktop-commander
# Enabled: true
```

**Capabilities:**
- 💻 Execute shell commands (ls, grep, git, etc.)
- 🔄 Start and manage background processes
- 📊 Read process output with timeout control
- 🎯 Session management for long-running commands

**Example usage:**
```
You: Run npm test and show me the results
Jiva: *Uses desktop-commander to execute tests and parse output*
```

**⚠️ Security Note:** Desktop Commander can execute any shell command. Only enable if you understand the security implications and trust the agent.

### Other Available MCP Servers

The MCP ecosystem offers many more servers:

- **GitHub** (`@modelcontextprotocol/server-github`) - Repository management, issues, PRs
- **Google Maps** (`@modelcontextprotocol/server-google-maps`) - Location data and mapping
- **Slack** (`@modelcontextprotocol/server-slack`) - Team communication
- **Postgres** (`@modelcontextprotocol/server-postgres`) - Database operations
- **Git** (`@modelcontextprotocol/server-git`) - Version control operations
- And more at [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)

### Adding MCP Servers

#### Via Interactive Config

```bash
jiva config
# Navigate: MCP Servers > Add Server
# Fill in: name, command, args, enabled
```

#### Via Manual Config Edit

Edit your config file at `~/.config/jiva-nodejs/config.json` (Linux) or `~/Library/Preferences/jiva-nodejs/config.json` (macOS):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "enabled": true
    },
    "desktop-commander": {
      "command": "npx",
      "args": ["-y", "desktop-commander"],
      "enabled": true
    }
  }
}
```

#### Programmatically

```typescript
### Three-Agent System (v0.3.1)

Jiva uses a three-agent architecture for intelligent task execution:

```
User Request
     ↓
┌────────────────┐
│ Manager Agent  │  Plans subtasks, coordinates workflow
└────────┬───────┘
         ↓
┌────────────────┐
│ Worker Agent   │  Executes subtasks with MCP tools
└────────┬───────┘
         ↓
┌────────────────┐
│ Client Agent   │  Validates outputs, ensures quality
└────────┬───────┘
         ↓
    Final Response
```

**Manager Agent**: High-level planning and task decomposition  
**Worker Agent**: Tool execution and information gathering  
**Client Agent**: Adaptive validation and quality control (new in v0.3.1)

The Client agent uses tiered involvement levels to balance quality with efficiency:
- **MINIMAL**: Information requests → metadata validation only
- **STANDARD**: Creation tasks → file exists + basic checks
- **THOROUGH**: Complex tasks or after failures → full E2E validation

### Project Structure

```
jiva/
├── src/
│   ├── core/              # Three-agent system
│   │   ├── dual-agent.ts        # Main orchestrator
│   │   ├── manager-agent.ts     # Planning & coordination
│   │   ├── worker-agent.ts      # Tool execution
│   │   └── client-agent.ts      # Quality validation (v0.3.1)
│   ├── models/            # Model integrations and Harmony format
│   ├── mcp/               # MCP client and server management
│   ├── storage/           # Storage abstraction (v0.3.1)
│   │   ├── local-provider.ts    # Filesystem storage
│   │   └── gcp-bucket-provider.ts # Cloud storage
│   ├── interfaces/        # CLI and HTTP interfaces
│   │   ├── cli/           # CLI interface
│   │   └── http/          # Cloud Run HTTP/WebSocket (v0.3.1)
│   └── utils/             # Utilities and helpers
```

### Key Components

1. **DualAgent**: Main orchestrator coordinating Manager, Worker, and Client agents
2. **ManagerAgent**: High-level planning, task breakdown, and result synthesis
3. **WorkerAgent**: Focused tool execution and information gathering
4. **ClientAgent**: Adaptive validation with unjustified failure detection
5. **ModelOrchestrator**: Manages multi-model coordination (reasoning + multimodal)
6. **MCPServerManager**: Handles MCP server lifecycle and tool discovery
7. **StorageProvider**: Unified interface for local/cloud persistence
8. **SessionManager**: Manages DualAgent lifecycle in cloud deployments

**Troubleshooting MCP Issues:** See [TROUBLESHOOTING.md](docs/guides/TROUBLESHOOTING.md#mcp-server-issues)

### CLI/Library Mode

```typescript
import {
  DualAgent,
  createKrutrimModel,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
  ConversationManager,
  createStorageProvider,
} from 'jiva-core';

// Create storage provider (auto-detects local/cloud)
const storageProvider = await createStorageProvider();

// Create models
const reasoningModel = createKrutrimModel({
  endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
  apiKey: 'your-api-key',
  model: 'gpt-oss-120b',
  type: 'reasoning',
});

// Create orchestrator
const orchestrator = new ModelOrchestrator({ reasoningModel });

// Initialize MCP
const mcpManager = new MCPServerManager();
await mcpManager.initialize({
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    enabled: true,
  },
});

// Initialize workspace
const workspace = new WorkspaceManager(storageProvider);
await workspace.initialize();

// Initialize conversation manager
const conversationManager = new ConversationManager(storageProvider);

// Create three-agent system
const agent = new DualAgent({
  orchestrator,
  mcpManager,
  workspace,
  conversationManager,
  maxSubtasks: 20,        // Manager's subtask limit
  maxIterations: 10,      // Worker's iteration limit per subtask
});

// Use agent
const response = await agent.chat('Hello, Jiva!');
console.log(response.content);
console.log(`Plan: ${response.plan?.subtasks.join(', ')}`);
console.log(`Tools used: ${response.toolsUsed.join(', ')}`);

// Cleanup
await agent.cleanup();
```

### Cloud Mode (HTTP/WebSocket)

For cloud deployments, see the [HTTP interface documentation](docs/deployment/CLOUD_RUN_IMPLEMENTATION.md) and [example programs](examples/).

**Key difference:** Cloud mode uses `SessionManager` to handle multiple concurrent agent instances with per-tenant isolation.
## Development

### Build

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Type Checking

```bash
npm run type-check
```

## Programmatic Usage

Jiva can also be used programmatically:

```typescript
import {
  DualAgent,
  createKrutrimModel,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
  ConversationManager,
} from 'jiva';

// Create models
const reasoningModel = createKrutrimModel({
  endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
  apiKey: 'your-api-key',
  model: 'gpt-oss-120b',
  type: 'reasoning',
});

// Create orchestrator
const orchestrator = new ModelOrchestrator({ reasoningModel });

// Initialize MCP
const mcpManager = new MCPServerManager();
await mcpManager.initialize({
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    enabled: true,
  },
});

// Initialize workspace
const workspace = new WorkspaceManager({
  workspaceDir: process.cwd(),
});
await workspace.initialize();

// Initialize conversation manager (optional)
const conversationManager = new ConversationManager();
await conversationManager.initialize();

// Create dual-agent
const agent = new DualAgent({
  orchestrator,
  mcpManager,
  workspace,
  conversationManager,
  maxSubtasks: 10,
});

// Use agent
const response = await agent.chat('Hello, Jiva!');
console.log(response.content);
console.log(`Plan: ${response.plan?.subtasks.join(', ')}`);
console.log(`Tools used: ${response.toolsUsed.join(', ')}`);

// Cleanup
await agent.cleanup();
```

## Troubleshooting

### Tool Calls Not Working

The gpt-oss-120b model has known issues with tool calling reliability. Jiva implements several workarounds:

1. **Retry Logic**: Automatically retries malformed tool calls
2. **JSON Fixing**: Attempts to fix common JSON formatting issues
3. **Validation**: Validates tool calls against available tools
4. **Logging**: Enable debug mode to see detailed tool call information

```bash
jiva chat --debug
```

### MCP Server Connection Issues

Check server status:

```bash
jiva chat
# Then type: servers
```

View logs:

```bash
jiva chat --debug
```

## API Documentation

For detailed API documentation, see the TypeScript definitions in `src/`.

## Contributing

Contributions are welcome! Please ensure:

1. Code follows TypeScript best practices
2. All new features include proper error handling
3. Documentation is updated

## License

MIT

## References

- [gpt-oss-120b Model Card](https://huggingface.co/openai/gpt-oss-120b)
- [Harmony Response Format](https://github.com/openai/harmony)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Krutrim Cloud API](https://cloud.olakrutrim.com/)

## Sources

This implementation is based on research from:

- [OpenAI Harmony GitHub Repository](https://github.com/openai/harmony)
- [MCP with OpenAI gpt-oss](https://github.com/Vaibhavs10/mcp-with-openai-gpt-oss)
- [OpenAI Cookbook - Harmony Format](https://cookbook.openai.com/articles/openai-harmony)
- [MCP Best Practices](https://modelcontextprotocol.info/docs/best-practices/)
- [vLLM GPT-OSS Documentation](https://docs.vllm.ai/projects/recipes/en/latest/OpenAI/GPT-OSS.html)
