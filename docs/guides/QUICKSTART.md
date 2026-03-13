# Jiva Quick Start Guide

## ⚡️ TL;DR - Get Started in 30 Seconds

### Option 1: Automated Setup
```bash
./setup.sh
```

### Option 2: Manual Setup
```bash
npm install && npm run build && npm link
```

### Option 3: Use Without Global Install
```bash
npm install && npm run build
node dist/interfaces/cli/index.js setup
```

---

## 🎯 Using Jiva

### First Time: Add to PATH

Since your npm global bin is not in PATH, run this **once**:

```bash
# For Zsh (macOS default)
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# For Bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Configure Jiva

```bash
jiva setup
```

You'll be prompted for:
- API endpoint (Krutrim, Groq, OpenAI, or any OpenAI-compatible provider)
- Your API key
- Model name (e.g., `gpt-oss-120b`, `openai/gpt-oss-20b`, etc.)
- Tool format (Harmony for Krutrim, Standard for Groq/OpenAI - auto-detected)
- Optional multimodal model

### Start Using

```bash
# Interactive mode (general-purpose)
jiva chat

# Code mode — optimized for software engineering tasks
jiva chat --code

# Single command
jiva run "What files are in this directory?"

# Single command in code mode
jiva run "Refactor the auth module to use async/await" --code

# With custom workspace
jiva chat --workspace ~/myproject

# With directive file
jiva chat --directive ./my-directive.md
```

---

## 🔧 Development Workflow

### Make code changes → Test

```bash
# 1. Edit files in src/
vim src/core/agent.ts

# 2. Rebuild
npm run build

# 3. Test (no need to relink!)
jiva --help
```

**That's it!** Since `npm link` creates a symlink, rebuilding is all you need.

### Watch mode for continuous development

```bash
# Terminal 1: Auto-rebuild on changes
npx tsc --watch

# Terminal 2: Test your changes
jiva chat --debug
```

---

## 🚫 Troubleshooting

### "command not found: jiva"

**Quick fix 1:** Use full path
```bash
/Users/abidev/.npm-global/bin/jiva --help
```

**Quick fix 2:** Use npx
```bash
npx jiva --help
```

**Permanent fix:** Add to PATH (see "Add to PATH" above)

### "Cannot find module" errors

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
npm link
```

### Changes not reflected

```bash
npm run build  # That's usually all you need!

# If still not working:
npm unlink -g jiva
npm link
```

---

## Common Commands

| Task | Command |
|------|---------|
| Setup Jiva | `jiva setup` |
| Interactive chat | `jiva chat` |
| Code mode (software tasks) | `jiva chat --code` |
| Run single prompt | `jiva run "your prompt"` |
| Run prompt in code mode | `jiva run "refactor X" --code` |
| Update config | `jiva config` |
| Debug mode | `jiva chat --debug` |
| Custom workspace | `jiva chat --workspace /path` |
| With directive | `jiva chat --directive file.md` |

---

## 🎓 Next Steps

1. **Read the README:** `cat README.md`
2. **Check examples:** `ls examples/`
3. **Create a directive:** `vim my-directive.md`
4. **Explore MCP servers:** `jiva chat` then type `servers`

---

## 📞 Need Help?

- Detailed docs: `BUILD.md`
- Implementation details: `IMPLEMENTATION_SUMMARY.md`
- Full documentation: `README.md`
