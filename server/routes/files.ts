import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { convertFile } from '../file-converter'
import { JivaRunner } from '../jiva-runner'

export function createFilesRouter(jivaRunner: JivaRunner) {
  const router = Router()

  // Convert a file already on disk (used for paths returned by the workspace picker)
  router.post('/convert', (req, res) => {
    const { filePath } = req.body as { filePath: string }
    const homeDir = os.homedir()
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(homeDir))) {
      return res.json({ name: path.basename(filePath), category: 'unsupported', markdown: '', error: 'Access denied' })
    }
    const result = convertFile(filePath)
    if (result.category === 'image' && !result.error) {
      try {
        const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library', 'Preferences', 'jiva-nodejs', 'config.json'), 'utf-8')) } catch { return null } })()
        const workspaceDir = (config as Record<string, unknown>)?.workspaceDir as string ?? homeDir
        const uploadsDir = path.join(workspaceDir, '.jiva', 'uploads')
        fs.mkdirSync(uploadsDir, { recursive: true })
        const destPath = path.join(uploadsDir, path.basename(filePath))
        fs.copyFileSync(filePath, destPath)
        result.markdown = destPath
      } catch (err) {
        result.error = `Failed to save image: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    return res.json(result)
  })

  // Upload files from browser as base64, convert on server
  router.post('/upload-and-convert', (req, res) => {
    const { files } = req.body as {
      files: Array<{ name: string; data: string; mimeType: string }>
    }
    const homeDir = os.homedir()
    const tmpDir = path.join(os.tmpdir(), 'jivam-uploads')
    fs.mkdirSync(tmpDir, { recursive: true })

    const results = files.map(f => {
      const tmpPath = path.join(tmpDir, f.name)
      try {
        fs.writeFileSync(tmpPath, Buffer.from(f.data, 'base64'))
        const result = convertFile(tmpPath)
        if (result.category === 'image' && !result.error) {
          try {
            const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(homeDir, 'Library', 'Preferences', 'jiva-nodejs', 'config.json'), 'utf-8')) } catch { return null } })()
            const workspaceDir = (config as Record<string, unknown>)?.workspaceDir as string ?? homeDir
            const uploadsDir = path.join(workspaceDir, '.jiva', 'uploads')
            fs.mkdirSync(uploadsDir, { recursive: true })
            const destPath = path.join(uploadsDir, f.name)
            fs.copyFileSync(tmpPath, destPath)
            result.markdown = destPath
          } catch {}
        }
        return result
      } catch (err) {
        return { name: f.name, category: 'unsupported' as const, markdown: '', error: String(err) }
      } finally {
        try { fs.unlinkSync(tmpPath) } catch {}
      }
    })

    res.json(results)
  })

  router.post('/describe-image', async (req, res) => {
    const { dataUri } = req.body as { dataUri: string }
    try {
      const description = await jivaRunner.describeImage(dataUri)
      res.json({ success: true, description })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
