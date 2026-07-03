import { Router } from 'express'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readConfig, writeConfig } from '../config-manager'

const router = Router()

router.get('/dir', (_req, res) => {
  const config = readConfig()
  res.json(config?.workspaceDir ?? os.homedir())
})

router.post('/dir', (req, res) => {
  const { dir } = req.body as { dir: string }
  try {
    const config = readConfig() ?? { models: { reasoning: null } }
    writeConfig({ ...config, workspaceDir: dir })
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
})

// Opens a native OS folder picker dialog from the server process
router.post('/pick-dir', async (_req, res) => {
  try {
    let picked: string | null = null
    if (process.platform === 'darwin') {
      const result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select Workspace Directory")'`,
        { timeout: 60_000 }
      ).toString().trim()
      if (result) picked = result.replace(/\/$/, '')
    } else if (process.platform === 'win32') {
      const ps = [
        '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$f.Description = "Select Workspace Directory"',
        'if ($f.ShowDialog() -eq "OK") { $f.SelectedPath }',
      ].join('; ')
      const result = execSync(`powershell -Command "${ps}"`, { timeout: 60_000 }).toString().trim()
      if (result) picked = result
    } else {
      // Linux: try zenity, then kdialog
      try {
        const result = execSync('zenity --file-selection --directory --title="Select Workspace Directory"', { timeout: 60_000 }).toString().trim()
        if (result) picked = result
      } catch {
        try {
          const result = execSync('kdialog --getexistingdirectory "Select Workspace Directory"', { timeout: 60_000 }).toString().trim()
          if (result) picked = result
        } catch {}
      }
    }
    res.json(picked)
  } catch {
    res.json(null)
  }
})

router.get('/files', (req, res) => {
  const dirPath = req.query.path as string
  try {
    const homeDir = os.homedir()
    const resolvedDir = path.resolve(dirPath)
    const resolvedHome = path.resolve(homeDir)
    if (!resolvedDir.startsWith(resolvedHome) && resolvedDir !== resolvedHome) return res.json([])
    if (!fs.existsSync(resolvedDir)) return res.json([])
    const entries = fs.readdirSync(resolvedDir, { withFileTypes: true })
    return res.json(
      entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => {
          const fullPath = path.join(resolvedDir, e.name)
          const stat = fs.statSync(fullPath)
          return { name: e.name, path: fullPath, isDirectory: e.isDirectory(), size: stat.size, modified: stat.mtimeMs }
        })
    )
  } catch { return res.json([]) }
})

router.get('/file', (req, res) => {
  const filePath = req.query.path as string
  try {
    const homeDir = os.homedir()
    const resolvedFile = path.resolve(filePath)
    if (!resolvedFile.startsWith(path.resolve(homeDir))) return res.json(null)
    if (!fs.existsSync(resolvedFile)) return res.json(null)
    const stat = fs.statSync(resolvedFile)
    if (stat.size > 512 * 1024) return res.json('[File too large to preview — open in an external editor]')
    return res.json(fs.readFileSync(resolvedFile, 'utf-8'))
  } catch { return res.json(null) }
})

router.post('/open-external', (req, res) => {
  const { filePath } = req.body as { filePath: string }
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
    execSync(`${cmd} "${filePath}"`, { timeout: 5000 })
  } catch {}
  res.json({})
})

export default router
