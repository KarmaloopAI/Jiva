import { useEffect } from 'react'
import { useCodeStore } from '../store/code.store'
import { useGitStore } from '../store/git.store'
import { CodeChatView } from '../components/code/CodeChatView'
import { GitPanel } from '../components/code/GitPanel'
import { WorkspacePickerView } from '../components/code/WorkspacePickerView'

export function CodePage() {
  const { isSessionStarted } = useCodeStore()
  const { isRepo } = useGitStore()

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

      {/* Right: git panel (only when workspace is a git repo) */}
      {isRepo && (
        <div
          className="w-80 flex-shrink-0 border-l flex flex-col"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <GitPanel />
        </div>
      )}
    </div>
  )
}
