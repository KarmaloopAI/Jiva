import { ExternalLink, FileText, FileCode, FileJson } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { useFilesStore } from '../../store/files.store'

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'cpp', 'h', 'cs', 'swift',
  'sh', 'bash', 'zsh', 'fish',
  'yaml', 'yml', 'toml', 'ini', 'env',
  'html', 'css', 'scss', 'less',
  'sql', 'graphql', 'gql',
])

function getExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function getLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby',
    go: 'go', rs: 'rust',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    yaml: 'yaml', yml: 'yaml',
    json: 'json', toml: 'toml',
    html: 'html', css: 'css',
    sql: 'sql',
  }
  return map[ext] ?? ext
}

interface CodeViewProps {
  content: string
  language?: string
}

function CodeView({ content, language }: CodeViewProps) {
  return (
    <div
      className="rounded-xl overflow-auto flex-1"
      style={{
        background: 'var(--code-bg, rgba(0,0,0,0.06))',
        border: '1px solid var(--code-border, rgba(139,92,246,0.1))',
      }}
    >
      <pre
        className="p-4 text-xs leading-relaxed overflow-auto h-full"
        style={{
          fontFamily: 'JetBrains Mono, Fira Code, monospace',
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <code>{content}</code>
      </pre>
    </div>
  )
}

export function FilePreview() {
  const { selectedFile, fileContent, isLoadingFile, openExternal } = useFilesStore()

  if (!selectedFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(59,130,246,0.07))',
            border: '1px solid rgba(139,92,246,0.15)',
          }}
        >
          <FileText size={22} className="text-[var(--accent)] opacity-60" />
        </div>
        <p className="text-xs text-[var(--text-subtle)]">Select a file to preview it</p>
      </div>
    )
  }

  const fileName = selectedFile.split('/').pop() ?? selectedFile
  const ext = getExtension(selectedFile)
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const isJson = ext === 'json'
  const isCode = CODE_EXTENSIONS.has(ext)

  return (
    <div className="flex flex-col h-full">
      {/* File header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--card-border)' }}
      >
        {isCode || isJson ? (
          <FileCode size={14} className="text-[var(--accent)] flex-shrink-0" />
        ) : (
          <FileText size={14} className="text-[var(--accent)] flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-[var(--text)] truncate flex-1">{fileName}</span>
        <button
          onClick={() => openExternal(selectedFile)}
          className="flex items-center gap-1 text-[10px] text-[var(--text-subtle)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
          title="Open in Finder"
        >
          <ExternalLink size={11} />
          <span>Reveal</span>
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-4">
        {isLoadingFile && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--text-subtle)]">Loading...</p>
          </div>
        )}

        {!isLoadingFile && fileContent === null && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--text-subtle)] italic">
              Cannot preview this file type.
            </p>
          </div>
        )}

        {!isLoadingFile && fileContent !== null && isMarkdown && (
          <MarkdownRenderer content={fileContent} />
        )}

        {!isLoadingFile && fileContent !== null && !isMarkdown && (
          <CodeView content={fileContent} language={isCode || isJson ? getLanguage(ext) : undefined} />
        )}
      </div>
    </div>
  )
}
