# Build & Development Instructions

## Initial Setup (First Time)

### 1. Install Dependencies

```bash
cd /Users/abidev/dev/Jiva
npm install
```

### 2. Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 3. Link Globally

```bash
npm link
```

This creates a global symlink to your local package, making the `jiva` command available system-wide.

### 4. Add npm Global Bin to PATH (If Needed)

Check where npm installs global packages:

```bash
npm config get prefix
```

If the output is something like `/Users/yourusername/.npm-global`, you need to add the bin directory to your PATH.

**For Zsh (default on modern macOS):**
```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**For Bash:**
```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 5. Verify Installation

```bash
which jiva
# Should output: /Users/yourusername/.npm-global/bin/jiva (or /usr/local/bin/jiva)

jiva --version
# Should output: 0.1.0

jiva --help
# Should show available commands
```

**Alternative: Use the full path without PATH setup:**
```bash
/Users/abidev/.npm-global/bin/jiva --help
# or
npx jiva --help
```

## Development Workflow (Subsequent Updates)

When you make changes to the code and want to test:

### Method 1: Using npx (Recommended for Testing)

```bash
# 1. Rebuild
npm run build

# 2. Test immediately with npx
npx jiva --help
npx jiva setup
npx jiva chat
# etc.
```

**Advantages:**
- No PATH setup required
- Works immediately after `npm link`
- Portable across different shells

### Method 2: Using Global Command (If PATH is set)

```bash
# 1. Rebuild
npm run build

# 2. Test immediately (no relinking needed - npm link creates a symlink)
jiva --help
jiva setup
# etc.
```

**Note:** Since `npm link` creates a symlink to your local `dist/` folder, rebuilding is all you need. The global `jiva` command automatically uses the latest built code.

### Development Mode (Watch & Auto-rebuild)

For active development with automatic rebuilding on file changes:

```bash
# Terminal 1: Start TypeScript compiler in watch mode
npx tsc --watch

# Terminal 2: Test your changes
npx jiva chat --debug
```

### Testing Without Global Install

If you don't want to use `npm link`, you can test directly:

```bash
# Build first
npm run build

# Run directly with node
node dist/interfaces/cli/index.js --help
node dist/interfaces/cli/index.js setup
node dist/interfaces/cli/index.js chat

# Or use npm script
npm run dev -- --help
npm run dev -- setup
npm run dev -- chat
```

## Complete Development Cycle

```bash
# 1. Make your code changes in src/
vim src/core/agent.ts

# 2. Rebuild
npm run build

# 3. Test
jiva chat --debug

# 4. Check for TypeScript errors without building
npm run type-check

# 5. If everything works, commit
git add .
git commit -m "Your changes"
```

## Troubleshooting

### "command not found: jiva"

**Cause:** Package not linked globally.

**Solution:**
```bash
cd /Users/abidev/dev/Jiva
npm link
```

### "Cannot find module" errors

**Cause:** Dependencies not installed or build is stale.

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build

# Relink if needed
npm unlink -g jiva
npm link
```

### Changes not reflected after rebuild

**Cause:** Multiple versions or cached builds.

**Solution:**
```bash
# Unlink and relink
npm unlink -g jiva
npm run build
npm link

# Clear any npm cache
npm cache clean --force
```

### Permission errors when running jiva

**Cause:** CLI file not executable.

**Solution:**
```bash
chmod +x dist/interfaces/cli/index.js
```

## Uninstalling

To remove the global `jiva` command:

```bash
# Unlink from global
npm unlink -g jiva

# Or if that doesn't work
npm uninstall -g jiva

# Verify it's gone
which jiva  # Should output nothing
```

## Building for Production

When ready to publish or distribute:

```bash
# Clean build
rm -rf dist/
npm run build

# Test the production build
node dist/interfaces/cli/index.js setup

# Create tarball for distribution
npm pack
# This creates jiva-0.1.0.tgz
```

## IDE Setup

### VS Code

Recommended extensions:
- ESLint
- Prettier
- TypeScript and JavaScript Language Features

Add to `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

### Build Task (VS Code)

Add to `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build Jiva",
      "type": "npm",
      "script": "build",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "problemMatcher": ["$tsc"]
    },
    {
      "label": "Watch Build",
      "type": "shell",
      "command": "npx tsc --watch",
      "problemMatcher": ["$tsc-watch"],
      "isBackground": true
    }
  ]
}
```

Now you can press `Cmd+Shift+B` (Mac) or `Ctrl+Shift+B` (Windows/Linux) to build.

## Quick Reference

| Task | Command |
|------|---------|
| Install dependencies | `npm install` |
| Build | `npm run build` |
| Link globally | `npm link` |
| Unlink globally | `npm unlink -g jiva` |
| Type check only | `npm run type-check` |
| Watch mode | `npx tsc --watch` |
| Dev mode | `npm run dev -- chat` |
| Clean build | `rm -rf dist/ && npm run build` |

## Environment Variables (Optional)

For development, you can set default API credentials:

```bash
# Add to ~/.zshrc or ~/.bashrc
export KRUTRIM_API_KEY="your-key-here"
export JIVA_DEBUG=true
```

Then in code, you can use:
```typescript
apiKey: process.env.KRUTRIM_API_KEY || 'fallback'
```
