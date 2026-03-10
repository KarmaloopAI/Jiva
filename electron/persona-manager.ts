import fs from 'fs'
import path from 'path'
import os from 'os'
import { getJivaConfigPath } from './config-manager'

const PERSONAS_DIR = path.join(os.homedir(), '.jiva', 'personas')

export interface PersonaInfo {
  name: string
  displayName: string
  description: string
  tags: string[]
  icon: string
  isBuiltIn: boolean
  dirPath: string
}

/**
 * Returns a lucide-react icon name string for this persona.
 * The renderer resolves the name to a component via a lookup map in PersonaCard.tsx.
 */
function getPersonaIcon(name: string, tags: string[]): string {
  if (name === 'chat' || tags.includes('chat')) return 'MessageSquare'
  if (name === 'research' || tags.includes('research')) return 'Search'
  if (name === 'developer' || name === 'code-reviewer' || tags.includes('code')) return 'Code2'
  if (name === 'engineering-manager' || tags.includes('management')) return 'Layers'
  if (name === 'tester' || tags.includes('testing')) return 'FlaskConical'
  if (name === 'data-analyst' || tags.includes('data')) return 'BarChart3'
  return 'Bot'
}

export function listPersonas(): PersonaInfo[] {
  const personas: PersonaInfo[] = []

  if (!fs.existsSync(PERSONAS_DIR)) {
    return personas
  }

  try {
    const entries = fs.readdirSync(PERSONAS_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'skills') continue // skip skills subdirectory

      const personaDir = path.join(PERSONAS_DIR, entry.name)
      const pluginJsonPath = path.join(personaDir, '.jiva-plugin', 'plugin.json')

      let manifest: { name?: string; description?: string; tags?: string[] } = {}

      if (fs.existsSync(pluginJsonPath)) {
        try {
          const raw = fs.readFileSync(pluginJsonPath, 'utf-8')
          manifest = JSON.parse(raw)
        } catch {
          // Use defaults
        }
      }

      const name = entry.name
      const tags = manifest.tags ?? []
      const builtInNames = ['chat', 'research']

      personas.push({
        name,
        displayName: (manifest.name ?? name).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: manifest.description ?? `${name} persona`,
        tags,
        icon: getPersonaIcon(name, tags),
        isBuiltIn: builtInNames.includes(name),
        dirPath: personaDir,
      })
    }
  } catch (err) {
    console.error('[PersonaManager] Failed to list personas:', err)
  }

  // Sort: built-ins first, then alphabetical
  return personas.sort((a, b) => {
    if (a.isBuiltIn && !b.isBuiltIn) return -1
    if (!a.isBuiltIn && b.isBuiltIn) return 1
    return a.name.localeCompare(b.name)
  })
}

export function activatePersona(name: string): boolean {
  const { execSync } = require('child_process') as typeof import('child_process')
  try {
    execSync(`jiva persona activate ${name}`, { timeout: 10000, stdio: 'ignore' })
    return true
  } catch {
    // Try writing to active persona file directly
    const activeFile = path.join(os.homedir(), '.jiva', 'active-persona.txt')
    try {
      fs.writeFileSync(activeFile, name, 'utf-8')
      return true
    } catch {
      return false
    }
  }
}

export function getActivePersona(): string | null {
  try {
    const jivaConfigPath = getJivaConfigPath()
    if (fs.existsSync(jivaConfigPath)) {
      const config = JSON.parse(fs.readFileSync(jivaConfigPath, 'utf-8'))
      if (config.activePersona) return config.activePersona
    }
    const activeFile = path.join(os.homedir(), '.jiva', 'active-persona.txt')
    if (fs.existsSync(activeFile)) {
      return fs.readFileSync(activeFile, 'utf-8').trim()
    }
  } catch {}
  return null
}
