/**
 * Some providers' reasoning/"thinking" models (e.g. Together AI's DeepSeek-R1
 * and similar) emit raw `<think>...</think>` blocks inline in the response
 * content instead of a separate reasoning_content field. jiva-core only
 * strips these for auto-generated conversation titles
 * (ConversationManager.stripThinkingContent) — actual message content shown
 * to the user passes them through untouched. This pulls them out client-side
 * so they can be rendered as a collapsible "Thinking" section instead of
 * leaking into the visible response.
 */

const THINK_CLOSED_RE = /<think>([\s\S]*?)<\/think>/gi
// A model can also run out of output budget mid-thought, leaving an unclosed
// tag — treat everything from an unclosed <think> to the end as thinking too.
const THINK_UNCLOSED_RE = /<think>([\s\S]*)$/i

export interface ExtractedThinking {
  thinking: string | null
  content: string
}

export function extractThinking(raw: string): ExtractedThinking {
  if (!raw.includes('<think>')) {
    return { thinking: null, content: raw }
  }

  const closedBlocks: string[] = []
  let content = raw.replace(THINK_CLOSED_RE, (_match, inner: string) => {
    closedBlocks.push(inner.trim())
    return ''
  })

  let unclosedBlock: string | null = null
  const unclosedMatch = THINK_UNCLOSED_RE.exec(content)
  if (unclosedMatch) {
    unclosedBlock = unclosedMatch[1].trim()
    content = content.slice(0, unclosedMatch.index)
  }

  const blocks = [...closedBlocks, ...(unclosedBlock ? [unclosedBlock] : [])].filter(Boolean)
  return {
    thinking: blocks.length > 0 ? blocks.join('\n\n---\n\n') : null,
    content: content.trim(),
  }
}
