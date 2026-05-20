import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

export type FileCategory = 'text' | 'pdf' | 'docx' | 'image' | 'unsupported'

export interface ConvertedFile {
  name: string
  category: FileCategory
  markdown: string  // text/pdf/docx → markdown content; image → base64 data URI
  mimeType?: string // images only
  error?: string
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'rst', 'log',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'cc', 'h', 'hpp', 'cs',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg', 'xhtml',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto',
  'env', 'editorconfig', 'gitignore', 'gitattributes',
  'dockerfile', 'makefile', 'cmake', 'gradle',
  'r', 'jl', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'lua', 'pl',
  'vue', 'svelte', 'astro',
  'lock', 'mod', 'sum',
])

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  md: 'markdown', markdown: 'markdown', rst: 'rst',
  r: 'r', jl: 'julia', scala: 'scala', lua: 'lua',
  vue: 'vue', svelte: 'svelte',
}

export function getFileCategory(ext: string): FileCategory {
  const lower = ext.toLowerCase().replace(/^\./, '')
  if (TEXT_EXTENSIONS.has(lower)) return 'text'
  if (lower in IMAGE_EXTENSIONS) return 'image'
  if (lower === 'pdf') return 'pdf'
  if (lower === 'docx') return 'docx'
  return 'unsupported'
}

export function convertFile(filePath: string): ConvertedFile {
  const name = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
  const category = getFileCategory(ext)

  try {
    switch (category) {
      case 'text': return convertTextFile(filePath, name, ext)
      case 'pdf': return convertPdf(filePath, name)
      case 'docx': return convertDocx(filePath, name)
      case 'image': return convertImage(filePath, name, ext)
      default: return { name, category: 'unsupported', markdown: '', error: `File type .${ext} is not supported` }
    }
  } catch (err) {
    return {
      name,
      category,
      markdown: '',
      error: err instanceof Error ? err.message : 'Failed to read file',
    }
  }
}

function convertTextFile(filePath: string, name: string, ext: string): ConvertedFile {
  const stat = fs.statSync(filePath)
  if (stat.size > 2 * 1024 * 1024) {
    return { name, category: 'text', markdown: '', error: 'File is too large (max 2 MB for text files)' }
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  const lang = LANG_MAP[ext] ?? ext
  const markdown = `\`\`\`${lang}\n${content}\n\`\`\``
  return { name, category: 'text', markdown }
}

// ---------------------------------------------------------------------------
// PDF: extract text from PDF content streams using BT/ET markers
// ---------------------------------------------------------------------------
function convertPdf(filePath: string, name: string): ConvertedFile {
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) {
    return { name, category: 'pdf', markdown: '', error: 'PDF is too large (max 10 MB)' }
  }

  const buffer = fs.readFileSync(filePath)
  const text = extractPdfText(buffer)

  if (!text.trim()) {
    return { name, category: 'pdf', markdown: '', error: 'Could not extract text from PDF (may be a scanned/image-only PDF)' }
  }

  const markdown = `**[PDF: ${name}]**\n\n${text}`
  return { name, category: 'pdf', markdown }
}

function extractPdfText(buffer: Buffer): string {
  // Work on a latin1 string so byte values map 1:1
  const raw = buffer.toString('latin1')
  const parts: string[] = []

  // Find compressed object streams (FlateDecode) and decompress them
  const compressedStreamRe = /<<[^>]*\/Filter\s*\/FlateDecode[^>]*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m: RegExpExecArray | null
  while ((m = compressedStreamRe.exec(raw)) !== null) {
    try {
      const buf = Buffer.from(m[1], 'latin1')
      const decompressed = zlib.inflateSync(buf).toString('latin1')
      parts.push(...extractTextFromStream(decompressed))
    } catch { /* skip undecompressable streams */ }
  }

  // Also scan uncompressed text streams
  const btEtRe = /BT([\s\S]*?)ET/g
  while ((m = btEtRe.exec(raw)) !== null) {
    parts.push(...extractTextFromStream(m[1]))
  }

  // Deduplicate and join
  return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim()
}

function extractTextFromStream(stream: string): string[] {
  const results: string[] = []

  // Collect BT..ET blocks
  const btEtRe = /BT([\s\S]*?)ET/g
  let m: RegExpExecArray | null
  while ((m = btEtRe.exec(stream)) !== null) {
    const block = m[1]
    // Literal strings: (text)
    const litRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g
    let s: RegExpExecArray | null
    while ((s = litRe.exec(block)) !== null) {
      const decoded = s[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
      const clean = decoded.replace(/[^\x20-\x7E\n\r\t]/g, '').trim()
      if (clean.length > 0) results.push(clean)
    }

    // Hex strings: <4865...>
    const hexRe = /<([0-9A-Fa-f\s]+)>/g
    while ((s = hexRe.exec(block)) !== null) {
      const hex = s[1].replace(/\s/g, '')
      if (hex.length % 2 !== 0) continue
      let str = ''
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16)
        if (code >= 0x20 && code <= 0x7E) str += String.fromCharCode(code)
      }
      if (str.trim().length > 0) results.push(str.trim())
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// DOCX: parse ZIP, extract word/document.xml, strip XML tags
// ---------------------------------------------------------------------------
function convertDocx(filePath: string, name: string): ConvertedFile {
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) {
    return { name, category: 'docx', markdown: '', error: 'DOCX is too large (max 10 MB)' }
  }

  const buffer = fs.readFileSync(filePath)
  const xml = extractFromZip(buffer, 'word/document.xml')

  if (!xml) {
    return { name, category: 'docx', markdown: '', error: 'Could not extract content from DOCX file' }
  }

  const text = parseDocumentXml(xml.toString('utf-8'))

  if (!text.trim()) {
    return { name, category: 'docx', markdown: '', error: 'DOCX appears to be empty' }
  }

  const markdown = `**[DOCX: ${name}]**\n\n${text}`
  return { name, category: 'docx', markdown }
}

function extractFromZip(buffer: Buffer, targetPath: string): Buffer | null {
  let offset = 0

  while (offset < buffer.length - 30) {
    // Local file header signature: PK\x03\x04
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const uncompressedSize = buffer.readUInt32LE(offset + 22)
    const filenameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)

    const filename = buffer.slice(offset + 30, offset + 30 + filenameLen).toString('utf-8')
    const dataStart = offset + 30 + filenameLen + extraLen
    const dataEnd = dataStart + compressedSize

    if (filename === targetPath) {
      const compressed = buffer.slice(dataStart, dataEnd)
      if (compressionMethod === 0) {
        // Stored (no compression)
        return compressed
      } else if (compressionMethod === 8) {
        // Deflated — use inflateRawSync (raw deflate, no zlib header)
        try {
          return zlib.inflateRawSync(compressed)
        } catch {
          // Some DOCX use standard deflate with zlib header
          try {
            return zlib.inflateSync(compressed)
          } catch {
            return null
          }
        }
      }
      return null
    }

    // Skip to next local file header
    if (compressedSize === 0 && uncompressedSize === 0) {
      offset = dataStart
    } else {
      offset = dataEnd
    }
  }

  return null
}

function parseDocumentXml(xml: string): string {
  // Extract paragraph text, preserving paragraph breaks
  const paragraphs: string[] = []
  const paraRe = /<w:p[ >]([\s\S]*?)<\/w:p>/g
  let m: RegExpExecArray | null

  while ((m = paraRe.exec(xml)) !== null) {
    // Extract text runs within the paragraph
    const runs: string[] = []
    const runRe = /<w:t[^>]*>([^<]*)<\/w:t>/g
    let r: RegExpExecArray | null
    while ((r = runRe.exec(m[1])) !== null) {
      runs.push(r[1])
    }
    const text = runs.join('').trim()
    if (text) paragraphs.push(text)
  }

  return paragraphs.join('\n\n')
}

// ---------------------------------------------------------------------------
// Image: base64 encode for multimodal model consumption
// ---------------------------------------------------------------------------
function convertImage(filePath: string, name: string, ext: string): ConvertedFile {
  const stat = fs.statSync(filePath)
  if (stat.size > 20 * 1024 * 1024) {
    return { name, category: 'image', markdown: '', error: 'Image is too large (max 20 MB)' }
  }

  const mimeType = IMAGE_EXTENSIONS[ext.toLowerCase()] ?? 'image/png'
  // Return the original path — the IPC handler will copy it to the workspace uploads dir
  return { name, category: 'image', markdown: filePath, mimeType }
}
