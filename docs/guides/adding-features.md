# Adding Features

This guide walks through the full stack of changes required to add a new IPC-backed feature to Jivam. Every feature that requires main-process capabilities (file system, native APIs, jiva-core) follows this pattern.

---

## Overview

Adding a feature requires changes in four layers:

```
1. electron/ipc-handlers.ts     ← Register the IPC handler (main process)
2. electron/preload.ts          ← Expose it on window.electron (preload bridge)
3. src/types/electron.d.ts      ← Type the new API (TypeScript)
4. src/store/*.store.ts         ← Consume it in a Zustand store action
5. src/components/**/*.tsx      ← Build the UI using store + primitives
```

If the feature only touches renderer state (no IPC needed), skip steps 1–3 and add directly to a store and component.

---

## Worked Example: Word Count Panel

We'll add a panel that counts words in the currently open file.

### Step 1 — IPC Handler (`electron/ipc-handlers.ts`)

Add a new `ipcMain.handle` inside `setupIpcHandlers`:

```typescript
ipcMain.handle('workspace:word-count', (_event, filePath: string) => {
  try {
    const homeDir = os.homedir()
    const resolvedFile = path.resolve(filePath)
    if (!resolvedFile.startsWith(path.resolve(homeDir))) return { success: false, error: 'Access denied' }

    const content = fs.readFileSync(resolvedFile, 'utf-8')
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    return { success: true, wordCount }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

**Convention:** Return `{ success: boolean; error?: string }` on failure. Return the data on success alongside `success: true`.

---

### Step 2 — Preload Bridge (`electron/preload.ts`)

Add the new method inside the `contextBridge.exposeInMainWorld('electron', { ... })` call, in the appropriate namespace:

```typescript
workspace: {
  // ...existing methods...
  wordCount: (filePath: string) =>
    ipcRenderer.invoke('workspace:word-count', filePath),
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

After this, `window.electron.workspace.wordCount(path)` will be fully typed throughout the renderer.

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

## Checklist

Use this checklist for every new IPC-backed feature:

- [ ] `ipcMain.handle('namespace:action', handler)` added in `electron/ipc-handlers.ts`
- [ ] `namespace: { action: (...args) => ipcRenderer.invoke(...) }` added in `electron/preload.ts`
- [ ] Type added to `ElectronAPI` in `src/types/electron.d.ts`
- [ ] Store action added that calls `window.electron.namespace.action()`
- [ ] Component uses `useXxxStore()` — no direct `window.electron` calls in components
- [ ] UI uses `Button` / `Badge` primitives (no raw `<button>`)
- [ ] Colors use CSS custom properties (no hardcoded hex)
- [ ] Errors handled gracefully — store sets an error state or shows a toast
- [ ] `npx tsc --noEmit` passes with zero errors

---

## File-Only Features (No IPC)

For purely UI features (e.g. a collapsible sidebar section, a new settings toggle):

1. Add state to the relevant store if needed
2. Build the component
3. Import and render it in the appropriate parent

No IPC or preload changes needed.

---

## Adding a New Tab

To add a new top-level tab to the app:

1. Add the tab name to the `ActiveTab` union in `src/App.tsx`
2. Add a `TabButton` entry in `src/components/layout/AppShell.tsx` (sidebar nav)
3. Add a conditional render of the new panel in `AppShell`'s main content area
4. Create the panel component in `src/components/<feature>/`

---

## Security Considerations

- **File system access:** All file paths passed to main-process handlers must be validated against `os.homedir()`. See the `workspace:list-files` and `workspace:read-file` handlers for the pattern.
- **No shell injection:** Never interpolate user input into `execSync` strings. Use argument arrays.
- **Config writes:** Always read the existing config with `readConfig()` before writing — never overwrite with a partial object.
