# Agent Spawning System

## Overview

Jiva's agent spawning system enables **hierarchical multi-agent collaboration**, where a parent agent can spawn specialized sub-agents with different personas to handle complex tasks that require diverse expertise.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Parent Agent                              │
│              (e.g., engineering-manager)                     │
│                                                              │
│  ┌──────────┐         ┌──────────┐         ┌────────────┐  │
│  │ Spawns → │ Agent 1 │ Agent 2  │ Agent 3 │            │  │
│  │          │ developer│ reviewer │ tester  │            │  │
│  │          ├─────────┼──────────┼─────────┤            │  │
│  │  Results │  Code   │  Review  │  Tests  │            │  │
│  │     ←────┤         │          │         │            │  │
│  └──────────┘         └──────────┘         └────────────┘  │
│                                                              │
│        Integrates results → Final deliverable                │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

- **Persona-Aware Spawning**: Each sub-agent spawns with a specific persona active
- **Hierarchical Depth Control**: Configurable max depth prevents infinite recursion (default: 3 levels)
- **Automatic MCP Integration**: Sub-agents inherit parent's MCP servers plus persona-specific servers
- **Context Preservation**: Parent can provide context and receive structured results
- **Resource Management**: Automatic cleanup of spawned agents on completion

## Usage

### For Parent Agents

When an agent needs specialized help, it uses the `spawn_agent` tool:

```javascript
{
  "name": "spawn_agent",
  "arguments": {
    "persona": "code-reviewer",
    "task": "Review the authentication code in src/auth/ for security issues",
    "context": "This is a new user authentication system using JWT tokens",
    "maxIterations": 10  // Optional
  }
}
```

### Tool Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `persona` | Yes | Name of persona to spawn (must be installed) |
| `task` | Yes | Specific task for the sub-agent |
| `context` | No | Additional background information |
| `maxIterations` | No | Max iterations for sub-agent (default: 10) |

### Tool Response

```json
{
  "agentId": "agent-1708012345-abc123",
  "persona": "code-reviewer",
  "result": "Security review complete. Found 2 critical issues:\n1. Password hashing missing...\n2. JWT secret hardcoded...",
  "iterations": 5,
  "toolsUsed": ["view", "grep_search", "view"]
}
```

## Example Personas for Spawning

### Engineering Manager (Coordinator)
**Persona**: `engineering-manager`
**Role**: Breaks down complex projects and delegates to specialists
**Spawns**: developer, code-reviewer, tester

### Developer (Implementation)
**Persona**: `developer`
**Role**: Writes production code, implements features
**Spawns**: Rarely (may spawn tester for validation)

### Code Reviewer (Quality)
**Persona**: `code-reviewer`
**Role**: Reviews code for bugs, security, performance
**Spawns**: None (leaf agent)

### Tester (Validation)
**Persona**: `tester`
**Role**: Writes tests, validates functionality
**Spawns**: None (leaf agent)

## Configuration

### Depth Limits

Prevent infinite recursion by setting max depth when creating parent agent:

```typescript
const spawner = new AgentSpawner(
  orchestrator,
  mcpManager,
  workspace,
  conversationManager,
  personaManager,
  {
    maxDepth: 3  // Allow up to 3 levels of nesting
  }
);
```

**Default**: 3 levels
**Reasoning**: 
- Level 1: User → Engineering Manager
- Level 2: Engineering Manager → Developer
- Level 3: Developer → Tester (validation)

### Available Personas

Sub-agents can only spawn personas that are:
1. Installed in persona search paths
2. Successfully discovered during PersonaManager initialization

Get available personas:
```typescript
const available = spawner.getAvailablePersonas();
// Returns: ['engineering-manager', 'developer', 'code-reviewer', 'tester']
```

## Installation

### Install Example Personas

```bash
# Copy to user-level personas directory
cp -r examples/personas/{engineering-manager,developer,tester} ~/.jiva/personas/

# Or project-level
mkdir -p .jiva/personas
cp -r examples/personas/{engineering-manager,developer,tester} .jiva/personas/
```

### Verify Installation

```bash
jiva persona list
```

Should show:
- engineering-manager v1.0.0
- developer v1.0.0
- tester v1.0.0
- code-reviewer v1.0.0 (if already installed)

## Usage Examples

### Example 1: Full Feature Development

**User Request**: "Build a user authentication system"

**Engineering Manager** (active persona):
1. Analyzes requirements
2. Spawns `developer`: "Implement JWT-based authentication in src/auth/"
3. Spawns `code-reviewer`: "Review authentication code for security issues"
4. Spawns `tester`: "Write comprehensive tests for auth system"
5. Integrates all outputs
6. Returns complete solution to user

### Example 2: Code Quality Improvement

**User Request**: "Improve error handling in the API routes"

**Engineering Manager**:
1. Spawns `code-reviewer`: "Analyze current error handling patterns"
2. Spawns `developer`: "Implement improved error handling based on review findings"
3. Spawns `tester`: "Add error scenario tests"
4. Returns improved codebase with tests

### Example 3: Bug Fix with Validation

**User Request**: "Fix the login bug users are reporting"

**Engineering Manager**:
1. Spawns `developer`: "Debug and fix login issue in src/auth/login.ts"
2. Spawns `tester`: "Create regression tests for the login bug"
3. Returns fix with tests

## Best Practices

### When to Spawn

✅ **Good reasons to spawn**:
- Task requires specialized expertise (security review, testing)
- Parallel work streams (implement + test simultaneously)
- Complex projects needing multiple perspectives
- Validation of own work (developer → tester)

❌ **Avoid spawning for**:
- Simple tasks you can handle directly
- Sequential steps where context is critical
- Trivial file operations
- Information gathering (use tools instead)

### Task Clarity

Give spawned agents **clear, focused tasks**:

✅ Good: "Review src/auth/ for SQL injection vulnerabilities"
❌ Bad: "Check the code and see if anything looks wrong"

### Context Provision

Provide **sufficient context** without overwhelming:

✅ Good: "This authentication system uses JWT. Users report tokens expire too quickly. Focus on token lifecycle."
❌ Bad: "Here's the entire project history and all user feedback for the past year..."

### Integration Strategy

As coordinator:
1. **Plan before spawning**: Know what you need from each specialist
2. **Spawn sequentially**: Let results from one inform the next
3. **Review outputs**: Don't blindly accept sub-agent work
4. **Synthesize**: Combine insights into cohesive final answer

## Limitations

1. **Max Depth**: Default 3 levels prevents infinite recursion
2. **Shared Resources**: Sub-agents share workspace and MCP servers
3. **No Parallelization**: Sub-agents run sequentially (not async)
4. **Memory Cost**: Each spawned agent creates full agent instance
5. **Persona Availability**: Can only spawn installed personas

## Troubleshooting

### "Maximum agent depth reached"

**Cause**: Spawned agents trying to spawn too deep
**Solution**: Increase maxDepth or redesign spawning strategy

### "Persona 'X' not found"

**Cause**: Requested persona not installed
**Solution**: Install persona or use different available persona

### Sub-agent returns incomplete result

**Cause**: Insufficient iterations or unclear task
**Solution**: Increase maxIterations or provide clearer task description

## API Reference

### AgentSpawner Class

```typescript
class AgentSpawner {
  constructor(
    orchestrator: ModelOrchestrator,
    mcpManager: MCPServerManager,
    workspace: WorkspaceManager,
    conversationManager: ConversationManager | null,
    basePersonaManager: PersonaManager,
    options?: {
      parentAgentId?: string;
      maxDepth?: number;
      currentDepth?: number;
    }
  );

  async spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse>;
  getAgent(agentId: string): SpawnedAgent | undefined;
  listAgents(): SpawnedAgent[];
  getAvailablePersonas(): string[];
  async cleanup(): Promise<void>;
}
```

### spawn_agent Tool Schema

```json
{
  "type": "function",
  "function": {
    "name": "spawn_agent",
    "description": "Spawn a sub-agent with a specific persona to handle specialized tasks",
    "parameters": {
      "type": "object",
      "properties": {
        "persona": {
          "type": "string",
          "description": "Name of the persona to activate for the sub-agent"
        },
        "task": {
          "type": "string",
          "description": "Clear, specific task for the sub-agent to complete"
        },
        "context": {
          "type": "string",
          "description": "Additional context or background information"
        },
        "maxIterations": {
          "type": "number",
          "description": "Maximum iterations for sub-agent (default: 10)"
        }
      },
      "required": ["persona", "task"]
    }
  }
}
```

## Future Enhancements

- **Parallel Spawning**: Spawn multiple agents concurrently
- **Bidirectional Communication**: Parent-child message passing
- **Shared Memory**: Workspace for exchanging artifacts between agents
- **Agent Pools**: Reuse spawned agents for multiple tasks
- **Spawn Events**: Hooks for monitoring agent lifecycle

---

**Version**: 0.3.0  
**Status**: Production-ready  
**Requires**: PersonaManager initialized with personas
