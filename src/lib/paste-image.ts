import { arrayBufferToBase64 } from './electron-shim'
import type { AttachedFile } from '../types/chat'
import type { ProcessedAttachment } from '../store/jiva.store'

// Shared by chat mode (ChatInput.tsx) and code mode (CodeChatView.tsx) —
// both wire this into an onPaste handler on their textarea. Mirrors the
// existing image-enrichment logic in ChatInput.tsx's handleAttach (path
// reference, optionally captioned via describeImage when multimodal is
// configured) so a pasted image behaves identically to a picked one.
export async function extractImageFromClipboard(
  clipboardData: DataTransfer,
  isMultimodalEnabled: boolean
): Promise<{ file: AttachedFile; processed: ProcessedAttachment } | null> {
  const imageItem = Array.from(clipboardData.items).find((item) => item.type.startsWith('image/'))
  if (!imageItem) return null

  const blob = imageItem.getAsFile()
  if (!blob) return null

  const buf = await blob.arrayBuffer()
  const data = arrayBufferToBase64(buf)
  const ext = imageItem.type.split('/')[1] || 'png'
  const name = blob.name || `pasted-image-${Date.now()}.${ext}`

  let results: Array<{ name: string; category: string; markdown: string; mimeType?: string; dataUri?: string; error?: string }>
  try {
    results = await window.electron.files.uploadAndConvert([{ name, data, mimeType: imageItem.type }])
  } catch {
    return null
  }

  const converted = results[0]
  if (!converted || converted.error || converted.category !== 'image') return null

  let markdown = `[Image file: ${converted.markdown}]`
  if (isMultimodalEnabled && converted.dataUri) {
    try {
      const result = await window.electron.files.describeImage(converted.dataUri)
      if (result.success && result.description) {
        markdown = `[Image file: ${converted.markdown}]\n${result.description}`
      }
    } catch { /* path-only fallback already set */ }
  }

  return {
    file: { name: converted.name, category: 'image' },
    processed: { name: converted.name, markdown },
  }
}
