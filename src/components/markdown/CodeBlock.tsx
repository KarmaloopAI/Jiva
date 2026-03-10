import { useState } from 'react'
import { Check, Copy, ChevronDown, ChevronUp } from 'lucide-react'

interface CodeBlockProps {
  children: string
  language?: string
  collapsible?: boolean
}

export function CodeBlock({ children, language, collapsible }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const code = children.trim()
  const isLong = code.split('\n').length > 20

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div
      className="rounded-lg overflow-hidden my-2"
      style={{
        background: 'var(--code-bg)',
        border: '1px solid var(--code-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--code-border)' }}
      >
        <span className="text-xs font-mono text-[var(--text-muted)]">
          {language || 'code'}
        </span>
        <div className="flex items-center gap-2">
          {(collapsible || isLong) && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="text-[var(--text-subtle)] hover:text-[var(--text)] transition-colors"
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            {copied ? (
              <>
                <Check size={13} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Content */}
      {!collapsed && (
        <div className={isLong ? 'max-h-96 overflow-y-auto' : ''}>
          <pre className="p-4 text-sm leading-relaxed overflow-x-auto">
            <code className={language ? `language-${language}` : ''}>{code}</code>
          </pre>
        </div>
      )}

      {collapsed && (
        <div className="px-4 py-2 text-xs text-[var(--text-subtle)] cursor-pointer" onClick={() => setCollapsed(false)}>
          {code.split('\n').length} lines — click to expand
        </div>
      )}
    </div>
  )
}
