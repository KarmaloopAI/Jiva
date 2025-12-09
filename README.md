# Jiva - Versatile Autonomous AI Agent

Jiva is a powerful autonomous AI agent powered by gpt-oss-120b with full MCP (Model Context Protocol) support. It's designed to be highly goal-oriented, autonomous, and extensible for various use cases.

## 🚀 Quick Links

- **[Quick Start Guide](QUICKSTART.md)** - Get up and running in 30 seconds
- **[Build Instructions](BUILD.md)** - Detailed setup and development workflow
- **[Implementation Summary](IMPLEMENTATION_SUMMARY.md)** - Architecture and technical details

## Features

- **Powered by gpt-oss-120b**: Leverages OpenAI's powerful open-weight reasoning model
- **Harmony Format Support**: Full implementation of the Harmony response format required by gpt-oss models
- **MCP Integration**: Seamless integration with Model Context Protocol servers for extensible tooling
- **Multi-Modal Support**: Optional integration with Llama-4-Maverick-17B for image understanding
- **Directive-Based**: Supports `jiva-directive.md` files to orient the agent for specific tasks
- **Extensible Architecture**: Designed to expand from CLI to Electron desktop app or web application
- **Robust Tool Calling**: Advanced parsing and error handling for reliable tool execution

## Installation

```bash
npm install
npm run build
npm link  # For global CLI access
```

## Quick Start

### 1. First-Time Setup

Run the setup wizard to configure Jiva:

```bash
jiva setup
```

You'll be prompted for:
- Krutrim API endpoint (default: `https://cloud.olakrutrim.com/v1/chat/completions`)
- API key for reasoning model (gpt-oss-120b)
- Optional multimodal model configuration (Llama-4-Maverick-17B)
- MCP server configuration

### 2. Interactive Chat

Start an interactive session:

```bash
jiva chat
```

Or with custom workspace:

```bash
jiva chat --workspace /path/to/workspace --directive ./my-directive.md
```

### 3. Single Prompt Execution

Execute a single prompt:

```bash
jiva run "Analyze the code in this directory and suggest improvements"
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

Jiva comes pre-configured with two MCP servers:

### 1. Filesystem Server
Provides tools for file operations across your entire filesystem (subject to OS permissions).
- **Status:** Enabled by default
- **Package:** `@modelcontextprotocol/server-filesystem`
- **Access:** Full filesystem access - workspace is the default working area, not a restriction
- **Details:** See [FILESYSTEM_ACCESS.md](FILESYSTEM_ACCESS.md)

### 2. Commands Server
Allows execution of shell commands.
- **Status:** Disabled by default (known stability issues)
- **Package:** `@modelcontextprotocol/server-commands`
- **Note:** You can enable this manually via `npx jiva config` if needed

**Troubleshooting MCP Issues:** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#mcp-server-issues)

### Adding Custom MCP Servers

```bash
jiva config
# Select "MCP Servers" > "Add Server"
```

Or programmatically:

```typescript
import { configManager } from 'jiva';

configManager.addMCPServer('my-server', {
  command: 'npx',
  args: ['-y', '@my-org/mcp-server'],
  enabled: true,
});
```

## CLI Commands

### Interactive Mode Commands

While in chat mode, you can use these commands:

- `help` - Show available commands
- `exit` / `quit` - Exit the session
- `reset` - Reset conversation history
- `history` - Show conversation history
- `tools` - List available MCP tools
- `servers` - Show MCP server status

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
