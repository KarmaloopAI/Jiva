import { Router } from 'express'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getJivaConfigPath } from '../config-manager'

const router = Router()

router.get('/check', (_req, res) => {
  // Node.js
  let nodejsOk = false
  let nodejsVersion: string | undefined
  try {
    execSync('npm --version', { timeout: 3000 })
    nodejsOk = true
    try {
      nodejsVersion = execSync('node --version', { timeout: 3000 })
        .toString().trim().replace(/^v/, '')
    } catch {}
  } catch {}

  // jiva-core
  let jivaCoreOk = false
  let jivaCoreVersion: string | undefined
  if (nodejsOk) {
    const candidates: string[] = []
    try {
      const npmRoot = execSync('npm root -g', { timeout: 5000 }).toString().trim()
      candidates.push(path.join(npmRoot, 'jiva-core', 'package.json'))
    } catch {}
    candidates.push(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'jiva-core', 'package.json'))
    if (process.platform === 'win32') {
      candidates.push(path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'package.json'))
      candidates.push(path.join(process.env.LOCALAPPDATA ?? '', 'npm', 'node_modules', 'jiva-core', 'package.json'))
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf-8')) as { version?: string }
          jivaCoreVersion = pkg.version
          jivaCoreOk = true
          break
        } catch {}
      }
    }
  }

  // Config
  const configCandidates = [
    getJivaConfigPath(),
    path.join(os.homedir(), '.jiva', 'config.json'),
  ]
  let configOk = false
  let foundConfigPath = ''
  for (const candidate of configCandidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      const cfg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Record<string, unknown>
      const reasoning = ((cfg?.models as Record<string, unknown>)?.reasoning ?? {}) as Record<string, unknown>
      const apiKey = ((reasoning?.apiKey ?? cfg?.apiKey) ?? '') as string
      if (apiKey.length > 0) {
        configOk = true
        foundConfigPath = candidate
        break
      }
    } catch {}
  }

  // Version compat
  let jivaVersionMismatch = false
  let requiredJivaVersion: string | undefined
  try {
    const appPkgPath = path.join(__dirname, '..', '..', 'package.json')
    const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf-8')) as Record<string, unknown>
    requiredJivaVersion = appPkg.jivaCompatibleVersion as string | undefined
    if (requiredJivaVersion && jivaCoreVersion) {
      const [reqMaj, reqMin] = requiredJivaVersion.split('.').map(Number)
      const [instMaj, instMin] = jivaCoreVersion.split('.').map(Number)
      if (reqMaj !== instMaj || reqMin !== instMin) jivaVersionMismatch = true
    }
  } catch {}

  res.json({
    nodejs:   { ok: nodejsOk, version: nodejsVersion },
    jivaCore: { ok: jivaCoreOk, version: jivaCoreVersion },
    config:   { ok: configOk, path: foundConfigPath || configCandidates[0] },
    platform: process.platform,
    jivaVersionMismatch,
    requiredJivaVersion,
  })
})

export default router
