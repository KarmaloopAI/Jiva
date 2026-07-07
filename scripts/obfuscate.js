#!/usr/bin/env node
'use strict'

// Obfuscates the production build output in place so dist/ and dist-server/
// aren't trivially readable/decompiled — Jivam is proprietary.
//
// Runs as the last step of `npm run build`. To get a readable debug build,
// run `npm run build:unobfuscated` instead (skips this script).

const fs = require('fs')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  identifierNamesGenerator: 'hexadecimal',
  // Renaming globals/object keys risks breaking Node built-in interop
  // (require, module.exports, __dirname) and React/DOM property access —
  // keep those off, everything else is fair game.
  renameGlobals: false,
  transformObjectKeys: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  rotateStringArray: true,
  shuffleStringArray: true,
  unicodeEscapeSequence: false,
}

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8')
  const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS)
  fs.writeFileSync(filePath, result.getObfuscatedCode())
  console.log(`Obfuscated: ${path.relative(process.cwd(), filePath)}`)
}

function findJsFiles(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...findJsFiles(fullPath))
    } else if (entry.name.endsWith('.js')) {
      found.push(fullPath)
    }
  }
  return found
}

const root = path.join(__dirname, '..')

// Server bundle — single CJS file
const serverEntry = path.join(root, 'dist-server', 'index.js')
if (fs.existsSync(serverEntry)) {
  obfuscateFile(serverEntry)
} else {
  console.warn('dist-server/index.js not found — skipping server obfuscation')
}

// Frontend bundle — all built JS assets
const frontendAssetsDir = path.join(root, 'dist', 'assets')
if (fs.existsSync(frontendAssetsDir)) {
  for (const file of findJsFiles(frontendAssetsDir)) {
    obfuscateFile(file)
  }
} else {
  console.warn('dist/assets not found — skipping frontend obfuscation')
}

// Drop sourcemaps from the published/shipped build — they'd defeat the
// purpose of obfuscation by mapping straight back to original source.
for (const dir of [path.join(root, 'dist-server'), path.join(root, 'dist')]) {
  if (!fs.existsSync(dir)) continue
  for (const file of findJsFiles(dir).map(f => `${f}.map`)) {
    if (fs.existsSync(file)) {
      fs.rmSync(file)
      console.log(`Removed sourcemap: ${path.relative(root, file)}`)
    }
  }
}
