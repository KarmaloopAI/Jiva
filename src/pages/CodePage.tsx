import { useEffect, useState } from 'react'
import { useCodeStore } from '../store/code.store'
import { useGitStore } from '../store/git.store'
import { CodeChatView } from '../components/code/CodeChatView'
import { GitPanel } from '../components/code/GitPanel'
import { WorkspacePickerView } from '../components/code/WorkspacePickerView'
import { ResizeHandle } from '../components/ui/ResizeHandle'

export function CodePage() {
  const { isSessionStarted } = useCodeStore()
  const { isRepo } = useGitStore()
  const [gitPanelWidth, setGitPanelWidth] = useState(320)

  // Keep git panel in sync after session starts
  useEffect(() => {
    if (isSessionStarted) {
      useGitStore.getState().checkIsRepo()
    }
  }, [isSessionStarted])

  // Before a session is started, show the workspace picker
  if (!isSessionStarted) {
    return <WorkspacePickerView />
  }

  return (
    <div className="flex h-full">
      {/* Center: code chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <CodeChatView />
      </div>

      {/* Resize handle + git panel (only when workspace is a git repo) */}
      {isRepo && (
        <>
          <ResizeHandle
            onResize={(delta) =>
              setGitPanelWidth((w) => Math.min(600, Math.max(240, w - delta)))
            }
          />
          <div
            className="flex-shrink-0 flex flex-col"
            style={{ width: `${gitPanelWidth}px`, borderLeft: '1px solid var(--card-border)' }}
          >
            <GitPanel />
          </div>
        </>
      )}
    </div>
  )
}
