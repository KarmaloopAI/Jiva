# Jiva Implementation Summary

## Overview

Jiva is a production-ready autonomous AI agent built with TypeScript. It works with any OpenAI-compatible LLM provider (Krutrim, Groq, Sarvam, OpenAI, Ollama, and others) and supports MCP (Model Context Protocol) servers for extensible tool integration. The architecture centres on a dual-agent pattern (Manager + Worker) for improved reliability, transparency, and task completion, with an optional single-loop Code mode for software engineering tasks.

## Key Achievements

### 1. **Dual-Agent Architecture (v0.2.1)**

**Problem:** Single-agent systems struggle with complex tasks, lose context during execution, and have difficulty recovering from errors.

**Our Solution:**
- **Manager/Worker Pattern:** Separate planning from execution for better focus
- **Three-Phase Execution:** Structured workflow (Planning → Execution → Synthesis)
- **Automatic Error Recovery:** Worker retries failed operations with error feedback
- **Chain-of-Thought Logging:** Transparent reasoning at INFO level with clean output
- **Workspace Awareness:** Smart path resolution for file operations

**Benefits:**
- Manager maintains task context while Worker executes tools
- Worker errors don't crash the system - automatic retry up to 5 attempts
- Clear visibility into what each agent is thinking and doing
- Better task completion rates through structured planning

### 2. **Provider-Agnostic Model Client**

The model layer (`src/models/model-client.ts`) is a generic OpenAI-compatible HTTP client that adapts to any provider through configuration flags rather than hardcoded logic:

- **`useHarmonyFormat`** — enables Krutrim's Harmony tool-calling format (only for `gpt-oss-120b`)
- **`reasoningEffortStrategy`** — controls how reasoning effort is communicated (`api_param` for Groq/Sarvam, `system_prompt` for Krutrim)
- **`defaultMaxTokens`** — ensures reasoning models (e.g. Sarvam-105B) have sufficient token budget
- **Retry logic** — handles 403/429/5xx transient errors with exponential backoff and Groq retry-after parsing
- **Reasoning token logging** — reads `reasoning_content` (Sarvam) and `reasoning` (Groq) at debug level

Supported out of the box: **Krutrim**, **Groq**, **Sarvam**, **OpenAI**, **Ollama**, and any OpenAI-compatible endpoint.

### 2. **Complete MCP Integration**

- Full MCP SDK integration with stdio transport
- Pre-configured with `filesystem` and `mcp-server-commands` servers
- Dynamic tool discovery and execution
- Server lifecycle management (connect, disconnect, refresh)
- Tool namespacing to avoid conflicts between servers

### 3. **Multi-Model Orchestration**

- Automatic routing between reasoning and multimodal model instances
- Image content detection and preprocessing
- Images are described by the multimodal model, then forwarded to the reasoning model as text descriptions
- Optional dedicated tool-calling model for improved tool serialisation reliability
- Fallback handling when multimodal model is not configured

### 4. **Directive-Based Operation**

- Support for `jiva-directive.md` files
- Automatic discovery in multiple locations
- Markdown parsing for Purpose, Tasks, Constraints, and Context sections
- Dynamic system prompt generation based on directive
- Example directives provided for code review, data analysis, etc.

### 5. **Extensible Architecture**

The codebase is structured for easy expansion:

```
src/
├── core/           # Agent, config, workspace (framework-agnostic)
├── models/         # Model integrations (can add more models)
├── mcp/            # MCP layer (can add more transports)
├── interfaces/     # CLI, future: Electron, Web
└── utils/          # Shared utilities
```

**Adding an Electron UI:**
1. Create `src/interfaces/electron/`
2. Reuse all core components
3. Add IPC layer to communicate with renderer

**Adding a Web UI:**
1. Create `src/interfaces/web/`
2. Build REST API around core agent
3. Add WebSocket for streaming responses

## Architecture Details (v0.2.1)

### Dual-Agent System

**Updated in v0.3.4:** Jiva uses a streamlined two-agent architecture:

1. **DualAgent** (`src/core/dual-agent.ts`)
   - Orchestrates Manager and Worker agents
   - Implements three-phase execution: Planning → Execution → Synthesis
   - Routes simple conversational messages directly (no Worker subtasks)
   - Manages conversation history and auto-save

2. **ManagerAgent** (`src/core/manager-agent.ts`)
   - **Role:** High-level planning, coordination, and synthesis
   - Creates execution plans by decomposing user requests into subtasks
   - Synthesizes final responses from all subtask results
   - Answers simple conversational messages directly (without Worker)
   - Does NOT execute tools directly

3. **WorkerAgent** (`src/core/worker-agent.ts`)
   - **Role:** Focused tool execution
   - Executes specific subtasks assigned by Manager
   - Uses MCP tools to gather information and perform actions
   - Reports results back to Manager

### Supporting Components

4. **ModelOrchestrator** (`src/models/orchestrator.ts`)
   - Routes requests to appropriate model
   - Handles image preprocessing
   - Manages model-specific formatting

5. **Harmony Format Handler** (`src/models/harmony.ts`)
   - Formats tools in TypeScript-like syntax
   - Parses multi-channel responses
   - Extracts and validates tool calls
   - Handles malformed responses

6. **MCPServerManager** (`src/mcp/server-manager.ts`)
   - Manages server lifecycle
   - Configuration-driven server initialization
   - Health monitoring

7. **WorkspaceManager** (`src/core/workspace.ts`)
   - Workspace directory management
   - Directive file discovery and parsing
   - System prompt generation
   - Smart path resolution for file operations

8. **ConfigManager** (`src/core/config.ts`)
   - Persistent configuration with Conf
   - Schema validation with Zod
   - First-time setup detection

### Legacy Component

**JivaAgent** (`src/core/agent.ts`) - Single-agent implementation (legacy, still available for compatibility)

### CLI Interface

- **Setup Wizard**: Interactive configuration
- **Interactive REPL**: Full-featured chat interface
- **Single-shot Mode**: Execute one prompt and exit
- **Configuration Management**: Update settings anytime

## Harmony Format (Krutrim gpt-oss-120b)

The Harmony format is a Krutrim-specific tool-calling protocol used exclusively by `gpt-oss-120b`. All other providers use standard OpenAI tool calling.

When `useHarmonyFormat: true` is set:

```typescript
// Harmony tool formatting (src/models/harmony.ts)
// Tools are embedded in the developer message as TypeScript-like signatures:
`<namespace name="functions">
/**
 * ${tool.description}
 */
function ${tool.name}(params: {
  param1: type1;
  param2?: type2;
}): void;
</namespace>`

// Responses use special tokens parsed by parseHarmonyResponse():
// <|call|>tool_name({"param": "value"})<|return|>
// <|channel|>analysis<|end|>
// <|channel|>final<|end|>
```

The parser handles:
- Multi-channel responses (analysis, final, commentary channels)
- Malformed JSON auto-fix (single quotes, unquoted keys)
- Graceful fallback when tool calls are absent

For all other providers, tools are sent as a standard OpenAI `tools` array and responses contain a standard `tool_calls` structure.

## Configuration

### First Run Setup

```bash
jiva setup
```

The setup wizard presents a provider selection menu:
- **Krutrim** — auto-fills Krutrim endpoint, `gpt-oss-120b`, Harmony format
- **Groq** — auto-fills Groq endpoint, `openai/gpt-oss-120b`, standard format
- **Sarvam** — auto-fills Sarvam endpoint, `sarvam-105b`, `defaultMaxTokens: 8192`
- **OpenAI-Compatible** — prompts for custom endpoint and model name

Then prompts for:
- API key (asked once per provider even if used for both models)
- Multimodal model (optional; not shown when Sarvam is selected for reasoning)
- MCP servers (auto-configured)
- Debug mode

### Config Storage

Uses the `conf` package for persistent storage:
- macOS: `~/Library/Preferences/jiva-nodejs/config.json`
- Linux: `~/.config/jiva-nodejs/config.json`
- Windows: `%APPDATA%\jiva-nodejs\config.json`

### Example Config (Groq)

```json
{
  "models": {
    "reasoning": {
      "name": "reasoning",
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "apiKey": "gsk_...",
      "type": "reasoning",
      "model": "openai/gpt-oss-120b",
      "reasoningEffortStrategy": "api_param"
    },
    "multimodal": {
      "name": "multimodal",
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "apiKey": "gsk_...",
      "type": "multimodal",
      "model": "meta-llama/llama-4-maverick-17b-128e-instruct"
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "enabled": true
    },
    "commands": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-commands"],
      "enabled": true
    }
  },
  "debug": false
}
```

## Usage Examples

### CLI Usage

```bash
# Interactive chat
jiva chat

# With custom workspace and directive
jiva chat --workspace ~/projects/myapp --directive ./code-review.md

# Single prompt
jiva run "Analyze the codebase and suggest improvements"

# With debug logging
jiva chat --debug

# Update configuration
jiva config
```

### Programmatic Usage

```typescript
import {
  DualAgent,
  createModelClient,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
  ConversationManager,
} from 'jiva-core';

// Setup — works with any OpenAI-compatible provider
const reasoningModel = createModelClient({
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  apiKey: process.env.API_KEY!,
  model: 'openai/gpt-oss-120b',
  type: 'reasoning',
  reasoningEffortStrategy: 'api_param',
});

const orchestrator = new ModelOrchestrator({ reasoningModel });

const mcpManager = new MCPServerManager();
await mcpManager.initialize({
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    enabled: true,
  },
});

const workspace = new WorkspaceManager({
  workspaceDir: process.cwd(),
});
await workspace.initialize();

const conversationManager = new ConversationManager();
await conversationManager.initialize();

// Create dual-agent system
const agent = new DualAgent({
  orchestrator,
  mcpManager,
  workspace,
  conversationManager,
  maxSubtasks: 10,
  autoSave: true,
  condensingThreshold: 30,
});

// Use
const response = await agent.chat('What files are in this directory?');
console.log(response.content);
console.log('Plan:', response.plan?.subtasks);
console.log('Tools used:', response.toolsUsed);
console.log('Iterations:', response.iterations);

// Cleanup
await agent.cleanup();
```

## Testing Recommendations

### Manual Testing

1. **Setup**
   ```bash
   npm install
   npm run build
   jiva setup
   ```

2. **Basic Chat**
   ```bash
   jiva chat
   > Hello, what can you do?
   > What files are in the current directory?
   ```

3. **Tool Calling**
   ```bash
   jiva run "List all TypeScript files and count the lines"
   ```

4. **With Directive**
   ```bash
   jiva chat --directive examples/code-review-directive.md
   > Review the code in src/core/agent.ts
   ```

5. **Multimodal** (if configured)
   ```bash
   jiva run "Describe the image at https://example.com/image.jpg"
   ```

### Automated Testing (Future)

Recommended test structure:
```
tests/
├── unit/
│   ├── harmony.test.ts       # Harmony format parsing
│   ├── workspace.test.ts     # Directive parsing
│   └── config.test.ts        # Configuration
├── integration/
│   ├── mcp-client.test.ts    # MCP integration
│   └── orchestrator.test.ts  # Multi-model routing
└── e2e/
    └── agent.test.ts         # Full agent flows
```

## Known Limitations

1. **gpt-oss-120b Tool Calling**
   - Model may occasionally fail to call tools
   - Workaround: Manual retry or use developer message to emphasize tool usage

2. **MCP Server Compatibility**
   - Only stdio transport currently supported
   - HTTP+SSE support can be added in future

3. **Error Recovery**
   - Agent will stop after max iterations (default: 10)
   - User must restart conversation if stuck

## Future Enhancements

### High Priority
1. Add HTTP+SSE transport for remote MCP servers
2. Implement conversation history persistence
3. Add streaming support for real-time responses
4. Create comprehensive test suite

### Medium Priority
1. Build Electron desktop application
2. Create web interface with REST API
3. Add support for additional models (Claude, GPT-4, etc.)
4. Implement plugin system for custom tools

### Low Priority
1. Add conversation export (markdown, JSON)
2. Implement conversation branching
3. Add voice input/output
4. Create marketplace for directives

## Development Guide

### Adding a New Model Provider

1. Create model class implementing `IModel` interface
2. Handle provider-specific formatting
3. Add to orchestrator routing logic

### Adding a New MCP Transport

1. Implement transport in `src/mcp/`
2. Update `MCPClient.connect()` to support new transport
3. Add configuration schema

### Adding a New Interface

1. Create directory in `src/interfaces/`
2. Import and use core components
3. Implement interface-specific features
4. Update build configuration

## Deployment

### NPM Package (Future)

```bash
npm publish
npm install -g jiva
jiva setup
```

### Docker (Future)

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENTRYPOINT ["node", "dist/interfaces/cli/index.js"]
```

## References

### Documentation Used

- [OpenAI Harmony Format](https://github.com/openai/harmony)
- [OpenAI Cookbook - Harmony](https://cookbook.openai.com/articles/openai-harmony)
- [MCP SDK Documentation](https://modelcontextprotocol.io/)
- [MCP Best Practices](https://modelcontextprotocol.info/docs/best-practices/)
- [gpt-oss-120b Model Card](https://huggingface.co/openai/gpt-oss-120b)
- [vLLM GPT-OSS Recipes](https://docs.vllm.ai/projects/recipes/en/latest/OpenAI/GPT-OSS.html)

### Community Resources

- [MCP with gpt-oss](https://github.com/Vaibhavs10/mcp-with-openai-gpt-oss)
- [HuggingFace Discussions on Tool Calling](https://huggingface.co/openai/gpt-oss-120b/discussions)
- [NVIDIA NIM Forum Threads](https://forums.developer.nvidia.com/)

## Conclusion

Jiva is a **production-ready, extensible autonomous agent** that:

✅ Works with any OpenAI-compatible provider (Krutrim, Groq, Sarvam, OpenAI, Ollama, and more)
✅ Provider-aware setup wizard with per-provider presets and defaults
✅ Harmony format support for gpt-oss-120b with robust parsing
✅ Integrates seamlessly with MCP servers
✅ Supports multi-modal workflows
✅ Provides both CLI and programmatic interfaces
✅ Includes comprehensive error handling, retry logic, and context-overflow protection
✅ Code mode with LSP integration for software engineering tasks
✅ Cloud-native HTTP/WebSocket deployment on Google Cloud Run

The agent is ready for:
- Development workflows and code review automation
- Data analysis and research tasks
- General-purpose multi-step task execution
- Custom directive-based domain specialisation
- Cloud-native multi-tenant deployments
