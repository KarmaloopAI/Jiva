import { Router } from 'express'
import { listPersonas, activatePersona, getActivePersona } from '../persona-manager'
import { JivaRunner } from '../jiva-runner'

export function createPersonasRouter(jivaRunner: JivaRunner) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listPersonas())
  })

  router.post('/activate', async (req, res) => {
    const { name } = req.body as { name: string }
    const success = activatePersona(name)
    if (success) {
      try {
        await jivaRunner.switchPersona(name)
      } catch (err) {
        console.error('[Personas] Failed to switch persona:', err)
      }
    }
    res.json({ success })
  })

  router.get('/active', (_req, res) => {
    res.json(getActivePersona())
  })

  return router
}
