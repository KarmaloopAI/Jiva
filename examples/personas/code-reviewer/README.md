# Code Reviewer Persona - README

An example Jiva persona that demonstrates comprehensive code review capabilities.

## Features

- **Comprehensive Analysis**: Bugs, security, performance, style, best practices
- **Categorized Findings**: Critical → High → Medium → Low priority
- **Concrete Solutions**: Specific fixes with before/after code examples
- **Security Focus**: OWASP Top 10, common vulnerability patterns
- **Performance Optimization**: Algorithm efficiency, caching, database optimization
- **MCP Integration**: Optional GitHub and code analysis MCP servers

## Structure

```
code-reviewer/
├── .claude-plugin/           # Plugin manifest (can also be .jiva-plugin/)
│   └── plugin.json          # Persona metadata
├── skills/                   # Agent skills
│   └── code-review/
│       ├── SKILL.md         # Main code review skill
│       └── references/      # OWASP security checklist
├── .mcp.json                # MCP server configuration (optional)
└── README.md                # This file
```

**Note:** This persona uses `.claude-plugin/` for Claude compatibility, but Jiva also supports `.jiva-plugin/` as the native format. Both work identically - Jiva checks for `.jiva-plugin` first, then falls back to `.claude-plugin`.

## Installation

### User-Level (Global)

```bash
cp -r code-reviewer ~/.jiva/personas/
```

### Project-Level

```bash
mkdir -p .jiva/personas
cp -r code-reviewer .jiva/personas/
```

## Usage

```bash
# Activate the persona
jiva persona activate code-reviewer

# Start chat
jiva chat

# Ask for a review
> Review the authentication code in src/auth/
> Check src/api/ for security issues
> Find performance problems in this codebase
```

### MCP Servers

This persona includes example MCP server configurations in `.mcp.json`:

- **GitHub MCP Server** (HTTP/SSE-based): Access GitHub repositories
- **Code Analysis MCP Server** (stdio-based): Run static analysis tools

To enable them, edit `.mcp.json` and:

1. Add your API keys/tokens
2. Set `"enabled": true`
3. Restart Jiva

## Skill: code-review

The main skill provides structured code analysis:

### What It Checks

1. **Bugs & Logic Errors**
   - Null/undefined handling
   - Off-by-one errors
   - Race conditions
   - Memory leaks

2. **Security Issues**
   - SQL injection
   - XSS vulnerabilities
   - Auth/authz flaws
   - Sensitive data exposure

3. **Performance Problems**
   - Inefficient algorithms
   - N+1 queries
   - Missing caching
   - Blocking operations

4. **Code Style**
   - Naming conventions
   - Dead code
   - Magic numbers
   - Complexity

5. **Best Practices**
   - DRY violations
   - SOLID principles
   - Error handling
   - Documentation

### Output Format

The skill generates structured reports:

```
# Code Review Report

## Summary
- Files reviewed: 15
- Issues found: 23 (2 critical, 5 high, 10 medium, 6 low)

## Critical Issues
[Detailed issues with fixes]

## Recommendations
[Overall improvement suggestions]
```

## Extending This Persona

### Add More Skills

```bash
# Create a new skill
jiva persona create-skill refactoring-advisor code-reviewer/skills \
  --description "Suggest refactoring opportunities"

# Edit the SKILL.md
# Package and redistribute
```

### Add Commands

Create a command in `commands/quick-review.md`:

```markdown
---
name: quick-review
description: Quick security-focused review
---

Run a fast security audit focusing on critical vulnerabilities only.
```

### Add Subagents

Define specialized agents in `agents/security-analyst.md` for deep security analysis.

## References

All detailed guidelines are in the `references/` directory:

- `security_checklist.md` - OWASP-based security checks
- `performance_patterns.md` - Common optimization patterns

These load on-demand when the skill needs them.

## Contributing

To improve this persona:

1. Add more reference documents
2. Expand the security checklist
3. Add language-specific guides
4. Create executable linting scripts

## License

MIT - Free to use and modify.
