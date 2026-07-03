import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'

const router = Router()

router.get('/', (_req, res) => {
  const convsDir = path.join(os.homedir(), '.jiva', 'conversations')
  try {
    if (!fs.existsSync(convsDir)) return res.json([])
    const files = fs.readdirSync(convsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(convsDir, f)
        const stat = fs.statSync(filePath)
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          let summary: string = raw.metadata?.title ?? raw.summary ?? raw.title ?? ''
          if (!summary && Array.isArray(raw.messages)) {
            const firstUser = raw.messages.find(
              (m: { role?: string }) => m.role === 'user'
            )
            if (firstUser?.content) {
              const text = typeof firstUser.content === 'string'
                ? firstUser.content
                : Array.isArray(firstUser.content)
                  ? firstUser.content.filter((p: { type: string }) => p.type === 'text').map((p: { text?: string }) => p.text ?? '').join('')
                  : ''
              summary = text.slice(0, 60).replace(/\n/g, ' ')
              if (text.length > 60) summary += '...'
            }
          }
          return {
            id: f.replace('.json', ''),
            summary: summary || 'Untitled',
            messageCount: raw.messages?.length ?? 0,
            lastModified: stat.mtimeMs,
            type: (raw.metadata?.type ?? 'chat') as 'chat' | 'code',
          }
        } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b!.lastModified - a!.lastModified)
    return res.json(files)
  } catch {
    return res.json([])
  }
})

router.get('/:id', (req, res) => {
  const filePath = path.join(os.homedir(), '.jiva', 'conversations', `${req.params.id}.json`)
  try {
    if (!fs.existsSync(filePath)) return res.json(null)
    return res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
  } catch {
    return res.json(null)
  }
})

export default router
