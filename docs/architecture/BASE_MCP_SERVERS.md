# Base MCP Server Architecture

## Overview

Jiva now ensures that **base MCP servers are always available** to all agents, sub-agents, and personas. Personas can add specialized MCP servers on top of the base servers.

## Architecture

### Base MCP Servers

**Filesystem MCP Server** is automatically initialized if not present in config:
- **Path**: `/Users` (macOS/Linux) or `C:\Users` (Windows)  
- **Package**: `@modelcontextprotocol/server-filesystem`
- **Purpose**: Provides file read/write/list operations for all agents

### Implementation

#### CLI Interface (`src/interfaces/cli/index.ts`)

Both `chat` and `run` commands ensure filesystem MCP is available:

```typescript
// Ensure base filesystem MCP server is always available
const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';

if (!mcpServers['filesystem']) {
  // Add default filesystem server if not configured
  mcpServers['filesystem'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
    enabled: true,
  };
  logger.info(`Adding default filesystem MCP server (${allowedPath})`);
} else {
  // Update existing filesystem server args
  mcpServers['filesystem'].args = [
    '-y',
    '@modelcontextprotocol/server-filesystem',
    allowedPath
  ];
}
```

#### HTTP Interface (`src/interfaces/http/session-manager.ts`)

Sessions automatically include base filesystem MCP:

```typescript
// Ensure base filesystem MCP server is always available
const allowedPath = process.platform === 'win32' ? 'C:\\Users' : '/Users';
const baseMcpServers: Record<string, any> = {
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
    enabled: true,
  }
};

// Load additional MCP servers from config
// (will override filesystem if explicitly configured)
```

#### Agent Spawning (`src/core/agent-spawner.ts`)

Spawned sub-agents **share** the parent's MCPServerManager:

```typescript
const subAgentConfig: DualAgentConfig = {
  orchestrator: this.orchestrator,
  mcpManager: this.mcpManager,  // ← Shared MCP manager
  workspace: this.workspace,
  // ...
};
```

This means:
- Sub-agents inherit all parent MCP servers (including base filesystem)
- Persona-specific MCPs are added on top
- No need for personas to include filesystem in their `.mcp.json`

## Persona MCP Configuration

### Base Personas (No `.mcp.json` needed)

These personas don't need `.mcp.json` files:
- `engineering-manager`
- `developer`  
- `tester`

They automatically get filesystem access from the global configuration.

### Specialized Personas (Optional `.mcp.json`)

Personas that need **additional specialized tools** can include `.mcp.json`:

**Example**: `code-reviewer/.mcp.json`
```json
{
  "mcpServers": {
    "code-analysis": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-code-analysis"],
      "enabled": true
    }
  }
}
```

This persona gets:
- ✅ `filesystem` (from base config)
- ✅ `code-analysis` (from persona config)

## Benefits

1. **Always Available**: Agents never lack basic filesystem tools
2. **Simpler Personas**: No need to duplicate filesystem config in every persona
3. **Hierarchical Inheritance**: Sub-agents automatically inherit all parent MCPs
4. **Specialized Tools**: Personas can add domain-specific MCPs on top
5. **Consistent Behavior**: Same MCP availability across CLI, HTTP, and spawned agents

## Migration Guide

### Before (❌ Old Pattern)

Every persona needed filesystem in `.mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "enabled": true
    }
  }
}
```

### After (✅ New Pattern)

Base personas have no `.mcp.json`:

```bash
examples/personas/developer/
├── .jiva-plugin/
│   └── plugin.json
└── skills/
    └── feature-implementation/
```

Specialized personas only include additional MCPs:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.github.com/mcp",
      "enabled": true
    }
  }
}
```

## Testing

Verify base filesystem is available:

```bash
# Start Jiva chat
jiva chat

# Try filesystem operations
> List files in current directory

# Should work even with personas that have no .mcp.json
> jiva persona activate engineering-manager
> List files in the project
```

## Future Enhancements

- Add more base MCPs (e.g., `web-search`, `calculator`)
- Allow user configuration of base MCP list
- Implement MCP server templating for workspace-specific paths
