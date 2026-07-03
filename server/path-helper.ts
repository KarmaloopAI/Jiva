import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export function augmentPath() {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL ?? '/bin/zsh'
    const shellPath = execSync(`${shell} -l -c 'echo $PATH'`, { timeout: 3000 }).toString().trim()
    if (shellPath) {
      process.env.PATH = shellPath
      return
    }
  } catch {}
  const home = os.homedir()
  const candidates = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    `${home}/.npm-global/bin`,
    '/usr/local/opt/node/bin',
  ]
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmDir)) {
      const v = fs.readdirSync(nvmDir).sort().reverse()[0]
      if (v) candidates.push(path.join(nvmDir, v, 'bin'))
    }
  } catch {}
  const current = process.env.PATH ?? ''
  const existing = new Set(current.split(':').filter(Boolean))
  const toAdd = candidates.filter(p => !existing.has(p))
  if (toAdd.length) process.env.PATH = [...toAdd, current].join(':')
}
