import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { McpOnboardingModal } from './McpOnboardingModal'

export function ChatView() {
  return (
    <div className="flex flex-col h-full">
      <MessageList />
      <ChatInput />
      <McpOnboardingModal />
    </div>
  )
}
