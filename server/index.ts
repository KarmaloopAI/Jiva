import { augmentPath } from './path-helper'
augmentPath()

import express from 'express'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { initWebSocketServer } from './ws'
import { JivaRunner } from './jiva-runner'
import { CodeRunner } from './code-runner'
import { CloudRunner } from './cloud-runner'

import setupRouter from './routes/setup'
import configRouter from './routes/config'
import conversationsRouter from './routes/conversations'
import gitRouter from './routes/git'
import directiveRouter from './routes/directive'
import workspaceRouter from './routes/workspace'
import { createJivaRouter } from './routes/jiva'
import { createPersonasRouter } from './routes/personas'
import { createMcpRouter } from './routes/mcp'
import { createCodeRouter } from './routes/code'
import { createFilesRouter } from './routes/files'
import { createCloudRouter } from './routes/cloud'

const PORT = parseInt(process.env.JIVAM_PORT ?? '7842', 10)
const IS_DEV = process.env.NODE_ENV === 'development'

const __dirname_cjs = __dirname

const app = express()
app.use(express.json({ limit: '50mb' }))

// Initialise runners
const jivaRunner = new JivaRunner()
const codeRunner = new CodeRunner()
const cloudRunner = new CloudRunner()

// API routes
app.use('/api/setup', setupRouter)
app.use('/api/config', configRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/git', gitRouter)
app.use('/api/directive', directiveRouter)
app.use('/api/workspace', workspaceRouter)
app.use('/api/jiva', createJivaRouter(jivaRunner, cloudRunner))
app.use('/api/personas', createPersonasRouter(jivaRunner))
app.use('/api/mcp', createMcpRouter(jivaRunner))
app.use('/api/code', createCodeRouter(codeRunner))
app.use('/api/files', createFilesRouter(jivaRunner))
app.use('/api/cloud', createCloudRouter(cloudRunner))

// Platform + version endpoints for the frontend shim
app.get('/api/platform', (_req, res) => res.json(process.platform))
app.get('/api/version', (_req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname_cjs, '..', 'package.json'), 'utf-8')) as { version: string }
    res.json(pkg.version)
  } catch { res.json('0.0.0') }
})

// Serve built frontend in production
if (!IS_DEV) {
  const distDir = path.join(__dirname_cjs, '..', 'dist')
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir))
    app.get(/(.*)/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }
}

const server = http.createServer(app)
initWebSocketServer(server)

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`
  console.log(`Jivam server running at ${url}`)

  if (!IS_DEV) {
    // Open browser (dynamic import handles ESM-only 'open' package)
    try {
      const { default: open } = await import('open')
      await open(url)
    } catch (err) {
      console.error('Could not open browser automatically:', err)
      console.log(`Open manually: ${url}`)
    }
  }
})

// Graceful shutdown
async function shutdown() {
  await jivaRunner.cleanup()
  await codeRunner.cleanup()
  server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
