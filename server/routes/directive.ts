import { Router } from 'express'
import { readConfig, writeConfig } from '../config-manager'
import { writeDirective } from '../directive-manager'

const router = Router()

router.get('/', (_req, res) => {
  const config = readConfig()
  res.json((config as unknown as Record<string, unknown>)?.userDirective as string ?? '')
})

router.post('/', (req, res) => {
  const { content } = req.body as { content: string }
  const config = readConfig() ?? { models: { reasoning: null } }
  writeConfig({ ...config, userDirective: content } as Parameters<typeof writeConfig>[0])
  writeDirective(content || undefined)
  res.json({ success: true })
})

export default router
