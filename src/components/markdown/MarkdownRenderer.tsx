import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CodeBlock } from './CodeBlock'
import 'highlight.js/styles/github.css'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : undefined
            const isBlock = String(children).includes('\n')

            if (isBlock) {
              return (
                <CodeBlock language={language}>
                  {String(children)}
                </CodeBlock>
              )
            }

            return (
              <code
                style={{
                  background: 'var(--code-bg)',
                  border: '1px solid var(--code-border)',
                  borderRadius: '4px',
                  padding: '0.1em 0.4em',
                  fontSize: '0.875em',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                }}
              >
                {children}
              </code>
            )
          },
          // Override pre to prevent default styling (CodeBlock handles it)
          pre({ children }) {
            return <>{children}</>
          },
          // Open links externally
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
