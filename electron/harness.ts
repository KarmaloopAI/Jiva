import fs from 'fs'
import os from 'os'
import path from 'path'

export interface Skill {
  name: string
  description: string
  dir: string
}

// Provided by the runner so harness can call the model without knowing jiva-core internals.
// Returns the model's text response, or null on failure.
export type Completer = (systemPrompt: string, userPrompt: string) => Promise<string | null>

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

export async function structurePrompt(
  userPrompt: string,
  skills: Skill[],
  completer: Completer
): Promise<string> {
  const systemPrompt = 'You are a task coordinator. Structure the following request for a coding agent. Respond only with valid JSON, no markdown fences.'

  const skillList = skills.length > 0
    ? skills.map(s => `- ${s.name} (${s.dir}): ${s.description}`).join('\n')
    : '(none available)'

  const userMsg = `Task:\n${userPrompt}\n\nAvailable skills:\n${skillList}\n\nRespond with JSON:\n{"structured_prompt":"clear restatement of the task","relevant_skills":["skill_name_if_applicable"],"notes":"optional clarifications"}`

  let structured = userPrompt
  const relevantSkills: string[] = []

  try {
    const raw = await completer(systemPrompt, userMsg)
    if (raw) {
      const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '')
      const parsed = JSON.parse(cleaned) as {
        structured_prompt?: string
        relevant_skills?: string[]
        notes?: string
      }
      if (typeof parsed.structured_prompt === 'string' && parsed.structured_prompt) {
        structured = parsed.structured_prompt
      }
      if (Array.isArray(parsed.relevant_skills)) {
        relevantSkills.push(...parsed.relevant_skills.filter((s): s is string => typeof s === 'string'))
      }
    }
  } catch {
    // fall back to original prompt
  }

  if (relevantSkills.length > 0) {
    const matched = relevantSkills
      .map(name => skills.find(s => s.name === name))
      .filter((s): s is Skill => s !== undefined)

    if (matched.length > 0) {
      const skillLines = matched
        .map(s => `- ${s.name}: ${s.dir}\n  Read SKILL.md in that directory for full usage instructions.`)
        .join('\n')
      structured = `${structured}\n\nRelevant skill(s) available:\n${skillLines}`
    }
  }

  return structured
}

export async function evaluate(
  originalPrompt: string,
  agentResponse: string,
  completer: Completer
): Promise<{ satisfied: boolean; refinement: string }> {
  const systemPrompt = 'You are evaluating whether an AI agent fully completed a task. Respond only with valid JSON, no markdown fences.'
  const userMsg = `Original request:\n${originalPrompt}\n\nAgent response summary:\n${agentResponse.slice(0, 1500)}\n\nRespond with JSON:\n{"satisfied":true,"refinement":"what to try differently, empty string if satisfied"}`

  try {
    const raw = await completer(systemPrompt, userMsg)
    if (raw) {
      const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '')
      const parsed = JSON.parse(cleaned) as { satisfied?: boolean; refinement?: string }
      return {
        satisfied: parsed.satisfied === true,
        refinement: typeof parsed.refinement === 'string' ? parsed.refinement : '',
      }
    }
  } catch {
    // fall through to satisfied=true
  }

  return { satisfied: true, refinement: '' }
}

const MAX_ATTEMPTS = 3

export async function run<T extends { content: string }>(
  userPrompt: string,
  completer: Completer,
  execute: (prompt: string) => Promise<T>
): Promise<T> {
  const skills = await discoverSkills()
  const enrichedPrompt = await structurePrompt(userPrompt, skills, completer)

  let currentPrompt = enrichedPrompt
  let lastResult: T | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await execute(currentPrompt)

    if (attempt === MAX_ATTEMPTS) break

    const evaluation = await evaluate(userPrompt, lastResult.content, completer)
    if (evaluation.satisfied) break

    const prevSummary = lastResult.content.slice(0, 500)
    currentPrompt = `${enrichedPrompt}\n\n[Previous attempt summary: ${prevSummary}]\n\n[Try a different approach: ${evaluation.refinement}]`
  }

  return lastResult!
}
