import fs from 'fs'
import path from 'path'
import os from 'os'

const JIVA_DIR = path.join(os.homedir(), '.jiva')
const DIRECTIVE_PATH = path.join(JIVA_DIR, 'jiva-directive.md')
const CONVERSATIONS_DIR = path.join(JIVA_DIR, 'conversations')

interface ConversationMeta {
  date: string
  title: string
  messageCount: number
}

/**
 * Read the last N conversation files (sorted by modified time, newest first)
 * and extract metadata for the activity table.
 */
function readRecentConversations(limit = 5): ConversationMeta[] {
  try {
    if (!fs.existsSync(CONVERSATIONS_DIR)) return []

    const files = fs
      .readdirSync(CONVERSATIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const filePath = path.join(CONVERSATIONS_DIR, f)
        try {
          const stat = fs.statSync(filePath)
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          const messageCount: number = Array.isArray(raw.messages) ? raw.messages.length : 0
          // Use summary or title from the file, fallback to first user message content
          let title: string = raw.summary ?? raw.title ?? ''
          if (!title && Array.isArray(raw.messages)) {
            const firstUser = raw.messages.find(
              (m: { role?: string; content?: string }) => m.role === 'user'
            )
            if (firstUser?.content) {
              title = String(firstUser.content).slice(0, 60).replace(/\n/g, ' ')
              if (String(firstUser.content).length > 60) title += '...'
            }
          }
          title = title || 'Untitled conversation'
          return { stat, title, messageCount }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.stat.mtimeMs - a!.stat.mtimeMs)
      .slice(0, limit)

    return (files as NonNullable<(typeof files)[number]>[]).map(({ stat, title, messageCount }) => {
      const d = new Date(stat.mtimeMs)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return { date, title, messageCount }
    })
  } catch {
    return []
  }
}

/**
 * Build the content of the date-aware jiva-directive.md.
 */
export function buildDirectiveContent(): string {
  const now = new Date()

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const weekday = weekdays[now.getDay()]
  const month = months[now.getMonth()]
  const day = now.getDate()
  const year = now.getFullYear()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const time = `${hours}:${minutes}`

  // Get timezone abbreviation (e.g. "IST", "UTC", "EST")
  let timezone = 'UTC'
  try {
    timezone = Intl.DateTimeFormat('en', { timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'UTC'
  } catch {
    // Fallback to UTC offset
    const offset = -now.getTimezoneOffset()
    const sign = offset >= 0 ? '+' : '-'
    const absH = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
    const absM = String(Math.abs(offset) % 60).padStart(2, '0')
    timezone = `UTC${sign}${absH}:${absM}`
  }

  const iso = now.toISOString()

  // Build recent activity table
  const recent = readRecentConversations(5)
  let recentActivity: string
  if (recent.length === 0) {
    recentActivity = '_No previous sessions found._'
  } else {
    const rows = recent
      .map((c) => `| ${c.date} | "${c.title}" | ${c.messageCount} |`)
      .join('\n')
    recentActivity = `| Date | Title | Messages |\n|------|-------|----------|\n${rows}`
  }

  return `# Jiva Operating Context

## Current Date & Time
- Date: ${weekday}, ${month} ${day}, ${year}
- Time: ${time} ${timezone}
- ISO: ${iso}

## Important
- Always use the date above when referencing "today", "current year", or "recent" events
- Do NOT rely on training data for the current date — use only what is stated above
- When performing web searches, always use the year ${year} for current events

## Recent Session Activity
${recentActivity}
`
}

/**
 * Write the date-aware directive to ~/.jiva/jiva-directive.md and return the path.
 * This is called before WorkspaceManager.initialize() so the directive is picked up
 * as a system-level instruction for the agent.
 */
export function writeDirective(): { path: string; content: string } {
  const content = buildDirectiveContent()
  try {
    if (!fs.existsSync(JIVA_DIR)) {
      fs.mkdirSync(JIVA_DIR, { recursive: true })
    }
    fs.writeFileSync(DIRECTIVE_PATH, content, 'utf-8')
    console.log(`[DirectiveManager] Wrote directive to ${DIRECTIVE_PATH}`)
  } catch (err) {
    console.warn('[DirectiveManager] Failed to write directive:', err)
  }
  return { path: DIRECTIVE_PATH, content }
}
