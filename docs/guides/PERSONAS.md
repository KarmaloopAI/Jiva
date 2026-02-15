# Jiva Personas: Skills & Plugins Guide

version: 0.3.0  
**100% compatible with Claude's Skills/Plugins system**

## Overview

Jiva Personas (Plugins) are composable bundles that extend Jiva's capabilities through:
- **Skills**: Domain-specific knowledge and workflows
- **Commands**: User-invoked slash commands
- **Agents**: Specialized subagents
- **Hooks**: Event-driven automation
- **MCP Servers**: External tool integration

Build once, run on both Claude and Jiva.

## Quick Start

### Using Personas

```bash
# List available personas
jiva persona list

# Activate a persona
jiva persona activate data-analyst

# List skills in active persona
jiva persona skills

# Use persona in chat
jiva chat  # Skills are automatically available
```

### Creating Skills

```bash
# Create a new skill
jiva persona create-skill my-skill \
  --description "Does X when user asks about Y" \
  --author "Your Name" \
  --license MIT

# Edit the generated SKILL.md file
# Add scripts, references, and assets

# Package for distribution
jiva persona package-skill my-skill
# Creates: my-skill.skill (ZIP archive)
```

### Installing Skills

```bash
# Install a .skill file into a persona
jiva persona install-skill my-skill.skill my-persona
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  PERSONA (Plugin)                │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │  Skill A  │ │  Skill B  │ │  MCP Server(s)│  │
│  │ SKILL.md  │ │ SKILL.md  │ │  .mcp.json    │  │
│  │ scripts/  │ │ refs/     │ │               │  │
│  └───────────┘ └───────────┘ └───────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │  Commands │ │  Agents   │ │    Hooks      │  │
│  │commands/*.md│agents/*.md│ │  hooks.json   │  │
│  └───────────┘ └───────────┘ └───────────────┘  │
│  .jiva-plugin/plugin.json OR .claude-plugin/plugin.json │
└─────────────────────────────────────────────────┘
```

**Plugin Directory Support:** Personas can use either:
- `.jiva-plugin/plugin.json` (native Jiva format, recommended)
- `.claude-plugin/plugin.json` (for Claude compatibility)

Jiva automatically detects both formats, preferring `.jiva-plugin` if both exist.

**Cloud Run Integration:** Personas work seamlessly in both CLI and HTTP/Cloud Run modes. Each session automatically initializes PersonaManager, loads active personas, and merges their MCP servers.

## Skills - The Atomic Unit

A skill is a folder with a `SKILL.md` file. That's the only requirement.

### Minimal Skill

```
my-skill/
└── SKILL.md          # Required
```

### Full Skill Structure

```
my-skill/
├── SKILL.md          # Required — frontmatter + instructions
├── scripts/          # Executable code (Python/Bash/Node.js)
├── references/       # Docs loaded into context on demand
└── assets/           # Templates, fonts, images for output
```

### SKILL.md Format

```yaml
---
name: my-skill                    # Required. kebab-case, max 64 chars
description: >                    # Required. max 1024 chars. The TRIGGER.
  Do X when user asks Y. Use this skill whenever the user mentions
  Z, even if they don't explicitly ask for it.
license: MIT                      # Optional
compatibility: requires bash      # Optional. max 500 chars
allowed-tools: [bash, view]       # Optional. restrict tool access
metadata:                         # Optional. arbitrary key-value
  author: abi
  version: 1.0.0
---

# My Skill

## Overview
One-liner of what this does.

## Workflow
Step-by-step instructions the agent follows.

## Resources
Point to scripts/ and references/ with guidance on WHEN to read them.
```

### Validation Rules

The system enforces these frontmatter rules:

- **name**: `^[a-z0-9-]+$`, no leading/trailing/consecutive hyphens, max 64 chars
- **description**: no angle brackets `<>`, max 1024 chars
- **Allowed keys**: `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`
- **Body length**: < 500 lines (warning if exceeded)

### Progressive Disclosure

The system is optimized for context window efficiency:

| Layer | When loaded | Purpose |
|-------|------------|---------|
| **L1: Metadata** | Always | Routing - agent sees ALL skill names/descriptions |
| **L2: SKILL.md body** | When triggered | Instructions - agent reads when skill is selected |
| **L3: references/, scripts/** | On demand | Resources - loaded during execution only when needed |

**L1 drives routing.** Write descriptions that are "pushy" and include all trigger phrases.

**L2 is the prompt.** This teaches the agent HOW to use the skill. Write in imperative form.

**L3 is the toolkit.** Scripts execute without loading into context. References load only when SKILL.md says "read X when doing Y."

## Personas (Plugins)

A persona bundles multiple skills and other components into a distributable unit.

### Directory Structure

```
my-persona/
├── .claude-plugin/
│   └── plugin.json           # Manifest (required)
├── skills/                   # Agent Skills (auto-loaded)
│   ├── data-analysis/
│   │   └── SKILL.md
│   └── report-builder/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── commands/                 # Slash commands (user-invoked)
│   ├── analyze.md
│   └── report.md
├── agents/                   # Subagent definitions
│   └── researcher.md
├── hooks/                    # Event handlers
│   └── hooks.json
└── .mcp.json                 # MCP server configuration (optional)
```

### Plugin Manifest

`.claude-plugin/plugin.json`:

```json
{
  "name": "data-analyst",
  "description": "Data analysis, visualization, and reporting persona",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "homepage": "https://github.com/user/persona",
  "jivaVersion": ">=0.3.0"
}
```

### MCP Server Configuration

Personas can bundle their own MCP servers in `.mcp.json`. This supports both:

**HTTP/SSE-based servers** (recommended for cloud APIs):

```json
{
  "mcpServers": {
    "github": {
      "url": "https://mcp.github.com/v1",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      },
      "enabled": true
    }
  }
}
```

**Stdio-based servers** (for local tools):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "enabled": true
    }
  }
}
```

When a persona is activated, its MCP servers are automatically loaded and merged with global MCP servers.

### Installation

Personas are discovered in:

```
~/.jiva/personas/             # User-level personas
./.jiva/personas/             # Project-level personas
```

Project-level personas override user-level ones with the same name.

## Creating a Complete Persona

### 1. Create Directory Structure

```bash
mkdir -p my-persona/.claude-plugin
mkdir -p my-persona/skills
mkdir -p my-persona/commands
mkdir -p my-persona/agents
mkdir -p my-persona/hooks
```

### 2. Write Manifest

```bash
cat > my-persona/.claude-plugin/plugin.json << 'EOF'
{
  "name": "my-persona",
  "description": "Your persona description",
  "version": "1.0.0",
  "author": { "name": "Your Name" }
}
EOF
```

### 3. Add Skills

```bash
# Create a skill
jiva persona create-skill core-skill my-persona/skills \
  --description "Core functionality for this persona"

# Edit my-persona/skills/core-skill/SKILL.md
# Add scripts and references as needed
```

### 4. Install Locally

```bash
# Copy to user-level personas
cp -r my-persona ~/.jiva/personas/

# Or for project-level
cp -r my-persona ./.jiva/personas/
```

### 5. Activate and Test

```bash
# Refresh persona list
jiva persona list

# Activate
jiva persona activate my-persona

# Test in chat
jiva chat
> test the core skill
```

## Integration with Agent System

When a persona is active:

1. **Discovery**: All skills' L1 metadata is injected into the system prompt
2. **Routing**: Agent sees skill descriptions and picks the best match
3. **Loading**: Agent reads the full SKILL.md using the `view` tool
4. **Execution**: Agent follows SKILL.md instructions, loading L3 resources as needed

The agent's system prompt includes:

```xml
<active_persona>
  <name>data-analyst</name>
  <description>Data analysis persona</description>
  <version>1.0.0</version>
  <skills_count>5</skills_count>
</active_persona>

<available_skills>
<skill>
  <name>data-analysis</name>
  <description>Analyze datasets, create visualizations...</description>
  <location>/path/to/skills/data-analysis/SKILL.md</location>
</skill>
...
</available_skills>

When a user's request matches a skill description, read that skill's 
SKILL.md file using the view tool to get detailed instructions. Skills 
use progressive disclosure - only load what you need when you need it.
```

## Distribution

### Packaging Skills

```bash
# Package a single skill
jiva persona package-skill my-skill
# Creates: my-skill.skill (ZIP archive)
```

The `.skill` file excludes:
- `node_modules/`
- `__pycache__/`
- `.git/`
- `.env`
- Development/test files

### Sharing Personas

Package the entire persona directory:

```bash
zip -r my-persona.zip my-persona/ \
  -x "*/node_modules/*" \
  -x "*/__pycache__/*" \
  -x "*/.git/*"
```

Users install by:

```bash
# Extract to user-level personas
unzip my-persona.zip -d ~/.jiva/personas/

# Or project-level
unzip my-persona.zip -d ./.jiva/personas/
```

## CLI Reference

```bash
# List personas
jiva persona list

# Activate persona
jiva persona activate <name>

# Deactivate current persona
jiva persona deactivate

# List skills in persona
jiva persona skills [persona-name]

# Create new skill
jiva persona create-skill <name> [dir] \
  --description "..." \
  --author "..." \
  --license MIT

# Package skill
jiva persona package-skill <skill-dir> [output.skill]

# Install skill into persona
jiva persona install-skill <skill-file> <persona-name>
```

## Best Practices

### Skill Design

1. **Write pushy descriptions**: Include all trigger phrases, keywords, and use cases
2. **Keep SKILL.md concise**: < 500 lines. Move detailed docs to `references/`
3. **Use progressive disclosure**: Don't load everything upfront
4. **Test with various phrasings**: Users will ask in unexpected ways
5. **Include examples**: Show expected input/output formats

### Script Guidelines

1. **Make scripts self-contained**: Don't assume specific host environments
2. **Use shebangs**: `#!/usr/bin/env python3` for portability
3. **Return structured output**: JSON or clearly delimited text
4. **Handle errors gracefully**: Return error messages, don't crash
5. **Document parameters**: Comment script usage at the top

### Directory Organization

```
good-skill/
├── SKILL.md                  # Keep under 500 lines
├── scripts/
│   ├── process_data.py       # Named by purpose
│   ├── generate_report.sh    # Executable
│   └── helpers.js            # Shared utilities
├── references/
│   ├── api_docs.md           # External API reference
│   ├── examples.md           # Usage examples
│   └── troubleshooting.md    # Common issues
└── assets/
    ├── template.txt          # Output templates
    └── config.json           # Default config
```

## Examples

### Data Analysis Skill

```yaml
---
name: data-analysis
description: >
  Analyze datasets from CSV, JSON, Excel files. Use when user mentions:
  data analysis, statistics, trends, correlations, data visualization,
  exploratory data analysis, EDA, descriptive statistics.
metadata:
  author: jiva-community
  version: 1.0.0
allowed-tools: [bash, view, write]
---

# Data Analysis Skill

## Overview
Analyze datasets to extract insights, statistics, and visualizations.

## Workflow
1. **Load data**: Read CSV/JSON/Excel using `scripts/load_data.py`
2. **Analyze**: Run `scripts/analyze.py` to get summary statistics
3. **Visualize**: Generate charts with `scripts/visualize.py`
4. **Report**: Format findings clearly for the user

## Resources
- `references/pandas_guide.md` - When working with complex dataframes
- `scripts/load_data.py <file>` - Returns: JSON summary of loaded data
- `scripts/analyze.py <file>` - Returns: Statistics JSON
- `scripts/visualize.py <file> <chart-type>` - Creates PNG visualization
```

### Code Review Skill

```yaml
---
name: code-review
description: >
  Review code for bugs, style, performance, security. Use when user says:
  review my code, check this code, code review, find bugs, improve code,
  refactor suggestions, security audit, performance optimization.
metadata:
  author: jiva-community
  version: 1.0.0
---

# Code Review Skill

## Overview
Comprehensive code review covering bugs, style, performance, and security.

## Workflow
1. **Read code**: Use `view` tool to read all relevant files
2. **Analyze**: Check against `references/review_checklist.md`
3. **Categorize issues**: bugs, style, performance, security
4. **Provide suggestions**: Specific, actionable improvements
5. **Format report**: Use template from `assets/review_template.md`

## Resources
- `references/review_checklist.md` - Comprehensive review criteria
- `references/language_best_practices/` - Language-specific guides
- `assets/review_template.md` - Output format template
```

## Troubleshooting

### Persona not found

```bash
# Check installation
ls -la ~/.jiva/personas/
ls -la ./.jiva/personas/

# Refresh discovery
jiva persona list
```

### Skill not triggering

1. Check description includes trigger phrases
2. Verify SKILL.md frontmatter is valid
3. Test with explicit skill-related keywords

### Build errors

```bash
# Validate skill structure
cd my-skill
ls -la  # Verify SKILL.md exists

# Check frontmatter
head -20 SKILL.md  # Should start with ---
```

## Migration from Claude

Jiva personas are 100% compatible with Claude plugins:

1. Copy Claude plugin directory to `~/.jiva/personas/`
2. Run `jiva persona list` to verify
3. Activate with `jiva persona activate <name>`
4. Test in chat

No changes required!

## References

- [Jiva Documentation](https://github.com/KarmaloopAI/Jiva)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Agent Skills Reference](https://code.claude.com/docs/en/skills)
- [MCP Protocol](https://modelcontextprotocol.io/)

---

**Next Steps:**
- Browse [example personas](https://github.com/KarmaloopAI/Jiva/tree/main/examples)
- Join the [community](https://github.com/KarmaloopAI/Jiva/discussions)
- Share your personas!
