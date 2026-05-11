/**
 * CloudRunner — HTTP/SSE client to the deployed Jiva Cloud Run instance.
 * Implements the same public interface as JivaRunner so ipc-handlers.ts
 * can route transparently between local and cloud modes.
 */

import type { CodeLogEvent } from './code-runner'

const CLOUD_RUN_URL = 'https://jiva-hdjcuspt2a-uc.a.run.app'

export type PhaseUpdate = 'initializing' | 'planning' | 'executing' | 'synthesizing' | 'done'

export interface CloudRunResult {
  content: string
  iterations: number
  toolsUsed: string[]
  plan: { subtasks: string[]; reasoning?: string } | null
  durationMs: number
  conversationId?: string
}


export class CloudRunner {
  private userId: string | null = null
  private sessionId: string | null = null
  private _active = false
  private _abortController: AbortController | null = null
  private _readyPromise: Promise<void> | null = null
  private _readyResolve: (() => void) | null = null
  private _readyReject: ((err: Error) => void) | null = null

  /** Call this as soon as cloud:init starts — before the async session HTTP call. */
  startInit(): void {
    if (this._active) return
    if (!this._readyPromise) {
      this._readyPromise = new Promise<void>((resolve, reject) => {
        this._readyResolve = resolve
        this._readyReject = reject
      })
    }
  }

  configure(userId: string, sessionId: string): void {
    this.userId = userId
    this.sessionId = sessionId
    this._active = true
    this._readyResolve?.()
    this._readyResolve = null
    this._readyReject = null
  }

  /**
   * Wait until the runner is configured, up to timeoutMs.
   * Resolves immediately if already active.
   * Rejects if init was never started or times out.
   */
  waitUntilReady(timeoutMs: number): Promise<void> {
    if (this._active) return Promise.resolve()
    if (!this._readyPromise) return Promise.reject(new Error('Cloud runner init not started'))
    return Promise.race([
      this._readyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Cloud runner not ready after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
  }

  isActive(): boolean {
    return this._active
  }

  isInitializing(): boolean {
    return !this._active && this._readyPromise !== null
  }

  deactivate(): void {
    this._active = false
    this.userId = null
    this.sessionId = null
    // Reject any pending waitUntilReady callers
    this._readyReject?.(new Error('Cloud session deactivated'))
    this._readyPromise = null
    this._readyResolve = null
    this._readyReject = null
  }

  stop(): void {
    this._abortController?.abort()
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': this.userId ?? 'dev-tenant',
      'x-session-id': this.sessionId ?? 'default-session',
    }
  }

  async chat(
    prompt: string,
    onPhase: (phase: PhaseUpdate) => void,
    _opts?: { deepRun?: boolean },
    onLog?: (event: CodeLogEvent) => void
  ): Promise<CloudRunResult> {
    if (!this._active) throw new Error('CloudRunner not configured')

    const startTime = Date.now()
    onPhase('planning')

    this._abortController = new AbortController()
    const { signal } = this._abortController

    try {
      const result = await this._streamChat(prompt, onPhase, onLog, signal)
      return { ...result, durationMs: Date.now() - startTime }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return {
          content: '',
          iterations: 0,
          toolsUsed: [],
          plan: null,
          durationMs: Date.now() - startTime,
        }
      }
      // SSE failed — fall back to non-streaming
      console.warn('[CloudRunner] SSE failed, falling back to non-streaming:', err)
      const result = await this._nonStreamChat(prompt, onPhase, signal)
      return { ...result, durationMs: Date.now() - startTime }
    } finally {
      this._abortController = null
      onPhase('done')
    }
  }

  private async _streamChat(
    prompt: string,
    onPhase: (phase: PhaseUpdate) => void,
    onLog: ((event: CodeLogEvent) => void) | undefined,
    signal: AbortSignal
  ): Promise<Omit<CloudRunResult, 'durationMs'>> {
    const res = await fetch(`${CLOUD_RUN_URL}/api/chat/stream`, {
      method: 'POST',
      headers: { ...this.headers, 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message: prompt }),
      signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`SSE request failed: ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let iterations = 0
    const toolsUsed: string[] = []
    let plan: CloudRunResult['plan'] = null
    // Track the current SSE event type from `event:` lines (per SSE spec)
    let currentEventType: string | null = null

    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim()
          continue
        }
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue

        let d: Record<string, unknown>
        try {
          d = JSON.parse(raw) as Record<string, unknown>
        } catch {
          continue
        }

        // Use the SSE `event:` type; fall back to a `type` field in the payload
        const evtType = currentEventType ?? (d.type as string | undefined)
        currentEventType = null

        if (evtType === 'status') {
          const msg = d.message as string | undefined
          if (msg) {
            onPhase('executing')
            onLog?.({
              timestamp: new Date().toISOString(),
              level: 'info',
              tag: 'cloud',
              message: `Tool: ${msg}`,
            })
          }
        } else if (evtType === 'response') {
          content = (d.content ?? d.response ?? '') as string
          iterations = (d.iterations ?? 0) as number
          if (Array.isArray(d.toolsUsed)) toolsUsed.push(...(d.toolsUsed as string[]))
          if (d.plan) plan = d.plan as CloudRunResult['plan']
        } else if (evtType === 'error') {
          throw new Error(d.message as string ?? 'Stream error')
        } else if (evtType === 'done') {
          break outer
        }
      }
    }

    return { content, iterations, toolsUsed, plan }
  }

  private async _nonStreamChat(
    prompt: string,
    onPhase: (phase: PhaseUpdate) => void,
    signal: AbortSignal
  ): Promise<Omit<CloudRunResult, 'durationMs'>> {
    onPhase('executing')
    const res = await fetch(`${CLOUD_RUN_URL}/api/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ message: prompt }),
      signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Cloud chat failed (${res.status}): ${text}`)
    }
    const d = await res.json() as Record<string, unknown>
    return {
      content: (d.response ?? '') as string,
      iterations: (d.iterations ?? 0) as number,
      toolsUsed: Array.isArray(d.toolsUsed) ? (d.toolsUsed as string[]) : [],
      plan: (d.plan ?? null) as CloudRunResult['plan'],
    }
  }

  async resetConversation(): Promise<void> {
    if (!this._active) return
    try {
      await fetch(`${CLOUD_RUN_URL}/api/chat/history`, {
        method: 'DELETE',
        headers: this.headers,
      })
    } catch (e) {
      console.error('[CloudRunner] resetConversation failed:', e)
    }
  }

  async stopMessage(): Promise<void> {
    try {
      await fetch(`${CLOUD_RUN_URL}/api/chat/stop`, {
        method: 'POST',
        headers: this.headers,
      })
    } catch {}
    this.stop()
  }
}
