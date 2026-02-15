# Agent Spawning Demo

This demo showcases Jiva's hierarchical agent spawning system where an engineering manager persona coordinates specialized sub-agents.

## Setup

### 1. Install Personas

```bash
# Install the example personas
cp -r examples/personas/engineering-manager ~/.jiva/personas/
cp -r examples/personas/developer ~/.jiva/personas/
cp -r examples/personas/tester ~/.jiva/personas/

# Verify installation
jiva persona list
```

You should see:
- ✓ engineering-manager v1.0.0
- ✓ developer v1.0.0  
- ✓ tester v1.0.0

### 2. Activate Engineering Manager

```bash
jiva persona activate engineering-manager
```

## Demo Scenarios

### Scenario 1: Build a Feature End-to-End

**User Request:**
```
Build a password reset feature for our authentication system. 
Include implementation, security review, and tests.
```

**Expected Flow:**

1. **Engineering Manager** analyzes the request
2. **Spawns Developer** sub-agent:
   ```
   Task: "Implement password reset functionality with email verification"
   ```
3. **Spawns Code Reviewer** sub-agent:
   ```
   Task: "Review password reset code for security vulnerabilities"
   ```
4. **Spawns Tester** sub-agent:
   ```
   Task: "Write comprehensive tests for password reset flow"
   ```
5. **Integrates** all results into final deliverable

**Try it:**
```bash
jiva chat

> Build a password reset feature. Include implementation, security review, and tests.
```

### Scenario 2: Fix Bug with Validation

**User Request:**
```
Users report that login sometimes fails with a 500 error. 
Debug and fix this issue.
```

**Expected Flow:**

1. **Engineering Manager** coordinates debugging
2. **Spawns Developer**:
   ```
   Task: "Debug login failures and fix the 500 error"
   Context: "Check error handling, database connections, and auth tokens"
   ```
3. **Spawns Tester**:
   ```
   Task: "Create regression tests for the login bug to prevent recurrence"
   ```
4. Returns fix with tests

**Try it:**
```bash
> Users report login failures with 500 errors. Debug and fix this.
```

### Scenario 3: Code Quality Improvement

**User Request:**
```
Improve error handling across all API routes. Make errors consistent and informative.
```

**Expected Flow:**

1. **Engineering Manager** plans quality improvement
2. **Spawns Code Reviewer**:
   ```
   Task: "Analyze current error handling patterns and identify inconsistencies"
   ```
3. **Spawns Developer**:
   ```
   Task: "Implement consistent error handling based on review findings"
   Context: <reviewer's findings>
   ```
4. Returns improved code

**Try it:**
```bash
> Review and improve error handling in all API routes.
```

## Observing Agent Spawning

Watch the logs to see agent spawning in action:

```
[INFO] >> User: Build a password reset feature
[INFO] [Manager] Creating plan...
[INFO] [Worker] Starting: "Spawn developer to implement password reset"
[INFO] [AgentSpawner] Spawning sub-agent with persona: developer
[INFO] [AgentSpawner] Task: Implement password reset functionality
[INFO] [AgentSpawner] Depth: 2/3
[SUCCESS] [AgentSpawner] Activated persona: developer
[INFO] [Worker] Using 3 tools
[INFO] [Worker] Tool: view
[INFO] [Worker] Tool: create_file
[INFO] [Worker] Tool: edit_file
[SUCCESS] [AgentSpawner] Sub-agent completed task (5 iterations)
[INFO] [Worker] Starting: "Spawn code-reviewer for security analysis"
...
```

## Expected Results

After running the demo, you should see:

1. **Implementation**: New files created by developer sub-agent
2. **Review**: Security findings from code-reviewer sub-agent
3. **Tests**: Test files created by tester sub-agent
4. **Integration**: Final summary from engineering manager combining all work

## Tips for Testing

### Verify Sub-Agent Spawning

Look for these log indicators:
- ✓ `[AgentSpawner] Spawning sub-agent with persona: X`
- ✓ `[AgentSpawner] Activated persona: X`
- ✓ `[AgentSpawner] Sub-agent completed task`

### Check Persona Skills

Each sub-agent should use its persona's skills:
- **Developer**: Creates/modifies code files
- **Code Reviewer**: Uses `view` and `grep_search` for analysis
- **Tester**: Creates test files with comprehensive cases

### Monitor Depth Levels

The system prevents infinite recursion:
- ✓ Level 1: User → Engineering Manager
- ✓ Level 2: Engineering Manager → Specialist
- ✗ Level 4+: Blocked (max depth: 3)

## Troubleshooting

### Issue: "Persona 'X' not found"

**Solution**: Install missing persona
```bash
cp -r examples/personas/X ~/.jiva/personas/
jiva persona list  # Verify
```

### Issue: "Maximum agent depth reached"

**Solution**: This is intentional safety limit. The engineering manager should solve tasks with 1-2 levels of spawning.

### Issue: Sub-agent doesn't use spawn_agent

**Possible causes**:
1. Task is simple enough to handle directly (good!)
2. Manager didn't provide clear delegation instruction
3. Model didn't recognize need for specialist

**Solution**: Try more complex request that clearly needs multiple specialists.

## Advanced Usage

### Multi-Stage Pipeline

```bash
> Create a REST API for user management, review it for security, write tests, and generate API documentation.
```

Expected spawning:
1. Developer → API implementation
2. Code Reviewer → Security analysis
3. Developer → Apply security fixes
4. Tester → Test suite
5. Developer → Documentation generation

### Iterative Refinement

```bash
> Build a user profile editor. After implementation, have it reviewed, then have the developer address all review feedback.
```

Expected flow:
1. Developer → Initial implementation
2. Code Reviewer → Review findings
3. Developer → Apply feedback (second spawn)

## Next Steps

1. **Try Custom Personas**: Create your own specialist personas
2. **Adjust Depth**: Experiment with maxDepth settings
3. **Chain Tasks**: Test complex multi-step workflows
4. **Monitor Performance**: Track spawning overhead and iteration counts

## Learn More

- [Agent Spawning Guide](./AGENT_SPAWNING.md) - Complete system documentation
- [Persona System](./PERSONAS.md) - How personas work
- [Example Personas](../../examples/personas/) - Reference implementations
