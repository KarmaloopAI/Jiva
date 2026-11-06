# Quick Start - New Features

## TL;DR

Jiva now has:
- ✨ **Auto-save conversations** - Never lose context
- ✨ **Pretty markdown** - Beautiful terminal output
- ✨ **Mission-driven** - Completes tasks thoroughly
- ✨ **Auto-condense** - Manages conversation size

**No setup required. Just use Jiva!**

---

## Try It Now

### 1. Start Jiva

```bash
npx jiva chat
```

### 2. Chat Normally

```
You: Create a hello world script in Python

Jiva: [Creates script with beautiful markdown formatting]
```

Your conversation auto-saves in the background! 💾

### 3. Save Manually (Optional)

```
You: save
✓ Conversation saved: conv-2025-12-09T10-30-00-abc123
```

### 4. List All Conversations

```
You: list

Saved Conversations (3):

1. conv-2025-12-09T12-45-15-ghi789
   Updated: 12/9/2025, 12:45:15 PM
   Messages: 18
   Discussion about implementing new features
```

### 5. Load a Previous Conversation

```
You: load

? Select conversation to load:
  ❯ 1. conv-2025-12-09T12-45-15-ghi789 (12/9/2025, 12:45:15 PM)
    2. conv-2025-12-09T11-15-30-def456 (12/9/2025, 11:15:30 AM)
    Cancel

✓ Conversation loaded: conv-2025-12-09T12-45-15-ghi789
```

Now you're back in that conversation! 🎉

---

## What's Different?

### Before

```
You: Fix the bug in authentication

Jiva: I found an error. [STOPS]
```

### After

```
You: Fix the bug in authentication

Jiva: I found an error in auth.ts:42
      Trying alternative approach...
      Fixed the issue by updating the token validation
      Running tests to verify...
      ✓ All tests passing

[Conversation auto-saved]
```

---

## Where Are Conversations Stored?

```bash
ls ~/.jiva/conversations/
```

Output:
```
conv-2025-12-09T10-30-00-abc123.json
conv-2025-12-09T11-15-30-def456.json
conv-2025-12-09T12-45-15-ghi789.json
```

Each file is a complete conversation with metadata.

---

## New REPL Commands

Type these in the Jiva chat:

| Command | What It Does |
|---------|-------------|
| `save` | Manually save current conversation |
| `load` | Load a saved conversation (interactive) |
| `list` | Show all saved conversations |
| `help` | See all commands |

---

## Markdown Examples

Jiva now outputs beautiful formatted text:

### Code Blocks

```
You: Show me a Python function

Jiva:
Here's a function:

  def greet(name):
      return f"Hello, {name}!"
```

With syntax highlighting in your terminal!

### Headers and Lists

```
Jiva:
Main Features
════════════

  • Fast performance
  • Easy to use
  • Extensible design
```

### Tables (if model outputs them)

```
Jiva:
┌────────────┬─────────┐
│ Feature    │ Status  │
├────────────┼─────────┤
│ Auto-save  │ ✓       │
│ Markdown   │ ✓       │
│ Mission    │ ✓       │
└────────────┴─────────┘
```

---

## Automatic Features

These work without any configuration:

### 1. Auto-Save
Every time you chat, the conversation is saved.

### 2. Auto-Condense
When conversation hits 30 messages, older messages are condensed into a summary.

### 3. Mission Completion
Agent won't stop until task is done (or asks for help).

### 4. Markdown Rendering
All markdown is automatically formatted.

---

## Configuration (Optional)

Want to customize? When you use Jiva from code, pick the agent that matches the CLI mode:

```typescript
import { DualAgent, CodeAgent } from 'jiva-core';

// General mode (what `jiva chat` uses): Manager plans, Worker executes MCP tools
const agent = new DualAgent({
  orchestrator,
  mcpManager,
  workspace,
  conversationManager,
  autoSave: true,              // Default: true
  maxIterations: 20,           // Worker iterations per subtask (default: 20)
  toolExecution: { parallel: true, maxConcurrency: 8 },  // Default
});

// Code mode (what `jiva chat --code` uses): single loop, in-process tools, LSP
const coder = new CodeAgent({
  orchestrator,
  workspace,
  conversationManager,
  maxIterations: 50,           // Default: 50
  lspEnabled: true,            // Default: true
});

const reply = await agent.chat('Summarize the README');
console.log(reply.content);
```

Both implement the same `IAgent` interface (`chat`, `cleanup`, `resetConversation`, …). A complete runnable example is in [examples/programmatic-usage.ts](../../examples/programmatic-usage.ts).

> `JivaAgent`, the original single-agent class, is **deprecated**. Use `DualAgent` or `CodeAgent` instead.

---

## Troubleshooting

### Conversations Not Saving?

Check if directory exists:
```bash
ls ~/.jiva/conversations/
```

If not, create it:
```bash
mkdir -p ~/.jiva/conversations
```

### Markdown Not Rendering?

Rebuild:
```bash
npm run build
```

---

## Pro Tips

### 1. Use `list` Often
See what conversations you have:
```
You: list
```

### 2. Name Your Workspace
Run Jiva from your project directory so conversations are tagged:
```bash
cd ~/dev/MyProject
npx jiva chat
```

### 3. Let Auto-Save Work
Don't worry about manual saves - it's automatic!

### 4. Trust the Mission-Driven Agent
Let it work through problems. It will ask if it needs help.

---

## What's Next?

Start using Jiva and enjoy:
- 📝 Never losing conversations
- 🎨 Beautiful terminal output
- 🎯 Tasks that actually complete
- ⚡ Better performance with auto-condensing

**Just run `npx jiva chat` and go!**

---

## Learn More

- Documentation index: [docs/README.md](../README.md)
- Configuration: [Configuration Guide](../user-guides/CONFIGURATION.md)
- Help: Type `help` in Jiva chat

---

**Happy coding with Jiva!** 🚀
