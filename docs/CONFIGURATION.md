# Jiva Configuration Guide

## Overview

Jiva supports multiple OpenAI-compatible API providers including Krutrim, Groq, OpenAI, Ollama, and others. The configuration system is designed to be provider-agnostic with smart defaults.

## Configuration Location

Your configuration is stored at:
- macOS/Linux: `~/.config/jiva-nodejs/config.json`
- Windows: `%APPDATA%\jiva-nodejs\config.json`

You can view the exact path with:
```bash
jiva config → View Configuration
```

## Interactive Configuration

### First-Time Setup

```bash
jiva setup
```

This runs the interactive setup wizard that prompts for:

1. **API Endpoint** - The base URL for your LLM provider
2. **API Key** - Your authentication token
3. **Model Name** - The specific model to use
4. **Tool Format** - How tool calls are formatted (Harmony vs Standard)
5. **Multimodal Model** (optional) - For image understanding

### Updating Configuration

```bash
jiva config
```

Choose what to update:
- Reasoning Model
- Multimodal Model
- MCP Servers
- Debug Mode
- View Configuration
- Reset All

## Tool Format Configuration

Different providers use different formats for tool calling:

### Harmony Format (Krutrim)
- Used by: Krutrim Cloud with `gpt-oss-120b`
- Tools embedded in developer message
- Response format: `<|call|>tool_name(args)<|return|>`
- **Set**: `useHarmonyFormat: true`

### Standard OpenAI Format (Most Providers)
- Used by: Groq, OpenAI, Ollama, and most other providers
- Tools sent as separate `tools` array
- Response format: Standard `tool_calls` structure
- **Set**: `useHarmonyFormat: false` (or omit - this is the default)

### Smart Detection

The setup wizard automatically detects the recommended format based on your model name:

- **`gpt-oss-120b`** → Recommends `useHarmonyFormat: true`
- **All other models** → Recommends `useHarmonyFormat: false`

You can override this recommendation if needed.

## Provider Examples

### Krutrim Cloud

```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://cloud.olakrutrim.com/v1/chat/completions",
      "apiKey": "your-krutrim-api-key",
      "model": "gpt-oss-120b",
      "type": "reasoning",
      "useHarmonyFormat": true
    }
  }
}
```

### Groq

```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "apiKey": "your-groq-api-key",
      "model": "openai/gpt-oss-20b",
      "type": "reasoning",
      "useHarmonyFormat": false
    }
  }
}
```

Or omit `useHarmonyFormat` entirely (defaults to false):
```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "apiKey": "your-groq-api-key",
      "model": "openai/gpt-oss-20b",
      "type": "reasoning"
    }
  }
}
```

### OpenAI

```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "apiKey": "sk-...",
      "model": "gpt-4",
      "type": "reasoning"
    }
  }
}
```

### Ollama (Local)

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

## Configuration Schema

### Full Configuration Structure

```typescript
{
  models: {
    reasoning: {
      name: string;              // "reasoning"
      endpoint: string;          // API endpoint URL
      apiKey: string;            // API key
      type: "reasoning";         // Fixed type
      defaultModel: string;      // Model name/ID
      useHarmonyFormat?: boolean; // Optional, defaults to false
    };
    multimodal?: {
      name: string;              // "multimodal"
      endpoint: string;          // API endpoint URL
      apiKey: string;            // API key
      type: "multimodal";        // Fixed type
      defaultModel: string;      // Model name/ID
    };
  };
  mcpServers: {
    [serverName: string]: {
      command: string;           // Command to run
      args?: string[];           // Command arguments
      env?: Record<string, string>; // Environment variables
      enabled: boolean;          // Whether server is enabled
    };
  };
  debug: boolean;                // Enable debug logging
}
```

## MCP Servers Configuration

Jiva uses the Model Context Protocol (MCP) for tool integration.

### Default Servers

The setup wizard automatically configures:
- **filesystem** - File operations (read, write, search, etc.)
- **playwright** (optional) - Browser automation

### Managing Servers

```bash
jiva config → MCP Servers
```

Options:
- **List Servers** - View all configured servers and their status
- **Add Server** - Add a new MCP server
- **Remove Server** - Remove an existing server

### Example: Adding a Custom Server

```bash
jiva config
→ MCP Servers
→ Add Server

Server name: github
Command: npx
Arguments (space-separated): -y @modelcontextprotocol/server-github
```

### Disabling a Server

Edit the config file and set `enabled: false`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "enabled": false
    }
  }
}
```

## Multimodal Configuration

For image understanding, configure a multimodal model:

```json
{
  "models": {
    "multimodal": {
      "endpoint": "https://cloud.olakrutrim.com/v1/chat/completions",
      "apiKey": "your-api-key",
      "model": "Llama-4-Maverick-17B-128E-Instruct",
      "type": "multimodal"
    }
  }
}
```

When multimodal is configured, Jiva will:
1. Use multimodal model to describe images
2. Pass descriptions to reasoning model for analysis
3. Support image URLs in user messages

## Debug Mode

Enable detailed logging:

```bash
jiva config → Debug Mode → Yes
```

Or via command line:
```bash
jiva chat --debug
```

Debug mode logs:
- API requests and responses
- Tool call details
- Message formatting
- Token usage
- Error details

## Environment Variables

You can override config with environment variables:

```bash
# Override reasoning model endpoint
export JIVA_REASONING_ENDPOINT="https://api.groq.com/openai/v1/chat/completions"

# Override API key
export JIVA_API_KEY="your-api-key"

# Enable debug mode
export JIVA_DEBUG=true
```

## Configuration Best Practices

### 1. Start with Setup Wizard
Always use `jiva setup` for first-time configuration. It provides smart defaults and validates your inputs.

### 2. Let Smart Detection Work
The wizard detects the correct tool format based on your model name. Accept the recommendation unless you know it's wrong.

### 3. Test with Simple Commands
After configuring, test with:
```bash
jiva run "Say hello"
```

### 4. Use Debug Mode for Troubleshooting
If something isn't working:
```bash
jiva chat --debug
```

### 5. Keep API Keys Secure
- Never commit config files with API keys to version control
- Use environment variables in CI/CD environments
- Rotate keys regularly

## Troubleshooting

### "Tool choice is none, but model called a tool"

**Cause**: Wrong tool format setting for your provider.

**Solution**:
```bash
jiva config → Reasoning Model
# When prompted for tool format:
# - Krutrim gpt-oss-120b: Yes (Harmony)
# - Groq/OpenAI/Others: No (Standard)
```

### "403 Access Denied" or WAF Errors

**Cause**: Request payload too large, often from too many MCP tools.

**Solutions**:
1. Disable unused MCP servers:
   ```bash
   jiva config → MCP Servers → Remove Server
   ```

2. Reduce tool descriptions in custom servers

3. Use selective tool loading

### Configuration Not Persisting

**Check**:
1. File permissions on config directory
2. Disk space
3. Try resetting: `jiva config → Reset All`

### Model Not Found

**Verify**:
1. Model name is correct for your provider
2. API key has access to that model
3. Endpoint URL is correct

## Migration Guide

### From Krutrim to Groq

1. Run `jiva config → Reasoning Model`
2. Update endpoint: `https://api.groq.com/openai/v1/chat/completions`
3. Update API key: Your Groq API key
4. Update model: `openai/gpt-oss-20b` (or another Groq model)
5. Set tool format: **No** (Standard OpenAI format)

### From OpenAI to Local Ollama

1. Install and start Ollama
2. Pull a model: `ollama pull llama3.1`
3. Run `jiva config → Reasoning Model`
4. Update endpoint: `http://localhost:11434/v1/chat/completions`
5. API key: Use any value (not validated locally)
6. Model: `llama3.1`
7. Tool format: **No** (Standard)

## Advanced Configuration

### Custom Model Providers

Jiva works with any OpenAI-compatible API. Requirements:
- POST endpoint accepting OpenAI chat completion format
- Standard message roles: `system`, `user`, `assistant`, `tool`
- Optional: Tool calling support (standard OpenAI format)

### Programmatic Configuration

For advanced use cases, configure via Node.js:

```typescript
import { configManager } from 'jiva-core';

configManager.setReasoningModel({
  name: 'reasoning',
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: process.env.API_KEY,
  type: 'reasoning',
  defaultModel: 'my-model',
  useHarmonyFormat: false,
});
```

See `examples/programmatic-usage.ts` for more details.

## Getting Help

If you're stuck:

1. Check the [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Run with debug mode: `jiva chat --debug`
3. View your config: `jiva config → View Configuration`
4. Open an issue on GitHub with debug logs

## Related Documentation

- [Quick Start Guide](QUICKSTART.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [MCP Servers](https://github.com/modelcontextprotocol/servers)
- [Programmatic Usage](../examples/programmatic-usage.ts)
