# Broad Filesystem Access - Updated! ✅

## Important Change

Jiva now has **broad filesystem access to user directories** (subject to OS permissions). The workspace is your **default working area**, not a restriction.

**Note:** The filesystem MCP server rejects "/" (root directory) as a security measure. Jiva uses `/Users` on macOS, `/home` on Linux, and `C:\Users` on Windows for broad access to all user files while protecting system directories.

## What Changed

### Before (Restrictive)
```
Workspace: ~/dev/Jiva
Jiva could ONLY access files inside ~/dev/Jiva
```

### After (Broad User Access)
```
Default workspace: ~/dev/Jiva
Jiva can access files in all user directories (subject to OS permissions)
Access: /Users/* on macOS/Linux, C:\Users\* on Windows
```

## How It Works

### Workspace = Default, Not Limit

The workspace directory serves as:
- ✅ **Default working directory** for relative paths
- ✅ **Context** for the agent (what project you're working on)
- ✅ **Location** for finding `jiva-directive.md`
- ❌ **NOT a restriction** - Jiva can access files anywhere

### Filesystem Access

Jiva has broad access to user directories:

```typescript
// MCP filesystem server is configured with:
allowedPath = "/Users" (macOS) or "/home" (Linux) or "C:\\Users" (Windows)
```

This means Jiva can:
- ✅ Read files in all user home directories
- ✅ Access Desktop, Documents, Downloads, etc.
- ✅ Work across multiple projects in user directories
- ✅ Read files anywhere in /Users (macOS/Linux) or C:\Users (Windows)
- ❌ Cannot access system directories (/System, /Library, /bin, etc.)
- ❌ Cannot access files you don't have OS permission for

## Usage Examples

### Example 1: Access Files Outside Workspace

```bash
cd ~/dev/Jiva
npx jiva chat
```

```
You: Can you read the file at /Users/abidev/Documents/notes.txt?
Jiva: [reads /Users/abidev/Documents/notes.txt] ✅

You: List files in my home directory
Jiva: [lists files in /Users/abidev] ✅

You: What's in my home directory?
Jiva: [lists files in /Users/abidev] ✅
```

### Example 2: Work Across Multiple Projects

```
You: Compare the package.json from ~/dev/ProjectA and ~/dev/ProjectB
Jiva: [reads both files and compares them] ✅

You: Copy all markdown files from ~/dev/OldProject to the current workspace
Jiva: [accesses both directories] ✅
```

### Example 3: System-Wide Operations

```
You: Find all Python files in my home directory
Jiva: [searches entire home directory] ✅

You: What's in my Downloads folder?
Jiva: [lists ~/Downloads] ✅

You: Check my SSH config
Jiva: [reads ~/.ssh/config] ✅
```

## Security Considerations

### What Jiva CAN Do
- ✅ Read any file in user directories
- ✅ Write to any directory in /Users (that you have permission for)
- ✅ Execute commands (if commands MCP server is enabled)
- ✅ Navigate all user home directories

### What Jiva CANNOT Do
- ❌ Access system directories (/System, /Library, /bin, /usr, /etc, etc.)
- ❌ Access files outside /Users (or C:\Users on Windows)
- ❌ Access files you don't have permission for (e.g., other users' private files)
- ❌ Modify system configuration files
- ❌ Bypass OS security restrictions

### Best Practices

1. **Be specific about paths**
   - Use absolute paths when accessing files outside workspace
   - Example: "Read /Users/abidev/notes.txt" not "Read ../../../notes.txt"

2. **Review before destructive operations**
   - Jiva will show you what it's going to do
   - Review carefully before confirming deletions or modifications

3. **Use workspace for project context**
   - Run Jiva from your project directory
   - The workspace provides context about what you're working on

4. **Don't run Jiva as root/sudo**
   - Jiva doesn't need elevated privileges for normal operation
   - Running as root gives it too much power

## Technical Details

### Filesystem MCP Server Configuration

**Before:**
```typescript
args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceDir]
// Only allowed access to workspaceDir
```

**After:**
```typescript
const allowedPath = getDefaultFilesystemAllowedPath();
// macOS: "/Users", Linux: "/home", Windows: "C:\\Users"
args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath]
// Broad access to all user directories
```

**Note:** The MCP filesystem server specifically rejects "/" as a security measure. See [FILESYSTEM_SERVER_ROOT_FIX.md](FILESYSTEM_SERVER_ROOT_FIX.md) for details.

### System Prompt Updates

Jiva now knows it has broad access to user directories:

```
You have broad filesystem access to user directories (subject to OS permissions).
The workspace is your default working area, but you can access files in other
user directories as requested.
```

And explicit instructions:

```
6. You can access files in user directories - not just the workspace
   (use absolute paths when needed)
```

## Workspace Still Matters

Even with full filesystem access, the workspace is important for:

1. **Context**: Tells Jiva what project you're working on
2. **Default directory**: Relative paths are resolved from here
3. **Directive loading**: `jiva-directive.md` is loaded from workspace
4. **Display**: Shows user what the current focus is

## Platform Support

| Platform | Root Path | Notes |
|----------|-----------|-------|
| macOS | `/Users` | All user home directories |
| Linux | `/home` | All user home directories |
| Windows | `C:\Users` | All user profiles |

**Note:** To add additional directories, modify the MCP server configuration to include multiple allowed paths.

## Migration Notes

### If You Previously Ran Jiva

Your old config may have a restricted filesystem path. Run the fix script to update:

```bash
# Update your config to use /Users instead of old path
npm run fix-filesystem

# Or if you previously had "/" configured, the fix will update it to "/Users"
```

The fix script updates your stored configuration from "/" or old project paths to "/Users".

## Examples of Full Access Usage

### Cross-Project Analysis

```
You: Compare the TypeScript config between ~/dev/ProjectA and ~/dev/ProjectB
Jiva: ✅ Reads both tsconfig.json files and compares them

You: Find all TODO comments across all my projects in ~/dev
Jiva: ✅ Searches all subdirectories in ~/dev
```

### User Configuration

```
You: Show me my Git global config
Jiva: ✅ Reads ~/.gitconfig

You: What's in my SSH config?
Jiva: ✅ Reads ~/.ssh/config
```

### File Management

```
You: Move all screenshots from Downloads to ~/Pictures/Screenshots
Jiva: ✅ Accesses both directories

You: Backup this workspace to ~/Backups/2025-12-09/
Jiva: ✅ Creates backup in different directory
```

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Filesystem access | Workspace only | User directories ✅ |
| Workspace purpose | Restriction | Default + context ✅ |
| Can access /Users/abidev/Documents | ❌ | ✅ |
| Can access /System or /etc | ❌ | ❌ (protected) |
| Can work across projects | ❌ | ✅ |
| OS permission limits | ✅ | ✅ (unchanged) |

---

**Jiva now has broad access to help you across all your user directories, while system directories remain protected!** 🎉

For details on why "/" isn't used, see [FILESYSTEM_SERVER_ROOT_FIX.md](FILESYSTEM_SERVER_ROOT_FIX.md).
