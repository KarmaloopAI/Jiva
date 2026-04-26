# Code Agent Integration

Jivam includes a specialized code agent mode that allows AI agents to directly manipulate files, run commands, and manage code within a user's workspace. This mode operates as a separate agent instance from the main chat interface but uses the same underlying jiva-core technology.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  Chat Interface │  │  Code Agent UI  │  │   Git Panel │ │
│  │                 │  │                 │  │             │ │
│  │ • Message input │  │ • Code prompt   │  │ • File list │ │
│  │ • Persona chip  │  │ • Event cards   │  │ • Diff view │ │
│  │ • History       │  │ • Session mgmt  │  │ • Branch    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│           │                       │                       │
│           └───────────────────────┼───────────────────────┘
│                                   │
│                    ┌──────────────▼──────────────┐
│                    │   window.electron.code API   │
│                    │  (Preload Bridge)           │
│                    └──────────────┬──────────────┘
│                                   │
│                    ┌──────────────▼──────────────┐
│                    │   Main Process              │
│                    │  ┌──────────────────────┐  │
│                    │  │   CodeRunner         │  │
│                    │  │  ┌─────────────────┐ │  │
│                    │  │  │ Log Parser      │ │  │
│                    │  │  │ Event Manager   │ │  │
│                    │  │  │ Agent Instance  │ │  │
│                    │  │  └─────────────────┘ │  │
│                    │  └──────────────────────┘  │
│                    └───────────────────────────┘
│                                   │
│                    ┌──────────────▼──────────────┐
│                    │   jiva-core SDK             │
│                    │  ┌──────────────────────┐  │
│                    │  │   CodeAgent          │  │
│                    │  │   • File operations  │  │
│                    │  │   • Command execution│  │
│                    │  │   • Tool usage       │  │
│                    │  └──────────────────────┘  │
│                    └───────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### CodeRunner (`electron/code-runner.ts`)

The `CodeRunner` class manages a dedicated code agent instance with the following responsibilities:

- **Log Event Parsing**: Intercepts stdout/stderr from jiva-core and converts structured log lines into `CodeLogEvent` objects
- **Event Management**: Accumulates important events (file edits, warnings, errors) during code execution
- **Resource Management**: Proper cleanup of agent instances and temporary resources
- **Real-time Communication**: Streams progress events to the renderer via IPC

#### Log Event Format

jiva-core logs follow this format:
```
2026-03-13T10:28:32.695Z [INFO] [CodeAgent] Tool: glob
2026-03-13T10:28:33.123Z [WARN] [CodeAgent] Doom loop: tool: write_file
2026-03-13T10:28:33.456Z [ERROR] [CodeAgent] Model error: Invalid file path
```

#### CodeLogEvent Interface

```typescript
interface CodeLogEvent {
  timestamp: string        // ISO timestamp
  level: 'info' | 'warn' | 'error'
  tag: string              // Usually 'CodeAgent'
  message: string          // Raw log message
}
```

---

### CodeStore (`src/store/code.store.ts`)

The Zustand store that manages code agent state in the renderer:

#### State Management

| State | Type | Description |
|-------|------|-------------|
| `messages` | `CodeMessage[]` | Conversation history with code content |
| `isThinking` | `boolean` | Agent is processing a request |
| `currentAction` | `string \| null` | Current tool action (e.g., "Writing file...") |
| `pendingEvents` | `CodeEvent[]` | Events accumulated for current turn |

#### CodeMessage Interface

```typescript
interface CodeMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  events?: CodeEvent[]  // Tool events, warnings, errors
}
```

#### CodeEvent Interface

```typescript
interface CodeEvent {
  id: string
  type: 'tool' | 'warn' | 'error'
  detail: string
  timestamp: string
}
```

---

### Event Processing

#### Log to Action Mapping

The system maps log messages to user-friendly action descriptions:

| Log Pattern | Action Display |
|-------------|----------------|
| `Tool: read_file` | "Reading files..." |
| `Tool: write_file` | "Writing file..." |
| `Tool: edit_file` | "Editing file..." |
| `Tool: glob` | "Searching files..." |
| `Tool: grep` | "Searching content..." |
| `Tool: bash` | "Running command..." |
| `Nearing iteration limit` | "Wrapping up..." |
| `Final phase` | "Finalizing..." |
| `Repaired tool call` | "Retrying..." |

#### Important Event Detection

Events are marked as important and displayed if they:

- Have level `'warn'` or `'error'`
- Start with `Tool: edit_file`
- Start with `Tool: write_file`
- Start with `Tool: bash`

---

## IPC Contract

### Code Mode Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `code:send-message` | invoke | Send code prompt to agent |
| `code:stop-message` | invoke | Stop active code agent |
| `code:reset-session` | invoke | Tear down CodeRunner for fresh start |
| `code:init` | invoke | Initialize CodeRunner |

---

## UI Components

### CodeChatView (`src/components/code/CodeChatView.tsx`)

The main code agent interface featuring:

- **Message Display**: User prompts and agent responses with Markdown rendering
- **Event Cards**: Shows tool execution events above agent responses
- **Example Prompts**: Quick-start suggestions for common code tasks
- **Session Management**: New session button to start fresh code work

#### Example Prompts

The interface provides suggested prompts for common code tasks:
- "Find and fix the bug causing tests to fail"
- "Refactor this module for better readability"
- "Add error handling to the API endpoints"
- "Write a script to automate this task"

### GitPanel (`src/components/code/GitPanel.tsx`)

Integrated Git functionality with:

- **Repository Status**: Shows current branch and sync status (↑ahead, ↓behind)
- **File List**: Displays changed files with status badges (M, A, D, ??)
- **Diff Viewer**: Syntax-highlighted diff display with file headers
- **Branch Information**: Current branch name and upstream tracking

#### Status Badges

| Status | Display | Meaning |
|--------|---------|---------|
| `M` / `MM` | ⚠️ M | Modified files |
| `A` | ✅ A | Added files |
| `D` | 🗑️ D | Deleted files |
| `??` | ❓ ? | Untracked files |
| `R` | 🔄 R | Renamed files |

---

## Data Flow

### Code Execution Flow

1. **User Input**: User types code prompt in CodeChatView
2. **IPC Call**: `window.electron.code.sendMessage(prompt)`
3. **Agent Initialization**: CodeRunner creates/configures CodeAgent instance
4. **Log Interception**: stdout/stderr captured and parsed into structured events
5. **Event Processing**: Important events accumulated and sent to renderer
6. **Response Delivery**: Final code response returned with event history
7. **UI Update**: CodeChatView displays response with event cards

### Event Flow

```
jiva-core stdout/stderr
        ↓
Log Parser (parseLogLine)
        ↓
CodeLogEvent objects
        ↓
isImportantEvent() filter
        ↓
CodeEvent objects
        ↓
window.electron.code.onCodeLog callback
        ↓
useCodeStore.pendingEvents update
        ↓
Event cards displayed in UI
```

---

## Configuration

### Code Mode Settings

The code agent respects the same configuration as the main jiva-core system:

- **Model Configuration**: Reasoning model settings from `config.json`
- **Workspace Directory**: Current working directory for file operations
- **Persona System**: Can use different personas for code vs chat modes
- **MCP Servers**: Same tool servers available to both chat and code modes

### Workspace Security

Code operations are restricted to the user's home directory for security:

- File operations limited to `$HOME` (Windows: `%APPDATA%`)
- Path validation prevents directory traversal attacks
- Large files (>500KB) blocked from preview, require external editor

---

## Error Handling

### Common Error Scenarios

- **Agent Not Initialized**: CodeRunner not ready, requires `code:init` first
- **Workspace Not Set**: No workspace directory configured
- **Permission Denied**: File operations blocked by system permissions
- **Large Files**: Files >500KB rejected for preview
- **Invalid Paths**: Non-existent or inaccessible directories

### Error Recovery

- **Session Reset**: `code:reset-session` clears corrupted state
- **Agent Restart**: Automatic re-initialization on errors
- **Graceful Degradation**: UI continues working even if agent fails
- **User Notifications**: Clear error messages with actionable guidance