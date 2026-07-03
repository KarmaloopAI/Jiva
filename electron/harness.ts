import fs from 'fs'
import os from 'os'
import path from 'path'
import type { CodeLogEvent } from '../src/types/electron'

export interface Skill {
  name: string
  description: string
  dir: string
}

// Provided by the runner so harness can call the model without knowing jiva-core internals.
// Returns the model's text response, or null on failure.
export type Completer = (systemPrompt: string, userPrompt: string) => Promise<string | null>

// Internal types for the brain's task decomposition
interface SubtaskSpec {
  id: number
  label: string
  prompt: string
  complexity?: 'simple' | 'medium' | 'complex'
}

interface McpRecommendation {
  name: string    // npm package / server name (e.g. "@modelcontextprotocol/server-github")
  reason: string  // one sentence: why this server would help
}

interface SubtaskPlan {
  mode: 'direct' | 'delegate'
  subtasks: SubtaskSpec[]
  reasoning: string
  explanation: string   // human-readable thought process emitted to the user
  directResponse?: string  // populated when mode === 'direct'
  mcpRecommendations?: McpRecommendation[]  // suggested MCP servers the user should configure
}

let skillCache: Skill[] | null = null

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = value
  }
  return result
}

export async function discoverSkills(): Promise<Skill[]> {
  if (skillCache !== null) return skillCache

  const searchDirs = [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.jiva', 'skills'),
  ]

  const skills: Skill[] = []

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = path.join(dir, entry.name)
      const skillMdPath = path.join(skillDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const fm = parseFrontmatter(content)
        const name = fm.name ?? entry.name
        const description = fm.description ?? ''
        skills.push({ name, description, dir: skillDir })
      } catch {
        // skip unreadable skill
      }
    }
  }

  skillCache = skills
  return skills
}

function emitBrain(msg: string, onBrainLog: (e: CodeLogEvent) => void): void {
  onBrainLog({
    timestamp: new Date().toISOString(),
    level: 'info',
    tag: 'brain',
    message: msg,
  })
}

// Words that only appear in conversational/acknowledgment messages.
// If ALL words in a short message are in this set we bypass planning entirely.
const CONVO_SAFE_WORDS = new Set([
  // Thanks
  'thanks', 'thank', 'you', 'ty',
  // Acknowledgments
  'ok', 'okay', 'alright', 'right', 'sure', 'yep', 'yup', 'yeah', 'nope',
  // Positive reactions
  'great', 'good', 'nice', 'cool', 'perfect', 'awesome', 'excellent',
  'fantastic', 'wonderful', 'brilliant', 'well', 'done', 'job', 'work',
  // Sign-offs
  'bye', 'goodbye', 'later', 'cheers', 'ciao',
  // "No problem" / "You're welcome"
  'welcome', 'problem', 'np', 'worries', 'no',
  // Session-end phrases: "we are done for this session", "that's all"
  'we', 'are', 'were', 'finished', 'this', 'is', 'the', 'end',
  'session', 'all', 'that', 'it', 'for', 'our', 'now', 'here',
  // Misc conversational
  'got', 'sounds', 'lol', 'haha', 'heh', 'wow', 'oh', 'ah', 'hmm',
  'a', 'an', 'and', 'or', 'but', 'very', 'much', 'so', 'yes', 's',
])

/**
 * Returns true for messages like "alright thanks", "great work, we are done",
 * "cheers", "ok", etc. — messages where every word is a safe conversational word
 * and the total length is short. These skip planExecution() entirely.
 */
function looksConversational(prompt: string): boolean {
  const trimmed = prompt.trim()
  if (trimmed.length > 80) return false
  const words = trimmed.toLowerCase().replace(/[^a-z'\s]/g, '').trim().split(/\s+/)
  if (words.length === 0 || words.length > 12) return false
  return words.every(w => CONVO_SAFE_WORDS.has(w))
}

// Extract a brief meaningful summary from an agent result (first non-empty line of substance)
function extractSummary(content: string, maxLen = 140): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
    if (trimmed.length >= 20) {
      return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed
    }
  }
  return content.slice(0, maxLen)
}

async function planExecution(
  userPrompt: string,
  skills: Skill[],
  completer: Completer,
  onBrainLog: (e: CodeLogEvent) => void,
  conversationContext?: string,
  configuredMcpServers?: string[]
): Promise<SubtaskPlan> {
  const skillList = skills.length > 0
    ? skills.map(s => `- ${s.name} (${s.dir}): ${s.description}`).join('\n')
    : '(none available)'

  const contextSection = conversationContext
    ? `\nConversation history so far:\n${conversationContext}\n`
    : ''

  const mcpSection = configuredMcpServers && configuredMcpServers.length > 0
    ? `\nConfigured MCP servers (tools the agent already has access to): ${configuredMcpServers.join(', ')}`
    : `\nConfigured MCP servers: none beyond built-in filesystem and shell.`

  const systemPrompt = `You are a senior AI coordinator. Your first job is to decide whether to answer the user DIRECTLY or DELEGATE the task to a capable AI coding worker.${contextSection}
ANSWER DIRECTLY (mode: "direct") when the message is:
- Conversational: greetings, thanks, sign-offs, "great work", "we're done", smalltalk
- Simple follow-up you can answer from the conversation context above ("what did you find?", "how many issues?")
- Meta-questions about the session: "are we done?", "can you summarise what we covered?"
- Anything that would be bizarre to run shell commands for

DELEGATE (mode: "delegate") when the message genuinely requires:
- Code execution, file operations, web research, data analysis
- Reading, writing, or modifying files in a workspace
- Iterative tool use, running tests, building, or searching

For DIRECT: write a warm, natural response in "directResponse". Be concise.
For DELEGATE: decompose into 1-5 focused subtasks. Prefer 1 subtask unless distinct phases are truly needed.

Rules for delegation:
- Each subtask prompt must be self-contained and include all relevant context.
- Write subtask prompts as clean, direct task instructions — no internal headers ("Goal:", "Requirements:", "Planned Subtask for the Worker"), no scaffolding phrases ("Please proceed with...", "Once the results are returned, I will review them", "provide the final response to the user"). Brief the worker as you would a colleague: just the task.
- "explanation" is 1-2 plain-English sentences for the user about your approach.
- Set "complexity" per subtask: "simple" for quick single-file edits, "complex" for multi-file refactors or build cycles, "medium" for everything else.
- Respond with valid JSON only. No markdown fences.
${mcpSection}

MCP recommendations: If the user's request would be meaningfully better with an MCP server that is NOT currently configured (e.g. they want to browse the web but no browser MCP is present, interact with GitHub but no GitHub MCP is set up, send Slack messages, query databases, etc.), include an "mcpRecommendations" array. Each entry: {"name":"package-or-server-name","reason":"one sentence why"}. Only recommend when genuinely useful — skip for tasks that can be done with the current tools. The user can discover and install MCP servers at https://mcpservers.org and configure them in Jivam via Settings (gear icon) → MCPs.

Available skills:
${skillList}`

  const userMsg = `User message:
${userPrompt}

Respond with JSON exactly (use the mode that fits):
{"mode":"direct","reasoning":"one sentence","explanation":"1-2 sentences for the user","directResponse":"full warm response to the user","subtasks":[]}
OR
{"mode":"delegate","reasoning":"one sentence","explanation":"1-2 sentences for the user","subtasks":[{"id":1,"label":"short 3-6 word label","prompt":"full focused self-contained prompt","complexity":"simple|medium|complex"}],"mcpRecommendations":[{"name":"server-name","reason":"why it helps"}]}`

  const fallback: SubtaskPlan = {
    mode: 'delegate',
    reasoning: 'Proceeding as a single task',
    explanation: 'On it...',
    subtasks: [{ id: 1, label: 'completing your request', prompt: userPrompt }],
  }

  try {
    const raw = await completer(systemPrompt, userMsg)
    if (!raw) return fallback

    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '')
    const parsed = JSON.parse(cleaned) as {
      mode?: string
      reasoning?: string
      explanation?: string
      directResponse?: string
      subtasks?: Array<{ id?: number; label?: string; prompt?: string; complexity?: string }>
      mcpRecommendations?: Array<{ name?: string; reason?: string }>
    }

    const mode = parsed.mode === 'direct' ? 'direct' : 'delegate'
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    const explanation = typeof parsed.explanation === 'string' && parsed.explanation
      ? parsed.explanation
      : mode === 'direct' ? 'Answering this directly.' : 'Handling this as a single focused task.'

    // Parse optional MCP recommendations
    const mcpRecommendations: McpRecommendation[] | undefined =
      Array.isArray(parsed.mcpRecommendations)
        ? parsed.mcpRecommendations
            .filter(r => typeof r.name === 'string' && r.name.trim())
            .map(r => ({ name: r.name as string, reason: typeof r.reason === 'string' ? r.reason : '' }))
        : undefined

    // Direct response path — no worker needed
    if (mode === 'direct') {
      const directResponse = typeof parsed.directResponse === 'string' ? parsed.directResponse : ''
      return { mode: 'direct', reasoning, explanation, directResponse, subtasks: [], mcpRecommendations }
    }

    // Delegate path — parse subtasks
    if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) return fallback

    const subtasks: SubtaskSpec[] = parsed.subtasks
      .filter(s => typeof s.label === 'string' && typeof s.prompt === 'string')
      .map((s, i) => ({
        id: typeof s.id === 'number' ? s.id : i + 1,
        label: s.label as string,
        prompt: s.prompt as string,
        complexity: (s.complexity === 'simple' || s.complexity === 'medium' || s.complexity === 'complex')
          ? s.complexity
          : 'medium',
      }))

    if (subtasks.length === 0) return fallback

    const plan: SubtaskPlan = { mode: 'delegate', reasoning, explanation, subtasks, mcpRecommendations }
    return plan
  } catch {
    return fallback
  }
}

async function synthesize(
  userPrompt: string,
  results: Array<{ label: string; content: string }>,
  completer: Completer,
  onBrainLog: (e: CodeLogEvent) => void
): Promise<string> {
  emitBrain('Pulling everything together...', onBrainLog)

  const systemPrompt = `You are a technical writer. Synthesize the outputs of multiple completed subtasks into one coherent final response to the user's original request. Be concise. Do not repeat implementation details — reference them. Markdown is fine.`

  const subtaskBlocks = results
    .map((r, i) => `### Subtask ${i + 1}: ${r.label}\n${r.content}`)
    .join('\n\n')

  const userMsg = `Original request:\n${userPrompt}\n\nSubtask results:\n\n${subtaskBlocks}\n\nWrite the final synthesized response.`

  try {
    const raw = await completer(systemPrompt, userMsg)
    if (raw) return raw
  } catch {
    // fall through
  }

  return results[results.length - 1].content
}

async function validate(
  userPrompt: string,
  result: string,
  completer: Completer,
  onBrainLog: (e: CodeLogEvent) => void
): Promise<{ satisfied: boolean; followUp: string }> {
  emitBrain('Checking the result...', onBrainLog)

  const systemPrompt = `You are verifying whether an AI agent fully completed a task. Be strict but fair — if the core request was addressed, mark it satisfied. Only mark unsatisfied if something specific and important was clearly missed or left incomplete. Respond with valid JSON only, no markdown fences.`

  const userMsg = `Original request:\n${userPrompt}\n\nAgent output (truncated to 2000 chars):\n${result.slice(0, 2000)}\n\nRespond with JSON:\n{"satisfied":true,"follow_up":"empty if satisfied, otherwise a precise description of what is still missing"}`

  const fallback = { satisfied: true, followUp: '' }

  try {
    const raw = await completer(systemPrompt, userMsg)
    if (!raw) return fallback

    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '')
    const parsed = JSON.parse(cleaned) as { satisfied?: boolean; follow_up?: string }

    return {
      satisfied: parsed.satisfied !== false,
      followUp: typeof parsed.follow_up === 'string' ? parsed.follow_up : '',
    }
  } catch {
    return fallback
  }
}

// Compute per-subtask iteration limit based on brain's complexity hint
function subtaskMaxIterations(
  complexity: SubtaskSpec['complexity'],
  userMaxIterations: number
): number {
  switch (complexity) {
    case 'simple':  return Math.max(10, Math.floor(userMaxIterations * 0.4))
    case 'complex': return Math.min(userMaxIterations * 2, 200)
    default:        return userMaxIterations  // 'medium' or undefined
  }
}

// Ask the model to reframe the prompt given the error, so a retry has a better angle
async function reformulateForRetry(
  originalPrompt: string,
  error: string,
  attempt: number,
  completer: Completer,
  onBrainLog: (e: CodeLogEvent) => void
): Promise<string> {
  emitBrain(`Adjusting my approach (attempt ${attempt})...`, onBrainLog)

  const systemPrompt = `You are helping recover from a failed AI agent execution. The agent was given a task but encountered an error. Rewrite the task prompt to be more explicit, simpler, or to work around the failure. Do not include meta-commentary — output only the revised prompt text.`
  const userMsg = `Original task:\n${originalPrompt}\n\nError encountered:\n${error}\n\nWrite an improved version of the task prompt that is more likely to succeed.`

  try {
    const revised = await completer(systemPrompt, userMsg)
    if (revised && revised.trim().length > 20) return revised.trim()
  } catch {}

  return originalPrompt  // fall back to original if completer fails
}

// Generate a user-friendly explanation of why the task could not be completed
async function generateFailureExplanation(
  subtaskLabel: string,
  originalPrompt: string,
  error: string,
  completer: Completer,
  onBrainLog: (e: CodeLogEvent) => void
): Promise<string> {
  emitBrain(`Ran into trouble with "${subtaskLabel}" — here's what happened:`, onBrainLog)

  const systemPrompt = `You are a helpful AI assistant explaining a task failure to the user. Be concise, honest, and constructive. Do not expose raw error messages or stack traces. Explain what was attempted, what went wrong at a high level, and suggest what the user could try next. Use plain Markdown.`
  const userMsg = `Task attempted: ${subtaskLabel}\nTask description: ${originalPrompt}\nError: ${error}\n\nWrite a short, user-friendly explanation of what happened and what could be done next.`

  try {
    const explanation = await completer(systemPrompt, userMsg)
    if (explanation && explanation.trim().length > 20) return explanation.trim()
  } catch {}

  // Fallback template
  return `I wasn't able to complete the task **"${subtaskLabel}"** after multiple attempts.\n\nThe worker ran into an issue: ${error.slice(0, 200)}${error.length > 200 ? '…' : ''}\n\nYou may want to check your configuration or try rephrasing the request.`
}

// Patterns that indicate the worker echoed the brain's internal subtask prompt
// rather than actually executing the task.
const LEAKED_PROMPT_PATTERNS = [
  /\bplanned subtask for the worker\b/i,
  /\bplease proceed with this subtask\b/i,
  /\bonce the results are returned,?\s+i will\b/i,
  /\bi will review them and provide the final response\b/i,
  /\bprovide the final response to the user\b/i,
]

function looksLikeLeakedPrompt(content: string): boolean {
  const head = content.slice(0, 600)
  return LEAKED_PROMPT_PATTERNS.some(re => re.test(head))
}

const MAX_WORKER_RETRIES = 2

export async function run<T extends { content: string; toolsUsed: string[]; iterations: number }>(
  userPrompt: string,
  completer: Completer,
  execute: (prompt: string, opts?: { maxIterations?: number }) => Promise<T>,
  onBrainLog: (event: CodeLogEvent) => void,
  userMaxIterations = 50,
  conversationContext?: string,
  configuredMcpServers?: string[]
): Promise<T & { plan: { subtasks: string[]; reasoning: string } }> {
  const skills = await discoverSkills()

  // "Thinking..." fires once here for ALL paths — fast, direct, and delegate alike
  emitBrain('Thinking...', onBrainLog)

  // ── Fast path: obviously conversational messages bypass planning entirely ────
  // Deterministic word-set check — no LLM, no JSON, no bias risk.
  if (looksConversational(userPrompt)) {
    const ctx = conversationContext ? `\nConversation history:\n${conversationContext}` : ''
    let content: string
    try {
      content = await completer(
        `You are a warm, helpful AI assistant. Reply naturally and concisely. Markdown is fine.${ctx}`,
        userPrompt
      ) ?? "You're welcome!"
    } catch {
      content = "You're welcome!"
    }
    return {
      content,
      toolsUsed: [],
      iterations: 0,
      plan: { subtasks: [], reasoning: 'Conversational response' },
    } as unknown as T & { plan: { subtasks: string[]; reasoning: string } }
  }

  const plan = await planExecution(userPrompt, skills, completer, onBrainLog, conversationContext, configuredMcpServers)

  // ── Direct response: brain answers without invoking the worker ──────────────
  if (plan.mode === 'direct') {
    let content = plan.directResponse ?? ''

    // If the model forgot to include the response, generate it now
    if (!content.trim()) {
      try {
        const ctx = conversationContext ? `\nConversation history:\n${conversationContext}` : ''
        content = await completer(
          `You are a warm, helpful AI assistant. Answer the user's message naturally and concisely. Markdown is fine.${ctx}`,
          userPrompt
        ) ?? "Got it!"
      } catch {
        content = "Got it!"
      }
    }

    return {
      content,
      toolsUsed: [],
      iterations: 0,
      plan: { subtasks: [], reasoning: plan.reasoning },
    } as unknown as T & { plan: { subtasks: string[]; reasoning: string } }
  }

  // ── Delegate path ──────────────────────────────────────────────────────────
  // Always announce the plan — even when planExecution() fell back to the default
  // single-task plan (explanation = "On it...") so the user sees something.
  emitBrain(plan.explanation, onBrainLog)

  // Emit MCP recommendations if the brain spotted useful servers the user hasn't configured yet
  if (plan.mcpRecommendations && plan.mcpRecommendations.length > 0) {
    emitBrain('💡 You could get better results by adding these MCP servers:', onBrainLog)
    for (const rec of plan.mcpRecommendations) {
      emitBrain(`  • **${rec.name}** — ${rec.reason}`, onBrainLog)
    }
    emitBrain('Browse https://mcpservers.org to find them, then add via Settings (⚙️) → MCPs.', onBrainLog)
  }

  const N = plan.subtasks.length
  if (N > 1) {
    const labels = plan.subtasks.map((s, i) => `${i + 1}. ${s.label}`).join('  ·  ')
    emitBrain(`My plan: ${labels}`, onBrainLog)
  }

  const workerResults: Array<T & { label: string }> = []

  for (const subtask of plan.subtasks) {
    // Announce every subtask start (not just multi-subtask plans)
    emitBrain(`Working on step ${subtask.id}: ${subtask.label}...`, onBrainLog)

    const iterLimit = subtaskMaxIterations(subtask.complexity, userMaxIterations)

    let workerResult: T | null = null
    let lastError = ''

    for (let attempt = 1; attempt <= MAX_WORKER_RETRIES; attempt++) {
      try {
        const prompt = attempt === 1
          ? subtask.prompt
          : await reformulateForRetry(subtask.prompt, lastError, attempt, completer, onBrainLog)

        // Heartbeat: let the user know we're still alive on long-running tasks
        const execStart = Date.now()
        const heartbeat = setInterval(() => {
          const secs = Math.round((Date.now() - execStart) / 1000)
          emitBrain(`Still at it (${secs}s)…`, onBrainLog)
        }, 25_000)

        try {
          workerResult = await execute(prompt, { maxIterations: iterLimit })
        } finally {
          clearInterval(heartbeat)
        }

        break  // success
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < MAX_WORKER_RETRIES) {
          emitBrain('Hit a snag — let me try a different approach...', onBrainLog)
        } else {
          // All retries exhausted — generate a friendly explanation instead of throwing
          const explanation = await generateFailureExplanation(
            subtask.label, subtask.prompt, lastError, completer, onBrainLog
          )
          workerResult = { content: explanation, toolsUsed: [], iterations: 0 } as unknown as T
        }
      }
    }

    // For multi-subtask: emit a brief preview of what each step produced
    if (N > 1) {
      const summary = extractSummary(workerResult!.content)
      if (summary) emitBrain(`Step ${subtask.id} done: ${summary}`, onBrainLog)
    }

    workerResults.push({ ...workerResult!, label: subtask.label })
  }

  let finalContent: string
  if (N === 1) {
    finalContent = workerResults[0].content
  } else {
    finalContent = await synthesize(
      userPrompt,
      workerResults.map(r => ({ label: r.label, content: r.content })),
      completer,
      onBrainLog
    )
  }

  // ── Leak guard: if the worker echoed the internal subtask prompt instead of
  // executing it, recover by answering directly so the user never sees scaffolding ──
  if (looksLikeLeakedPrompt(finalContent)) {
    emitBrain('The worker couldn\'t complete this one — let me answer directly...', onBrainLog)
    const ctx = conversationContext ? `\nConversation history:\n${conversationContext}` : ''
    try {
      finalContent = await completer(
        `You are a helpful AI assistant. The AI agent encountered a technical issue and could not complete the task using tools. Answer the user's question directly from your knowledge. Be honest if the answer would benefit from live data that you can't access right now. Markdown is fine.${ctx}`,
        userPrompt
      ) ?? finalContent
    } catch {
      // keep whatever we had — it gets returned rather than crashing the turn
    }
  }

  // Validate the result and optionally run a follow-up worker
  const validation = await validate(userPrompt, finalContent, completer, onBrainLog)

  if (!validation.satisfied && validation.followUp) {
    emitBrain('Almost there — one more thing to tackle...', onBrainLog)

    const followUpPrompt = `The following was not fully addressed in your previous response:

${validation.followUp}

Original request:
${userPrompt}

Previous work summary:
${finalContent.slice(0, 800)}

Please address the missing parts specifically.`

    let followUpResult: T | null = null
    let followUpLastError = ''

    for (let attempt = 1; attempt <= MAX_WORKER_RETRIES; attempt++) {
      try {
        const prompt = attempt === 1
          ? followUpPrompt
          : await reformulateForRetry(followUpPrompt, followUpLastError, attempt, completer, onBrainLog)
        followUpResult = await execute(prompt, { maxIterations: userMaxIterations })
        break
      } catch (err) {
        followUpLastError = err instanceof Error ? err.message : String(err)
        if (attempt < MAX_WORKER_RETRIES) {
          emitBrain('The follow-up hit an issue — trying once more...', onBrainLog)
        } else {
          const explanation = await generateFailureExplanation(
            'follow-up', followUpPrompt, followUpLastError, completer, onBrainLog
          )
          followUpResult = { content: explanation, toolsUsed: [], iterations: 0 } as unknown as T
        }
      }
    }

    const followUpSummary = extractSummary(followUpResult!.content)
    if (followUpSummary) emitBrain(`That covers it: ${followUpSummary}`, onBrainLog)

    // Merge the follow-up into the final content
    finalContent = await synthesize(
      userPrompt,
      [
        { label: 'Initial work', content: finalContent },
        { label: 'Follow-up', content: followUpResult!.content },
      ],
      completer,
      onBrainLog
    )

    // Add follow-up tools/iterations to the aggregate
    workerResults.push({ ...followUpResult!, label: 'follow-up' })
  } else if (validation.satisfied) {
    emitBrain('All done — here\'s the result:', onBrainLog)
  }

  // Aggregate tool usage and iteration counts across all workers
  const allTools = workerResults.flatMap(r => r.toolsUsed ?? [])
  const uniqueTools = [...new Set(allTools)]
  const totalIterations = workerResults.reduce((sum, r) => sum + (r.iterations ?? 0), 0)

  return {
    ...workerResults[workerResults.length - 1],
    content: finalContent,
    toolsUsed: uniqueTools,
    iterations: totalIterations,
    plan: {
      subtasks: plan.subtasks.map(s => s.label),
      reasoning: plan.reasoning,
    },
  }
}
