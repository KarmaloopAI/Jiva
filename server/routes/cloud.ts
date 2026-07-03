import { Router } from 'express'
import { cloudSignIn, cloudSignUp, cloudSignOut, initCloudSession } from '../cloud-auth'
import { CloudRunner } from '../cloud-runner'

export function createCloudRouter(cloudRunner: CloudRunner) {
  const router = Router()

  router.post('/sign-in', async (req, res) => {
    const { email, password } = req.body as { email: string; password: string }
    try {
      const user = await cloudSignIn(email, password)
      res.json({ userId: user.userId, email: user.email })
    } catch (err) {
      res.json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/sign-up', async (req, res) => {
    const { email, password } = req.body as { email: string; password: string }
    try {
      const user = await cloudSignUp(email, password)
      res.json({ userId: user.userId, email: user.email })
    } catch (err) {
      res.json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/sign-out', (_req, res) => {
    cloudRunner.deactivate()
    res.json({})
  })

  router.post('/init', async (req, res) => {
    const { userId, sessionId } = req.body as { userId: string; sessionId: string }
    cloudRunner.startInit()
    try {
      await initCloudSession(userId, sessionId)
      cloudRunner.configure(userId, sessionId)
      res.json({ success: true })
    } catch (err) {
      cloudRunner.deactivate()
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
