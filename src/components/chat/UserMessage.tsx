import type { ChatMessage } from '../../types/chat'

interface UserMessageProps {
  message: ChatMessage
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex items-end justify-end gap-2 animate-slide-up">
      <div
        className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed"
        style={{
          background: 'var(--user-bubble-bg)',
          color: 'var(--user-bubble-text)',
        }}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
}
