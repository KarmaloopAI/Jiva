# Jiva Troubleshooting Guide

## MCP Server Issues

### Error: "Failed to connect to MCP server 'commands'"

**Error Message:**
```
MCPError: Failed to connect to MCP server 'commands': Connection closed
```

**Cause:** The `@modelcontextprotocol/server-commands` MCP server is unstable and often fails to connect.

**Solution 1: Quick Fix (Recommended)**

Delete your config and re-run setup:

```bash
# Remove old config
rm -rf ~/Library/Preferences/jiva-nodejs/

# Rebuild (if you made changes)
npm run build

# Re-run setup
npx jiva setup

# The new setup will have the commands server disabled by default
```

**Solution 2: Disable the Server Manually**

1. Run config manager:
   ```bash
   npx jiva config
   ```

2. Select "MCP Servers"

3. Remove or disable the "commands" server

**Solution 3: Edit Config File Directly**

1. Open config file:
   ```bash
   # macOS
   open ~/Library/Preferences/jiva-nodejs/config.json

   # Linux
   nano ~/.config/jiva-nodejs/config.json
   ```

2. Find the `commands` server entry and set `enabled: false`:
   ```json
   {
     "mcpServers": {
       "commands": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-commands"],
         "enabled": false   // ← Change to false
       }
     }
   }
   ```

3. Save and retry

---

### Error: "Failed to connect to MCP server 'filesystem'"

**Error Message:**
```
MCPError: Failed to connect to MCP server 'filesystem': ...
```

**Possible Causes:**
- The `@modelcontextprotocol/server-filesystem` package is not available
- Network issues preventing `npx` from downloading the package
- Permissions issues with the workspace directory

**Solution:**

Try disabling the filesystem server (Jiva will work without it):

```bash
npx jiva config
# Select "MCP Servers" > Remove "filesystem"
```

Or run without MCP servers entirely by disabling all of them.

---

### No MCP Servers Connected

**Message:**
```
No MCP servers connected. Agent will run without external tools.
```

**Is this a problem?** Not necessarily! Jiva will still work, but won't have access to:
- File operations (reading/writing files)
- Shell command execution

**When is this OK:**
- General conversation and reasoning
- Code analysis (if you paste code in chat)
- Answering questions

**When you need MCP servers:**
- File operations in workspace
- Automated code changes
- System interactions

**Solution:** Enable at least the filesystem server for basic file operations.

---

## Build Issues

### TypeScript Compilation Errors

**Error:**
```
error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
```

**Solution:**

```bash
# Check all type errors
npm run type-check

# Fix errors in the source files
# Then rebuild
npm run build
```

---

### Module Not Found Errors

**Error:**
```
Cannot find module '@modelcontextprotocol/sdk'
```

**Solution:**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build

# Relink
npm link
```

---

## Runtime Issues

### "Jiva is not configured"

**Error:**
```
✗ Jiva is not configured. Please run: jiva setup
```

**Solution:**

```bash
npx jiva setup
```

You'll need:
- Krutrim API endpoint
- API key
- Model names

---

### "Cannot find module" at Runtime

**Error:**
```
Error: Cannot find module './dist/core/agent.js'
```

**Solution:**

```bash
# Rebuild the project
npm run build

# If still failing, clean build
rm -rf dist/
npm run build
```

---

### API Key Errors

**Error:**
```
Krutrim API error (401): Unauthorized
```

**Solution:**

Your API key is invalid or expired.

```bash
# Update configuration
npx jiva config

# Select "Reasoning Model" and enter correct API key
```

---

### Rate Limit Errors

**Error:**
```
Krutrim API error (429): Too many requests
```

**Solution:**

Wait a few moments and try again. The API has rate limits.

---

## CLI Issues

### Command Not Found: jiva

**Error:**
```
command not found: jiva
```

**Solution:**

Use `npx` instead:

```bash
npx jiva --help
npx jiva setup
npx jiva chat
```

Or add npm global bin to PATH (see [BUILD.md](BUILD.md#4-add-npm-global-bin-to-path-if-needed)).

---

### Changes Not Reflected

**Issue:** Made code changes but behavior hasn't changed.

**Solution:**

Always rebuild before testing:

```bash
npm run build
npx jiva chat
```

---

### Permission Denied

**Error:**
```
Error: EACCES: permission denied
```

**Solution:**

```bash
# Make CLI executable
chmod +x dist/interfaces/cli/index.js

# Or reinstall
npm unlink -g jiva
npm link
```

---

## Configuration Issues

### Config File Corrupted

**Symptoms:**
- Strange errors on startup
- Config commands failing

**Solution:**

Reset configuration:

```bash
# Backup current config (optional)
cp ~/Library/Preferences/jiva-nodejs/config.json ~/jiva-config-backup.json

# Delete config
rm -rf ~/Library/Preferences/jiva-nodejs/

# Re-run setup
npx jiva setup
```

---

### Can't Find Config File

**To locate your config:**

```bash
# macOS
ls ~/Library/Preferences/jiva-nodejs/

# Linux
ls ~/.config/jiva-nodejs/

# Or use Jiva
npx jiva config
```

---

## Debug Mode

For any issue, enable debug logging:

```bash
npx jiva chat --debug
```

This will show:
- API requests/responses
- MCP server connections
- Tool executions
- Error stack traces

---

## Getting More Help

1. **Check logs:** Run with `--debug` flag
2. **Clean build:** `rm -rf dist/ && npm run build`
3. **Reset config:** Delete `~/Library/Preferences/jiva-nodejs/`
4. **Reinstall:** `rm -rf node_modules && npm install && npm run build`

---

## Common Solutions Summary

| Issue | Quick Fix |
|-------|-----------|
| MCP server error | `rm -rf ~/Library/Preferences/jiva-nodejs/ && npx jiva setup` |
| Build error | `npm run type-check` then fix errors |
| Command not found | Use `npx jiva` instead |
| Changes not working | `npm run build` |
| Config issues | Delete config dir and re-run setup |
| Module not found | `rm -rf node_modules && npm install && npm run build` |

---

## Still Having Issues?

1. Enable debug mode: `npx jiva chat --debug`
2. Check the error message carefully
3. Try the relevant solution above
4. If all else fails, do a complete reset:

```bash
# Complete reset
rm -rf node_modules dist/
rm -rf ~/Library/Preferences/jiva-nodejs/
npm install
npm run build
npm link
npx jiva setup
```
