import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, StopCircle, MessageSquare, Search, Code2, Layers, FlaskConical,
  BarChart3, Bot, SlidersHorizontal, Zap, Paperclip, X, FileText, Image,
  type LucideIcon,
} from 'lucide-react'

const PERSONA_ICONS: Record<string, LucideIcon> = {
  MessageSquare, Search, Code2, Layers, FlaskConical, BarChart3, Bot,
}

import { useChatStore } from '../../store/chat.store'
import { useJivaStore, type ProcessedAttachment } from '../../store/jiva.store'
import { usePersonaStore } from '../../store/persona.store'
import { useConversationStore } from '../../store/conversation.store'
import { AgentStatusRow } from '../ui/AgentStatusRow'
import { extractImageFromClipboard } from '../../lib/paste-image'
import { handleSmartKeydown } from '../../lib/smart-textarea'
import type { AttachedFile } from '../../types/chat'

export function ChatInput() {
  const [value, setValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [processedAttachments, setProcessedAttachments] = useState<ProcessedAttachment[]>([])
  const [isProcessingFiles, setIsProcessingFiles] = useState(false)
  const [isMultimodalEnabled, setIsMultimodalEnabled] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    addUserMessage,
    setThinking,
    addAgentResponse,
    addErrorMessage,
    isThinking,
  } = useChatStore()
  const { sendMessage, connectionStatus, deepRun, setDeepRun, maxIterations, setMaxIterations, switchModel, switchingModel } = useJivaStore()
  const { activePersonaName, personas } = usePersonaStore()

  const isConnected = connectionStatus === 'connected'

  // Check multimodal capability + seed the current model on mount
  useEffect(() => {
    window.electron.config.read().then((config) => {
      const cfg = config as { models?: { multimodal?: unknown; reasoning?: { defaultModel?: string; model?: string } } } | null
      setIsMultimodalEnabled(!!cfg?.models?.multimodal)
      const current = cfg?.models?.reasoning?.defaultModel ?? cfg?.models?.reasoning?.model
      if (current) setSelectedModel(current)
    }).catch(() => {})
  }, [])

  const fetchModelOptions = useCallback(() => {
    if (modelOptions.length > 0 || loadingModels) return
    setLoadingModels(true)
    window.electron.config.listModels().then((result) => {
      setModelOptions(result.success ? result.models : [])
    }).catch(() => setModelOptions([])).finally(() => setLoadingModels(false))
  }, [modelOptions.length, loadingModels])

  const handleModelChange = useCallback(async (model: string) => {
    if (!model || model === selectedModel) return
    setSelectedModel(model)
    await switchModel(model)
  }, [selectedModel, switchModel])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  // Close settings popover on outside click
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  // Fetch available models the first time the popover is opened
  useEffect(() => {
    if (settingsOpen) fetchModelOptions()
  }, [settingsOpen, fetchModelOptions])

  const handleStop = useCallback(() => {
    window.electron.jiva.stopMessage()
  }, [])

  const handleAttach = useCallback(async () => {
    if (isProcessingFiles) return

    let paths: string[] = []
    try {
      paths = await window.electron.files.pick(true)
    } catch { return }
    if (!paths.length) return

    setIsProcessingFiles(true)
    const newAttachedFiles: AttachedFile[] = []
    const newProcessed: ProcessedAttachment[] = []

    for (const filePath of paths) {
      let converted: Awaited<ReturnType<typeof window.electron.files.convert>>
      try {
        converted = await window.electron.files.convert(filePath)
      } catch { continue }

      if (converted.error || converted.category === 'unsupported') continue

      const category = converted.category as 'text' | 'pdf' | 'docx' | 'image'
      newAttachedFiles.push({ name: converted.name, category })

      if (converted.category === 'image') {
        // Always reference by path; enrich with description when multimodal is configured
        let markdown = `[Image file: ${converted.markdown}]`
        if (isMultimodalEnabled && converted.dataUri) {
          try {
            const result = await window.electron.files.describeImage(converted.dataUri)
            if (result.success && result.description) {
              markdown = `[Image file: ${converted.markdown}]\n${result.description}`
            }
          } catch { /* path-only fallback already set */ }
        }
        newProcessed.push({ name: converted.name, markdown })
      } else {
        newProcessed.push({ name: converted.name, markdown: converted.markdown })
      }
    }

    setAttachedFiles(prev => [...prev, ...newAttachedFiles])
    setProcessedAttachments(prev => [...prev, ...newProcessed])
    setIsProcessingFiles(false)
  }, [isProcessingFiles, isMultimodalEnabled])

  const removeAttachment = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
    setProcessedAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const result = await extractImageFromClipboard(e.clipboardData, isMultimodalEnabled)
    if (!result) return // no image in the clipboard — let default text paste proceed
    e.preventDefault()
    setAttachedFiles(prev => [...prev, result.file])
    setProcessedAttachments(prev => [...prev, result.processed])
  }, [isMultimodalEnabled])

  const handleSend = useCallback(async () => {
    const text = value.trim()
    if ((!text && processedAttachments.length === 0) || !isConnected || isThinking) return

    const sendTime = Date.now()
    const currentAttachments = [...attachedFiles]
    const currentProcessed = [...processedAttachments]

    setValue('')
    setAttachedFiles([])
    setProcessedAttachments([])
    addUserMessage(text, currentAttachments.length ? currentAttachments : undefined)
    setThinking(true)

    try {
      const response = await sendMessage(text, activePersonaName ?? undefined, currentProcessed.length ? currentProcessed : undefined)
      const durationMs = Date.now() - sendTime
      addAgentResponse(
        response.content,
        {
          plan: response.plan ?? null,
          toolsUsed: response.toolsUsed ?? [],
          iterations: response.iterations ?? 1,
          durationMs,
        },
        durationMs,
        response.brainCommentary
      )
      useConversationStore.getState().loadConversationList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get response from Jivam'
      addErrorMessage(msg)
    }
  }, [value, processedAttachments, attachedFiles, isConnected, isThinking, activePersonaName, addUserMessage, setThinking, sendMessage, addAgentResponse, addErrorMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) return // default newline insertion

    const el = e.currentTarget
    const smart = handleSmartKeydown(e.key, value, el.selectionStart, el.selectionEnd)
    if (smart) {
      e.preventDefault()
      // Set the DOM value + cursor synchronously first — React re-rendering
      // with an already-matching value won't reset the cursor, whereas
      // waiting for the render (even via requestAnimationFrame) races it
      // and loses the cursor position to the end of the text.
      el.value = smart.value
      el.setSelectionRange(smart.cursorPos, smart.cursorPos)
      setValue(smart.value)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const activePersona = personas.find((p) => p.name === activePersonaName)

  const canSend = (value.trim() || processedAttachments.length > 0) && isConnected && !isThinking

  return (
    <div
      className="px-4 py-4 border-t"
      style={{
        borderColor: 'var(--topbar-border)',
        background: 'var(--topbar-bg)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Persona chip */}
      {activePersona && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-subtle)]">Using</span>
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(139,92,246,0.1)',
              color: 'var(--accent)',
              border: '1px solid rgba(139,92,246,0.2)',
            }}
          >
            {(() => {
              const IconComp = PERSONA_ICONS[activePersona.icon] ?? Bot
              return <IconComp size={12} className="flex-shrink-0" />
            })()}
            <span>{activePersona.displayName}</span>
          </span>
        </div>
      )}

      {/* Attached file chips */}
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachedFiles.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
              style={{
                background: 'rgba(139,92,246,0.08)',
                color: 'var(--text-subtle)',
                border: '1px solid rgba(139,92,246,0.2)',
              }}
            >
              {file.category === 'image'
                ? <Image size={11} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                : <FileText size={11} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
              }
              <span className="max-w-[140px] truncate">{file.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                className="ml-0.5 rounded-full flex-shrink-0 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-subtle)' }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div
        className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all"
        style={{
          background: 'var(--input-bg)',
          border: '1.5px solid var(--input-border)',
          boxShadow: '0 2px 12px rgba(139,92,246,0.08)',
        }}
      >
        {/* Attach button */}
        <button
          onClick={handleAttach}
          disabled={!isConnected || isThinking || isProcessingFiles}
          title="Attach file"
          className="flex-shrink-0 self-end mb-0.5 w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            color: isProcessingFiles ? 'var(--accent)' : 'var(--text-subtle)',
            background: isProcessingFiles ? 'rgba(139,92,246,0.1)' : 'transparent',
          }}
        >
          <Paperclip size={14} />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isConnected
              ? 'Message Jivam... (Shift+Enter for new line)'
              : 'Waiting for Jivam to initialize...'
          }
          disabled={!isConnected || isThinking}
          rows={1}
          className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] leading-relaxed disabled:opacity-50"
          style={{ maxHeight: '200px' }}
        />

        {/* Settings */}
        <div ref={settingsRef} className="relative flex-shrink-0 self-end mb-0.5">
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
            style={{
              background: settingsOpen ? 'rgba(139,92,246,0.15)' : 'transparent',
              color: settingsOpen ? 'var(--accent)' : 'var(--text-subtle)',
            }}
            title="Run settings"
          >
            <SlidersHorizontal size={14} />
          </button>

          {settingsOpen && (
            <div
              className="absolute bottom-10 right-0 z-50 rounded-xl p-3 w-[260px]"
              style={{
                background: 'var(--topbar-bg)',
                border: '1px solid var(--topbar-border)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* Model */}
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-medium text-[var(--text-subtle)] uppercase tracking-wide">Model</p>
                {switchingModel && <span className="text-[10px] text-[var(--accent)]">Switching…</span>}
              </div>
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={switchingModel}
                className="w-full mb-3 rounded-lg text-xs"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--text)',
                  padding: '6px 8px',
                }}
              >
                {selectedModel && !modelOptions.includes(selectedModel) && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
                {modelOptions.length === 0 && (
                  <option value="" disabled>{loadingModels ? 'Loading models…' : 'No models found'}</option>
                )}
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              {/* Max Iterations */}
              <p className="text-[10px] font-medium text-[var(--text-subtle)] mb-1.5 uppercase tracking-wide">Max Iterations</p>
              <div className="flex gap-1.5 mb-3">
                {([10, 50, 100] as const).map((val) => {
                  const label = val === 10 ? 'Quick' : val === 50 ? 'Medium' : 'Long'
                  const selected = maxIterations === val
                  return (
                    <button
                      key={val}
                      onClick={() => setMaxIterations(val)}
                      className="flex-1 py-1 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: selected ? 'rgba(139,92,246,0.2)' : 'var(--bg-secondary)',
                        color: selected ? 'var(--accent)' : 'var(--text-subtle)',
                        border: selected ? '1px solid rgba(139,92,246,0.4)' : '1px solid transparent',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Deep Run */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Zap size={12} className="text-[var(--accent)]" />
                  <span className="text-xs font-medium text-[var(--text)]">Deep Run</span>
                </div>
                <button
                  onClick={() => setDeepRun(!deepRun)}
                  className="relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
                  style={{ background: deepRun ? 'var(--accent)' : 'var(--bg-secondary)' }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ left: deepRun ? '18px' : '2px' }}
                  />
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-subtle)] mt-1.5 leading-relaxed">
                Brain plans and coordinates workers for complex requests
              </p>
            </div>
          )}
        </div>

        <button
          onClick={isThinking ? handleStop : handleSend}
          disabled={isThinking ? false : !canSend}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isThinking
              ? 'var(--bg-secondary)'
              : canSend
                ? 'linear-gradient(135deg, #8B5CF6, #3B82F6)'
                : 'var(--bg-secondary)',
          }}
        >
          {isThinking ? (
            <StopCircle size={15} className="text-[var(--accent)]" />
          ) : (
            <Send
              size={14}
              className={canSend ? 'text-white' : 'text-[var(--text-subtle)]'}
            />
          )}
        </button>
      </div>

      <AgentStatusRow
        disclaimer="Jivam can make mistakes. Verify important information."
        deepRun={deepRun}
        model={selectedModel || null}
        maxIterations={maxIterations}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  )
}
