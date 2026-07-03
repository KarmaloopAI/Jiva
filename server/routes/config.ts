import { Router } from 'express'
import { readConfig, writeConfig } from '../config-manager'

const router = Router()

router.get('/', (_req, res) => {
  res.json(readConfig())
})

router.post('/', (req, res) => {
  const ok = writeConfig(req.body)
  res.json(ok)
})

export default router
