# Adding Features

This guide walks through the full stack of changes required to add a new
server-backed feature to Jivam. Every feature that requires Node-side
capabilities (file system, native APIs, jiva-core) follows this pattern.

---

## Overview

Adding a feature requires changes in four layers:

```
1. server/routes/*.ts           ← Register the Express route (server)
2. src/lib/electron-shim.ts     ← Expose it on window.electron (same method shape as the old Electron preload API)
3. src/types/electron.d.ts      ← Type the new API (TypeScript)
4. src/store/*.store.ts         ← Consume it in a Zustand store action
5. src/components/**/*.tsx      ← Build the UI using store + primitives
```

If the feature only touches frontend state (no server call needed), skip
steps 1–3 and add directly to a store and component.

This is a direct continuation of the old Electron IPC pattern — the layers
are the same, just routes instead of `ipcMain.handle` and `fetch`/WebSocket
instead of `ipcRenderer`. See
[../architecture/overview.md](../architecture/overview.md) for why.

---

## Worked Example: Word Count Panel

We'll add a panel that counts words in the currently open file.

### Step 1 — Express Route (`server/routes/workspace.ts`)

Add a new handler to the router:

```typescript
router.get('/word-count', (req, res) => {
  try {
    const filePath = req.query.path as string
    const homeDir = os.homedir()
    const resolvedFile = path.resolve(filePath)
    if (!resolvedFile.startsWith(path.resolve(homeDir))) {
      return res.json({ success: false, error: 'Access denied' })
    }

    const content = fs.readFileSync(resolvedFile, 'utf-8')
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    res.json({ success: true, wordCount })
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
})
```

**Convention:** Return `{ success: boolean; error?: string }` on failure.
Return the data on success alongside `success: true`. Add the route to
[../architecture/api-contract.md](../architecture/api-contract.md).

---

### Step 2 — electron-shim (`src/lib/electron-shim.ts`)

Add the new method inside the `workspace: { ... }` namespace of the shim
object, using the existing `get`/`post` helpers:

```typescript
workspace: {
  // ...existing methods...
  wordCount: (filePath: string) =>
    get<{ success: boolean; wordCount?: number; error?: string }>(
      '/workspace/word-count',
      { path: filePath },
    ),
},
```

---

### Step 3 — TypeScript Types (`src/types/electron.d.ts`)

Extend the `ElectronAPI` interface to include the new method:

```typescript
workspace: {
  // ...existing methods...
  wordCount: (filePath: string) => Promise<{
    success: boolean
    wordCount?: number
    error?: string
  }>
}
```

After this, `window.electron.workspace.wordCount(path)` is fully typed
throughout the frontend, and the shim's implementation is checked against
the same interface.

---

### Step 4 — Store Action (`src/store/files.store.ts`)

Add state and an action to the relevant store:

```typescript
interface FilesState {
  // ...existing state...
  wordCount: number | null
}

// Inside the store:
wordCount: null,

countWords: async () => {
  const { selectedFile } = get()
  if (!selectedFile) return
  const result = await window.electron.workspace.wordCount(selectedFile.path)
  if (result.success && result.wordCount !== undefined) {
    set({ wordCount: result.wordCount })
  }
},
```

Note: components and stores call `window.electron.*` exactly as they did in
the Electron era — nothing here changed. Only `electron-shim.ts`'s
*implementation* of that surface changed (fetch/WebSocket instead of IPC).

---

### Step 5 — Component (`src/components/files/WordCountBadge.tsx`)

Build the UI using store state and design system primitives:

```tsx
import { useFilesStore } from '../../store/files.store'
import { Badge } from '../ui/Badge'

export function WordCountBadge() {
  const { wordCount, countWords, selectedFile } = useFilesStore()

  useEffect(() => {
    if (selectedFile) countWords()
  }, [selectedFile, countWords])

  if (!wordCount) return null

  return (
    <Badge variant="default">
      {wordCount.toLocaleString()} words
    </Badge>
  )
}
```

---

### Step 6 — Wire to AppShell or Feature Panel

Add the component where it belongs in the layout:

```tsx
// In src/components/files/FilesPanel.tsx (or wherever the file preview lives):
import { WordCountBadge } from './WordCountBadge'

// In the file preview header:
<div className="flex items-center gap-2">
  <span className="text-sm text-[var(--text-muted)]">{selectedFile.name}</span>
  <WordCountBadge />
</div>
```

---

## Streaming/Push Features (WebSocket instead of a route)

If the feature needs to push updates to the frontend (progress events, log
lines, status changes) rather than a single request/response, use the
WebSocket broadcaster instead of (or alongside) a route:

**Server side** (`server/ws.ts`):
```typescript
broadcast('workspace:word-count-progress', { filePath, wordsScanned })
```

**Frontend side** — register a listener via the shim's `on()`, exposed as an
`onXxx()` method in the relevant `window.electron.*` namespace, matching the
pattern used by `jiva.onStatusChange`/`jiva.onPhaseUpdate`. See
[../architecture/api-contract.md](../architecture/api-contract.md) for the
full list of existing WebSocket events.

---

## Checklist

Use this checklist for every new server-backed feature:

- [ ] Route added in `server/routes/*.ts` (or a WebSocket broadcast added in `server/ws.ts` for push events)
- [ ] Route documented in [../architecture/api-contract.md](../architecture/api-contract.md)
- [ ] `namespace: { action: (...args) => get/post(...) }` added in `src/lib/electron-shim.ts`
- [ ] Type added to `ElectronAPI` in `src/types/electron.d.ts`
- [ ] Store action added that calls `window.electron.namespace.action()`
- [ ] Component uses `useXxxStore()` — no direct `window.electron` calls in components
- [ ] UI uses `Button` / `Badge` primitives (no raw `<button>`)
- [ ] Colors use CSS custom properties (no hardcoded hex)
- [ ] Errors handled gracefully — store sets an error state or shows a toast
- [ ] `npx tsc --noEmit` passes with zero errors

---

## Frontend-Only Features (No Server Call)

For purely UI features (e.g. a collapsible sidebar section, a new settings
toggle):

1. Add state to the relevant store if needed
2. Build the component
3. Import and render it in the appropriate parent

No route or shim changes needed.

---

## Adding a New Tab

To add a new top-level tab to the app:

1. Add the tab name to the `ActiveTab` union in `src/App.tsx`
2. Add a `TabButton` entry in `src/components/layout/AppShell.tsx` (sidebar nav)
3. Add a conditional render of the new panel in `AppShell`'s main content area
4. Create the panel component in `src/components/<feature>/`

---

## Security Considerations

- **File system access:** All file paths passed to route handlers must be
  validated against `os.homedir()`. See the `workspace/files` and
  `workspace/file` handlers in `server/routes/workspace.ts` for the pattern.
- **No shell injection:** Never interpolate user input into `exec`/`execSync`
  strings. Use argument arrays (`execFile`) wherever the input isn't a fixed,
  internally-controlled string.
- **Config writes:** Always read the existing config with `readConfig()`
  before writing — never overwrite with a partial object.
- **CORS/origin:** the server only binds to `127.0.0.1` — don't widen this
  without careful thought about what else that exposes on the local machine.
