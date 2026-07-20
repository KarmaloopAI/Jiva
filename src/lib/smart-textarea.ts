// Auto-continuation behavior for the chat input textareas, shared by chat
// mode (ChatInput.tsx) and code mode (CodeChatView.tsx). Deliberately stays
// on the plain <textarea> primitive — no live syntax highlighting, no
// contenteditable — just smart handling of Enter/backtick keystrokes,
// matching how Slack/Discord/Linear/GitHub comment boxes behave.
//
// Pure and DOM-free by design: callers pass the raw key + current value +
// selection range, and apply the returned {value, cursorPos} themselves
// (setValue(...) plus a manual textarea.setSelectionRange(...), since a
// controlled <textarea>'s cursor doesn't otherwise follow a value set from
// outside a normal keystroke).

export interface SmartKeydownResult {
  value: string
  cursorPos: number
}

const FENCE = '```'
const FENCE_LINE_RE = /^```(\w*)$/
const ORDERED_LIST_RE = /^(\s*)(\d+)\.\s+(.*)$/
const UNORDERED_LIST_RE = /^(\s*)([-*])\s+(.*)$/

function getLineStart(value: string, pos: number): number {
  const idx = value.lastIndexOf('\n', pos - 1)
  return idx === -1 ? 0 : idx + 1
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

/**
 * Returns the new textarea value + where to place the cursor if this
 * keystroke should be handled specially (caller should preventDefault and
 * apply both), or null to fall through to the textarea's normal behavior
 * (which, for Enter, is this app's existing send-message handling).
 */
export function handleSmartKeydown(
  key: string,
  value: string,
  selectionStart: number,
  selectionEnd: number
): SmartKeydownResult | null {
  // Wrap a selection in backticks instead of replacing it with a literal
  // backtick — single backticks for a single-line selection, a fenced block
  // for a selection spanning multiple lines.
  if (key === '`' && selectionStart !== selectionEnd) {
    const selected = value.slice(selectionStart, selectionEnd)
    const wrapped = selected.includes('\n')
      ? `${FENCE}\n${selected}\n${FENCE}`
      : `\`${selected}\``
    const newValue = value.slice(0, selectionStart) + wrapped + value.slice(selectionEnd)
    return { value: newValue, cursorPos: selectionStart + wrapped.length }
  }

  if (key !== 'Enter' || selectionStart !== selectionEnd) return null
  const cursor = selectionStart

  const lineStart = getLineStart(value, cursor)
  const currentLine = value.slice(lineStart, cursor)
  const trimmedLine = currentLine.trim()
  const fenceCountBeforeLine = countOccurrences(value.slice(0, lineStart), FENCE)
  const insideFenceBeforeLine = fenceCountBeforeLine % 2 === 1

  if (FENCE_LINE_RE.test(trimmedLine)) {
    if (!insideFenceBeforeLine) {
      // Opening a new fence — auto-insert the matching close, cursor on the blank line between.
      const insertion = `\n\n${FENCE}`
      const newValue = value.slice(0, cursor) + insertion + value.slice(cursor)
      return { value: newValue, cursorPos: cursor + 1 }
    }
    // Closing an already-open fence — plain newline, no double-close.
    const newValue = value.slice(0, cursor) + '\n' + value.slice(cursor)
    return { value: newValue, cursorPos: cursor + 1 }
  }

  if (insideFenceBeforeLine) {
    // Mid-fence content — behave like Shift+Enter: never send, never apply list logic.
    const newValue = value.slice(0, cursor) + '\n' + value.slice(cursor)
    return { value: newValue, cursorPos: cursor + 1 }
  }

  const ordered = ORDERED_LIST_RE.exec(currentLine)
  if (ordered) {
    const [, indent, numStr, content] = ordered
    if (content.trim() === '') {
      // Exit list mode: clear the marker back to an empty line, no continuation.
      const newValue = value.slice(0, lineStart) + indent + value.slice(cursor)
      return { value: newValue, cursorPos: lineStart + indent.length }
    }
    const insertion = `\n${indent}${parseInt(numStr, 10) + 1}. `
    const newValue = value.slice(0, cursor) + insertion + value.slice(cursor)
    return { value: newValue, cursorPos: cursor + insertion.length }
  }

  const unordered = UNORDERED_LIST_RE.exec(currentLine)
  if (unordered) {
    const [, indent, bullet, content] = unordered
    if (content.trim() === '') {
      const newValue = value.slice(0, lineStart) + indent + value.slice(cursor)
      return { value: newValue, cursorPos: lineStart + indent.length }
    }
    const insertion = `\n${indent}${bullet} `
    const newValue = value.slice(0, cursor) + insertion + value.slice(cursor)
    return { value: newValue, cursorPos: cursor + insertion.length }
  }

  return null
}
