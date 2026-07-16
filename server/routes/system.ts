import { Router } from 'express'
import { broadcast } from '../ws'
import { getStatus, checkForUpdate, applyUpdate, getCurrentVersion } from '../updater'

const router = Router()

router.get('/update-status', (_req, res) => {
  res.json({ ...getStatus(), currentVersion: getCurrentVersion() })
})

router.post('/update-check', async (_req, res) => {
  const status = await checkForUpdate()
  res.json({ ...status, currentVersion: getCurrentVersion() })
})

router.post('/update-apply', async (_req, res) => {
  const result = await applyUpdate()
  res.json(result)
})

// `jivam --install` runs as a separate one-off CLI process from the
// persistent background server, so it can't call ws.ts's broadcast()
// directly — it hits this endpoint instead once it detects the Safari/Edge
// app-install bundle, and the server (which owns the WebSocket connections)
// relays the news to any open tab showing AddToDockGuide.
router.post('/pwa-installed', (_req, res) => {
  broadcast('jivam:pwa-installed', {})
  res.json({ success: true })
})

export default router
