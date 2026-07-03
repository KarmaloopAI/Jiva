import { Router } from 'express'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const router = Router()

router.get('/is-repo', (req, res) => {
  const dir = req.query.dir as string
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 3000 })
    res.json(true)
  } catch { res.json(false) }
})

router.get('/status', (req, res) => {
  const dir = req.query.dir as string
  try {
    const output = execFileSync('git', ['status', '--porcelain'], { cwd: dir, timeout: 5000 }).toString()
    res.json(output.split('\n').filter(Boolean).map(line => ({ status: line.slice(0, 2).trim(), file: line.slice(3).trim() })))
  } catch { res.json([]) }
})

router.get('/diff-file', (req, res) => {
  const { dir, file, status } = req.query as { dir: string; file: string; status?: string }
  try {
    if (status === '??') {
      const fullPath = path.join(dir, file)
      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        if (lines[lines.length - 1] === '') lines.pop()
        return res.json(`--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`)
      } catch { return res.json(null) }
    }
    if (status === 'A') {
      try {
        const diff = execFileSync('git', ['diff', '--cached', '--', file], { cwd: dir, timeout: 5000 }).toString()
        if (diff.trim()) return res.json(diff)
      } catch {}
    }
    try {
      const diff = execFileSync('git', ['diff', 'HEAD', '--', file], { cwd: dir, timeout: 5000 }).toString()
      if (diff.trim()) return res.json(diff)
    } catch {}
    try {
      const diff = execFileSync('git', ['diff', '--cached', '--', file], { cwd: dir, timeout: 5000 }).toString()
      if (diff.trim()) return res.json(diff)
    } catch {}
    try {
      const diff = execFileSync('git', ['diff', '--', file], { cwd: dir, timeout: 5000 }).toString()
      if (diff.trim()) return res.json(diff)
    } catch {}
    return res.json(null)
  } catch { return res.json(null) }
})

router.post('/init-repo', (req, res) => {
  const { dir } = req.body as { dir: string }
  try {
    execFileSync('git', ['init'], { cwd: dir, timeout: 10000 })
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
})

router.get('/branch-info', (req, res) => {
  const dir = req.query.dir as string
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 3000 }).toString().trim()
    let ahead = 0, behind = 0
    try {
      const tracking = execFileSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: dir, timeout: 3000 }).toString().trim()
      if (tracking) {
        const ab = execFileSync('git', ['rev-list', '--left-right', '--count', `${tracking}...HEAD`], { cwd: dir, timeout: 3000 }).toString().trim().split('\t')
        behind = parseInt(ab[0]) || 0
        ahead = parseInt(ab[1]) || 0
      }
    } catch {}
    res.json({ branch, ahead, behind })
  } catch { res.json(null) }
})

export default router
