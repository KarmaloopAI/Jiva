# Multi-Agent Collaboration Personas

This directory contains example personas demonstrating Jiva's hierarchical agent spawning system.

## Overview

These personas showcase **multi-agent collaboration** where a coordinator persona (engineering-manager) can spawn specialized sub-agents to handle complex software development tasks.

## Personas Included

### 1. Engineering Manager
**Path**: `engineering-manager/`
**Role**: Project coordinator and team leader
**Capabilities**:
- Analyzes complex requirements
- Breaks down work into specialized tasks
- Spawns sub-agents (developer, code-reviewer, tester)
- Integrates outputs from multiple specialists
- Delivers cohesive final results

**Use When**: You have complex multi-faceted projects requiring coordination

### 2. Developer
**Path**: `developer/`
**Role**: Software implementation specialist
**Capabilities**:
- Implements features end-to-end
- Writes production-quality code
- Fixes bugs and refactors
- Follows best practices and patterns

**Use When**: You need hands-on coding work

### 3. Tester
**Path**: `tester/`
**Role**: Quality assurance specialist
**Capabilities**:
- Writes unit, integration, and E2E tests
- Validates functionality
- Creates test cases for edge conditions
- Ensures code quality

**Use When**: You need comprehensive test coverage

### 4. Code Reviewer
**Path**: `../code-reviewer/` (already exists)
**Role**: Security and quality auditor
**Capabilities**:
- Reviews code for bugs, security, performance
- Identifies vulnerabilities
- Suggests improvements

**Use When**: You need specialized code analysis

## Installation

### User-Level (Global)

```bash
# Install all multi-agent personas
cp -r examples/personas/engineering-manager ~/.jiva/personas/
cp -r examples/personas/developer ~/.jiva/personas/
cp -r examples/personas/tester ~/.jiva/personas/

# Verify
jiva persona list
```

### Project-Level

```bash
# Project-specific installation
mkdir -p .jiva/personas
cp -r examples/personas/engineering-manager .jiva/personas/
cp -r examples/personas/developer .jiva/personas/
cp -r examples/personas/tester .jiva/personas/
```

## Quick Start

### 1. Activate Engineering Manager

```bash
jiva persona activate engineering-manager
jiva chat
```

### 2. Request Complex Task

```
> Build a user authentication feature with JWT tokens, review it for security issues, and write comprehensive tests.
```

### 3. Observe Multi-Agent Collaboration

The engineering manager will:
1. Spawn **developer** to implement auth system
2. Spawn **code-reviewer** to analyze security
3. Spawn **tester** to create test suite
4. Integrate all work into final deliverable

## Usage Examples

### Example 1: Feature Development Pipeline

**Input:**
```
Create a REST API for user profile management with CRUD operations.
Have it reviewed and tested.
```

**Process:**
- Engineering Manager spawns **developer** → API implementation
- Spawns **code-reviewer** → Security and quality review  
- Spawns **tester** → Test suite creation
- Returns complete solution

### Example 2: Bug Fix with Validation

**Input:**
```
Fix the race condition in concurrent user updates. Add tests to prevent regression.
```

**Process:**
- Engineering Manager spawns **developer** → Debug and fix
- Spawns **tester** → Regression tests
- Returns fix with tests

### Example 3: Code Quality Initiative

**Input:**
```
Refactor the payment processing module to improve maintainability and add error handling.
```

**Process:**
- Engineering Manager spawns **code-reviewer** → Analyze current state
- Spawns **developer** → Refactor based on findings
- Spawns **tester** → Verify no regressions
- Returns improved code

## Collaboration Patterns

### Pattern 1: Sequential Specialization
```
User → Manager → Developer → Code Reviewer → Developer (apply fixes)
```
Use when: Each stage informs the next

### Pattern 2: Parallel Work Streams
```
User → Manager → [Developer, Tester] in sequence
```
Use when: Independence between implementation and testing

### Pattern 3: Iterative Refinement
```
User → Manager → Developer → Code Reviewer → Developer → Tester
```
Use when: Quality improvement cycles needed

## Best Practices

### For Engineering Manager

✅ **Do**:
- Delegate complex, specialized tasks
- Provide clear context to sub-agents
- Review sub-agent outputs before integration
- Synthesize findings into cohesive answers

❌ **Don't**:
- Micromanage simple tasks
- Spawn agents for trivial work
- Blindly accept sub-agent outputs
- Over-delegate (too many spawns)

### Task Delegation Guidelines

**Good delegation:**
- "Implement JWT authentication in src/auth/ following OAuth 2.0 patterns"
- "Review src/payments/ for security vulnerabilities, focus on SQL injection"
- "Write unit tests for src/api/users.ts covering all CRUD operations"

**Poor delegation:**
- "Do something with the code" (too vague)
- "Check everything" (too broad)
- "Fix bugs" (not specific enough)

## Customization

### Create Your Own Specialist

```bash
# Copy template
cp -r examples/personas/developer examples/personas/my-specialist

# Edit manifest
# .jiva-plugin/plugin.json - change name, description

# Edit skills
# skills/*/SKILL.md - define capabilities
```

### Extend Existing Personas

Add skills to existing personas:
```bash
# Add new skill to developer
mkdir ~/.jiva/personas/developer/skills/my-new-skill
# Create SKILL.md with frontmatter + instructions
```

## Monitoring

### Watch Agent Spawning

Enable verbose logging to see spawning in action:
```bash
export LOG_LEVEL=debug
jiva chat
```

Look for:
- `[AgentSpawner] Spawning sub-agent`
- `[AgentSpawner] Activated persona: X`
- `[AgentSpawner] Sub-agent completed task`

### Track Depth

The system limits nesting to prevent infinite recursion:
- Max depth: 3 (configurable)
- Current depth shows in logs
- Exceeding max depth throws error

## Troubleshooting

### Persona Not Found

**Symptom:** `Persona 'X' not found`

**Solutions:**
1. Install persona: `cp -r examples/personas/X ~/.jiva/personas/`
2. Verify: `jiva persona list`
3. Check spelling in spawn request

### No Agent Spawning

**Symptom:** Manager doesn't spawn sub-agents

**Possible Causes:**
1. Task too simple (manager handles directly)
2. No clear need for specialist
3. Model didn't recognize spawning opportunity

**Solutions:**
- Make request more complex
- Explicitly mention needing review/testing
- Try: "Build X, have Y review it, then Z test it"

### Maximum Depth Exceeded

**Symptom:** `Maximum agent depth (3) reached`

**Explanation:** Safety limit prevents infinite recursion

**Solutions:**
- Redesign task to need fewer levels
- Adjust maxDepth (advanced use only)

## Performance Considerations

- **Spawning Overhead**: Each spawn creates full DualAgent instance
- **Sequential Execution**: Sub-agents run one at a time
- **Iteration Budget**: Sub-agents get maxIterations setting
- **Memory Usage**: Scales with number of spawned agents

## Learn More

- [Agent Spawning Guide](../../docs/guides/AGENT_SPAWNING.md) - Complete documentation
- [Agent Spawning Demo](../../docs/guides/AGENT_SPAWNING_DEMO.md) - Interactive tutorial
- [Persona System](../../docs/guides/PERSONAS.md) - How personas work

## Contributing

Contributions welcome! To add new specialist personas:

1. Follow directory structure (`/.jiva-plugin/plugin.json`, `/skills/`)
2. Write clear, focused skills (SKILL.md with frontmatter)
3. Test with engineering-manager spawning
4. Document use cases in README
5. Submit PR with examples
