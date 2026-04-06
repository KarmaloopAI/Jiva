# Harness Feature Guide

## Overview

Harnesses are a powerful new feature in Jiva that enable task validation and supervision through a dual-agent architecture. The harness system pairs a main Jiva agent with an autonomous evaluator agent that validates task completion and provides targeted guidance when gaps are found.

## The --harness Flag

The harness functionality is activated via the `--harness evaluator` CLI flag:

```bash
jiva chat --harness evaluator "Your task here"
```

When enabled, Jiva launches with a supervisor agent that monitors the main agent's work and ensures tasks are completed according to the workspace directive.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User Message                        │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                Main Agent (DualAgent)                  │
│  - Processes user request                              │
│  - Executes tools and writes files                     │
│  - Maintains conversation state                        │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                EvaluatorHarness                        │
│  - Coordinates evaluation process                      │
│  - Tracks token usage for both agents                  │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│             Evaluator Agent (Autonomous)               │
│  - Reads workspace files                               │
│  - Validates against directive                        │
│  - Sends nudges via interact_with_agent tool           │
│  - Runs evaluation cycles (default: 5)                 │
└─────────────────────────────────────────────────────────┘
```

## How It Works

### Step 1: Main Agent Processing
The main agent processes the user's request using the standard Jiva architecture:
- Reads workspace files and directive
- Executes tools and writes files
- Maintains conversation state
- Returns response content

### Step 2: Evaluation Process
The evaluator agent then validates the work:
1. **File Inspection**: Reads relevant workspace files to understand what was produced
2. **Gap Analysis**: Compares actual output against directive requirements
3. **Nudge Generation**: If gaps exist, uses `interact_with_agent` tool to send targeted instructions
4. **Re-validation**: Re-reads files to confirm corrections were applied
5. **Final Assessment**: Outputs JSON verdict with pass/fail status and gap details

### Step 3: Result Compilation
The `EvaluatorHarness` returns a comprehensive `HarnessResult` containing:
- Main agent response content
- Token usage for both agents
- Evaluation outcome with gaps, cycles, and summary

## Configuration Options

### Harness Options
```typescript
interface HarnessOptions {
  verbose?: boolean; // Default: true - controls evaluator logging
}
```

### Evaluation Configuration
The evaluator runs with configurable parameters:
- **Max Evaluation Cycles**: Default 5 (how many times it will nudge and re-check)
- **Max Iterations Per Cycle**: Default 30 (LLM calls per evaluation cycle)
- **Evaluation Mode**: High reasoning effort for thorough validation

### Model Configuration
The evaluator uses the same model configuration as the main agent but with isolated LLM state:
- Separate `ModelOrchestrator` instance
- Independent message history
- Same MCP servers and workspace access

## Virtual Tools

The evaluator has access to special virtual tools that bridge to the main agent:

### interact_with_agent
Sends instructions to the main agent and returns its response.
```json
{
  "name": "interact_with_agent",
  "description": "Send a message to the supervised Jiva agent",
  "parameters": {
    "message": "string (required) - instruction to send",
    "conversationId": "string (optional) - load specific conversation"
  }
}
```

### list_agent_conversations
Lists saved conversations from the main agent.
```json
{
  "name": "list_agent_conversations",
  "description": "List saved conversations from the main Jiva agent",
  "parameters": {}
}
```

### get_conversation_history
Retrieves message history from the currently loaded conversation.
```json
{
  "name": "get_conversation_history",
  "description": "Get message history of loaded conversation",
  "parameters": {
    "limit": "number (optional) - max messages to return"
  }
}
```

## Usage Examples

### Basic Usage
```bash
jiva chat --harness evaluator "Create a simple REST API with Express"
```

### With Workspace Directive
```bash
jiva chat --harness evaluator --workspace ./project "Build the frontend components"
```

### In Code Mode
```bash
jiva chat --harness evaluator --code "Implement the authentication middleware"
```

### Programmatic Usage
```typescript
import { createEvaluatorHarness } from './evaluator/index.js';

const harness = await createEvaluatorHarness(agent, mcpServers, orchestratorConfig);
const result = await harness.run(userMessage);
```

## Understanding Results

### HarnessResult Structure
```typescript
interface HarnessResult {
  mainAgentResponse: string;           // Final response from main agent
  mainAgentIterations: number;         // Total LLM calls by main agent
  evaluation: EvaluationResult;        // Evaluation outcome
  mainAgentTokenUsage?: TokenUsageSnapshot;  // Main agent token usage
  evaluatorTokenUsage?: TokenUsageSnapshot;  // Evaluator token usage
}

interface EvaluationResult {
  passed: boolean;                     // True if evaluation passed
  gaps: string[];                      // Specific incomplete items
  nudgesSent: number;                  // How many nudges were sent
  cyclesRan: number;                   // Evaluation cycles executed
  evidence: string[];                  // Files inspected during evaluation
  summary: string;                     // Human-readable assessment
}
```

### Interpreting Evaluation Results
- **Passed**: All directive requirements met
- **Failed**: Gaps remain after evaluation cycles
- **Gaps**: Specific items that need attention
- **Nudges**: How many times evaluator guided the main agent
- **Cycles**: Evaluation iterations (indicates thoroughness)

## Best Practices

### When to Use Harnesses
- **Critical Tasks**: When completion accuracy is essential
- **Complex Workflows**: Multi-step processes with validation requirements
- **Production Workflows**: Automated systems requiring reliability
- **Learning/Teaching**: When you want to understand what was missed

### Writing Effective Directives
For best evaluation results:
1. **Be Specific**: Clear, measurable requirements
2. **Structure**: Break complex tasks into logical sections
3. **Include Acceptance Criteria**: What constitutes "done"
4. **Reference Files**: Point to existing files that should be modified

### Monitoring Evaluation
- Watch the evaluator logs (verbose mode) to understand the process
- Review gaps to improve directive clarity
- Track cycles to optimize evaluation efficiency

## Advanced Features

### Doom Loop Detection
The evaluator includes safeguards against infinite loops:
- Detects repeated tool calls with same arguments
- Stops evaluation after max cycles (default: 5)
- Provides clear feedback on why evaluation stopped

### Evidence Tracking
The evaluator automatically tracks which files it inspects:
- File reads during evaluation
- Evidence collection for gap analysis
- Transparency into the evaluation process

### Conversation Context
The evaluator can load specific conversations:
- Review previous work before evaluating
- Continue from specific points in the conversation
- Context-aware evaluation

## Performance Considerations

### Token Usage
- Evaluator adds additional token usage (typically 2-3x main agent)
- Consider this in token budget planning
- Token usage is tracked and reported separately

### Latency
- Evaluation adds processing time (typically 2-3x response time)
- Trade-off between speed and validation thoroughness
- Configurable cycles allow balancing speed vs. accuracy

### Resource Usage
- Separate orchestrator and MCP manager instances
- Independent memory usage for evaluation state
- Proper cleanup of both agent instances

## Troubleshooting

### Common Issues

#### Evaluation Always Fails
- Check directive clarity and specificity
- Verify workspace files are accessible
- Review evidence to understand what evaluator is finding

#### Too Many Nudges
- Increase max evaluation cycles
- Improve directive with clearer requirements
- Add specific acceptance criteria

#### Performance Issues
- Reduce evaluation cycles for faster feedback
- Use concise directives
- Monitor token usage patterns

### Debug Mode
Enable verbose logging to see evaluation process:
```bash
jiva chat --harness evaluator --debug "Your task"
```

## Future Enhancements

The harness system is designed for extensibility:
- Additional evaluator types (different validation strategies)
- Custom evaluation directives
- Integration with external validation tools
- Enhanced reporting and analytics

## Conclusion

The harness feature provides powerful task validation capabilities that enhance Jiva's reliability for critical workflows. By combining autonomous evaluation with targeted guidance, it ensures tasks are completed according to specifications while providing transparency into the validation process.

For more information on related topics, see:
- [Agentic Pipeline Playbook](./agentic-pipeline-playbook.md)