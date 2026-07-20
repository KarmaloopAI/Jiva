import { FileCode } from 'lucide-react'

interface FileMentionPopoverProps {
  files: string[]
  selectedIndex: number
  onSelect: (file: string) => void
}

// Simple fixed-position dropdown anchored above the textarea (same
// absolute-positioning convention as the existing settings popover) rather
// than tracking literal caret pixel coordinates — that needs a
// textarea-mirror-div technique for marginal UX gain over a fixed anchor.
export function FileMentionPopover({ files, selectedIndex, onSelect }: FileMentionPopoverProps) {
  if (files.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 mb-2 z-50 rounded-xl overflow-hidden w-[320px] max-h-[240px] overflow-y-auto"
      style={{
        background: 'var(--topbar-bg)',
        border: '1px solid var(--topbar-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {files.map((file, i) => (
        <button
          key={file}
          onMouseDown={(e) => { e.preventDefault(); onSelect(file) }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs"
          style={{
            background: i === selectedIndex ? 'rgba(59,130,246,0.12)' : 'transparent',
            color: i === selectedIndex ? 'var(--accent-blue)' : 'var(--text)',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          <FileCode size={11} className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
          <span className="truncate">{file}</span>
        </button>
      ))}
    </div>
  )
}
