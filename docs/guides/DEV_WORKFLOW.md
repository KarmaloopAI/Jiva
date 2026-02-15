# Development Workflow Summary

## 🎯 Your Daily Development Cycle

### 1️⃣ Edit Code

```bash
# Edit any TypeScript file
vim src/core/agent.ts
# or use your preferred editor
code .
```

### 2️⃣ Rebuild

```bash
npm run build
```

### 3️⃣ Test with npx

```bash
npx jiva --help
npx jiva setup
npx jiva chat
npx jiva run "your test prompt"
```

**That's it!** No relinking, no PATH issues, just build and test.

---

## 📋 Common Tasks

### Running the Setup Wizard

```bash
npx jiva setup
```

### Interactive Chat

```bash
npx jiva chat

# With debug mode
npx jiva chat --debug

# With custom workspace
npx jiva chat --workspace ~/myproject

# With directive file
npx jiva chat --directive ./my-directive.md
```

### Single Prompt Execution

```bash
npx jiva run "What files are in this directory?"
```

### Update Configuration

```bash
npx jiva config
```

---

## 🔄 Watch Mode (Continuous Development)

Open two terminals:

**Terminal 1 - Auto Rebuild:**
```bash
npx tsc --watch
```

**Terminal 2 - Testing:**
```bash
npx jiva chat --debug
# Make changes in your editor
# Save the file
# Terminal 1 rebuilds automatically
# Just restart jiva to see changes
```

---

## 🧪 Before Committing

```bash
# 1. Type check
npm run type-check

# 2. Clean build
rm -rf dist/
npm run build

# 3. Quick test
npx jiva --version
npx jiva --help

# 4. Functional test
npx jiva run "Test prompt"

# 5. Commit if all pass
git add .
git commit -m "Your changes"
```

---

## 🐛 Troubleshooting

### Build Fails

```bash
# Check TypeScript errors
npm run type-check

# Clean and rebuild
rm -rf dist/ node_modules/
npm install
npm run build
```

### Runtime Errors

```bash
# Run with debug logging
npx jiva chat --debug

# Check the output for detailed error messages
```

### "Cannot find module" Error

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
npm run build
npm link
```

### Config Issues

```bash
# View config
npx jiva config

# Reset config (will prompt to reconfigure)
rm -rf ~/Library/Preferences/jiva-nodejs/
npx jiva setup
```

---

## 📚 Documentation Files

- **[TESTING.md](TESTING.md)** - Comprehensive testing guide
- **[BUILD.md](BUILD.md)** - Full build instructions
- **[QUICKSTART.md](QUICKSTART.md)** - Quick start guide
- **[README.md](README.md)** - Main documentation
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Technical details

---

## 💡 Pro Tips

1. **Use watch mode** for rapid iteration
2. **Always rebuild** before testing changes
3. **Use `--debug`** flag when debugging
4. **Test incrementally** - don't make too many changes at once
5. **Check type errors first** - they're faster than runtime errors

---

## 🎯 Quick Reference

```bash
# Edit → Build → Test cycle
vim src/file.ts && npm run build && npx jiva test-command

# Watch mode
npx tsc --watch

# Debug mode
npx jiva chat --debug

# Type check only (fast)
npm run type-check

# Clean build
rm -rf dist/ && npm run build
```
