import { Router } from 'express'
import { JivaRunner } from '../jiva-runner'
import { CloudRunner } from '../cloud-runner'
import { broadcast } from '../ws'

export function createJivaRouter(jivaRunner: JivaRunner, cloudRunner: CloudRunner) {
  const router = Router()

  router.post('/start', async (_req, res) => {
    try {
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }
      res.json({ success: true, status: jivaRunner.getStatus() })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/stop', async (_req, res) => {
    try {
      await jivaRunner.cleanup()
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/restart', async (_req, res) => {
    try {
      await jivaRunner.cleanup()
      await jivaRunner.initialize()
      res.json({ success: true, status: jivaRunner.getStatus() })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.get('/status', (_req, res) => {
    const status = jivaRunner.getStatus()
    res.json({ status: status === 'ready' || status === 'busy' ? 'running' : status, port: 0 })
  })

  router.post('/send-message', async (req, res) => {
    const { prompt, opts, isCloud } = req.body as {
      prompt: string
      opts?: { deepRun?: boolean }
      isCloud?: boolean
    }
    try {
      if (isCloud) {
        if (!cloudRunner.isActive()) await cloudRunner.waitUntilReady(30_000)
        const result = await cloudRunner.chat(prompt, (phase) => {
          broadcast('jiva:phase-update', { phase })
        }, opts, (logEvent) => {
          broadcast('jiva:jiva-log', { event: logEvent })
        })
        return res.json({ success: true, result, conversationId: result.conversationId })
      }

      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }
      const result = await jivaRunner.chat(prompt, (phase) => {
        broadcast('jiva:phase-update', { phase })
      }, opts, (logEvent) => {
        broadcast('jiva:jiva-log', { event: logEvent })
      })
      return res.json({ success: true, result, conversationId: result.conversationId })
    } catch (err) {
      return res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/stop-message', (_req, res) => {
    jivaRunner.stop()
    res.json({ success: true })
  })

  router.post('/reset-conversation', (_req, res) => {
    jivaRunner.resetConversation()
    res.json({ success: true })
  })

  router.post('/load-conversation', async (req, res) => {
    const { id } = req.body as { id: string }
    try {
      if (jivaRunner.getStatus() === 'stopped' || jivaRunner.getStatus() === 'error') {
        await jivaRunner.initialize()
      }
      await jivaRunner.loadConversation(id)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/switch-model', async (req, res) => {
    const { model } = req.body as { model: string }
    try {
      await jivaRunner.switchModel(model)
      res.json({ success: true })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // Wire up status-changed events to WebSocket broadcasts
  jivaRunner.on('status-changed', (status: string, data: unknown) => {
    const serverStatus = status === 'ready' || status === 'busy' ? 'running' : status
    broadcast('jiva:server:status-changed', { status: serverStatus, data })
  })

  return router
}
