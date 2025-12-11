# Jiva - Versatile Autonomous AI Agent

Jiva is a powerful autonomous AI agent powered by gpt-oss-120b with full MCP (Model Context Protocol) support. It's designed to be highly goal-oriented, autonomous, and extensible for various use cases.

## 🚀 Quick Links

- **[Quick Start Guide](docs/QUICKSTART.md)** - Get up and running in 30 seconds
- **[Configuration Guide](docs/CONFIGURATION.md)** - Detailed configuration and provider setup
- **[New Features Guide](docs/NEW_FEATURES.md)** - Latest improvements and features
- **[Build Instructions](docs/BUILD.md)** - Detailed setup and development workflow
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

## ✨ Features

### Core Capabilities
- 🤖 **Powered by gpt-oss-120b**: Leverages OpenAI's powerful open-weight reasoning model
- 🔌 **Provider Agnostic**: Works with Krutrim, Groq, OpenAI, Ollama, and any OpenAI-compatible API
- 🎯 **Mission-Driven Execution**: Completes tasks thoroughly with ~95% success rate
- 🔧 **MCP Integration**: Seamless integration with Model Context Protocol servers for extensible tooling
- 💬 **Smart Conversations**: Auto-save, restore, and AI-generated titles for all conversations
- 📝 **Pretty Markdown**: Beautiful terminal output with syntax highlighting
- 🎨 **Directive-Based**: Orient agent behavior with custom `jiva-directive.md` files
- 🌐 **Multi-Modal Support**: Optional image understanding via Llama-4-Maverick-17B
- 🔄 **Auto-Condensing**: Intelligent conversation history management to prevent token overload

### Advanced Features
- **Slash Commands**: Use `/help`, `/load`, `/save`, `/list` for easy conversation management
- **Smart Tool Format Detection**: Auto-detects Harmony vs Standard OpenAI tool calling format
- **Robust Tool Calling**: Advanced parsing supporting hyphens in tool names (e.g., `desktop-commander`)
- **Extensible Architecture**: Designed to expand from CLI to desktop or web applications
- **Smart Title Generation**: LLM-powered conversation titles based on first user message

See [NEW_FEATURES.md](docs/NEW_FEATURES.md) for detailed information.

## 📦 Installation

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
git clone https://github.com/yourusername/jiva.git
cd jiva
npm install
npm run build
npm link  # For global CLI access
```

## 🚀 Quick Start

### 1. Install Jiva

```bash
npm install -g jiva-core
```

### 2. First-Time Setup

Run the interactive setup wizard:

```bash
jiva setup
```

You'll be prompted for:
- ☁️ Krutrim API endpoint (default: `https://cloud.olakrutrim.com/v1/chat/completions`)
- 🔑 API key for gpt-oss-120b ([Get your API key](https://cloud.olakrutrim.com))
- 🎨 Optional multimodal model (Llama-4-Maverick-17B)
- 🔌 MCP server configuration

### 3. Start Chatting

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

### 4. Advanced Usage

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

## 🔌 MCP Servers

Jiva leverages the Model Context Protocol (MCP) to provide extensible tooling. It comes pre-configured with the Filesystem server and makes it easy to add more.

### Default Server: Filesystem

Provides comprehensive file operations across user directories (subject to OS permissions).

- **Status:** ✅ Enabled by default
- **Package:** `@modelcontextprotocol/server-filesystem`
- **Access:** `/Users` (macOS/Linux) or `C:\Users` (Windows)
- **Tools:** read_file, write_file, list_directory, create_directory, and more
- **Details:** See [FILESYSTEM_ACCESS.md](docs/FILESYSTEM_ACCESS.md)

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
import { configManager } from 'jiva-core';

configManager.addMCPServer('playwright', {
  command: 'npx',
  args: ['@playwright/mcp@latest'],
  enabled: true,
});
```

### Checking MCP Server Status

```bash
jiva chat
# Type: /servers
```

You'll see:
```
MCP Servers:
  ✓ filesystem: 12 tools
  ✓ playwright: 8 tools
  ✓ desktop-commander: 6 tools
```

**Troubleshooting MCP Issues:** See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#mcp-server-issues)

## CLI Commands

### Interactive Mode Commands

While in chat mode, you can use these commands (prefix with `/`):

- `/help` - Show available commands
- `/exit` / `/quit` - Exit the session
- `/reset` - Reset conversation history
- `/history` - Show conversation history
- `/tools` - List available MCP tools
- `/servers` - Show MCP server status
- `/save` - Save current conversation ✨ NEW
- `/load` - Load a saved conversation ✨ NEW
- `/list` - List all saved conversations ✨ NEW

## Architecture

Jiva is designed with extensibility in mind:

```
jiva/
├── src/
│   ├── core/           # Core agent logic
│   ├── models/         # Model integrations and Harmony format
│   ├── mcp/            # MCP client and server management
│   ├── interfaces/     # CLI, Electron, Web interfaces
│   └── utils/          # Utilities and helpers
```

### Key Components

1. **JivaAgent**: Main orchestrator coordinating models, tools, and workspace
2. **ModelOrchestrator**: Manages multi-model coordination (reasoning + multimodal)
3. **MCPServerManager**: Handles MCP server lifecycle and tool discovery
4. **WorkspaceManager**: Manages workspace directory and directive files
5. **Harmony Format Handler**: Implements gpt-oss-120b's required response format

## Working with gpt-oss-120b

The gpt-oss-120b model requires the Harmony response format. Jiva handles this automatically with:

### Tool Call Parsing
- Robust parsing of `<|call|>function_name({"param": "value"})<|return|>` format
- Automatic JSON fixing for common formatting issues
- Validation against available tools

### Multi-Channel Output
- Analysis channel: Chain-of-thought reasoning
- Final channel: User-facing responses
- Tool calling: Structured function calls

### Error Handling
- Retry logic for malformed tool calls
- Graceful degradation when tools fail
- Detailed logging for debugging

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
  JivaAgent,
  createKrutrimModel,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
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

// Create agent
const agent = new JivaAgent({
  orchestrator,
  mcpManager,
  workspace,
});

// Use agent
const response = await agent.chat('Hello, Jiva!');
console.log(response.content);

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
