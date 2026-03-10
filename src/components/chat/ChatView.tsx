import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export function ChatView() {
  return (
    <div className="flex flex-col h-full">
      <MessageList />
      <ChatInput />
    </div>
  )
}
