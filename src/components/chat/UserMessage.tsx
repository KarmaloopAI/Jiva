import { FileText, Image } from 'lucide-react'
import type { ChatMessage } from '../../types/chat'

interface UserMessageProps {
  message: ChatMessage
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex items-end justify-end gap-2 animate-slide-up">
      <div className="max-w-[75%] flex flex-col items-end gap-1.5">
        {/* Attachment chips */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {message.attachments.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg"
                style={{
                  background: 'rgba(139,92,246,0.12)',
                  color: 'var(--text-subtle)',
                  border: '1px solid rgba(139,92,246,0.2)',
                }}
              >
                {file.category === 'image'
                  ? <Image size={10} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                  : <FileText size={10} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                }
                <span className="max-w-[160px] truncate">{file.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Message bubble */}
        {message.content && (
          <div
            className="rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed w-full"
            style={{
              background: 'var(--user-bubble-bg)',
              color: 'var(--user-bubble-text)',
            }}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        )}
      </div>
    </div>
  )
}
