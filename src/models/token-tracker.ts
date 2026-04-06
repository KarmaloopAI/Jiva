/**
 * TokenTracker — accumulates LLM token usage across all calls made through a
 * ModelOrchestrator instance.
 *
 * Token data comes primarily from the API response's `usage` field.
 * When a provider omits `usage` (some do in certain streaming modes), we fall
 * back to local estimation using `gpt-tokenizer` (cl100k_base — the GPT-4
 * tokenizer). For non-OpenAI models like Sarvam or Krutrim's gpt-oss-120b, this
 * is a reasonable approximation (typically ±5% for typical prompt content).
 *
 * Usage:
 *   const tracker = new TokenTracker();
 *   // After each orchestrator.chatWithFallback() call:
 *   tracker.record(response.usage, requestMessages, response.content);
 *   // Read the snapshot at any time:
 *   tracker.getSnapshot();
 */

import { encode } from 'gpt-tokenizer';
import type { Message } from './base.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TokenUsageSnapshot {
  /** Lifetime accumulated prompt tokens sent to the model. */
  promptTokens: number;
  /** Lifetime accumulated completion tokens received from the model. */
  completionTokens: number;
  /** promptTokens + completionTokens */
  totalTokens: number;
  /**
   * Prompt token count of the most recent individual model call.
   * Used by agents to compare against their compaction threshold — it reflects
   * how full the context window was on the last turn.
   */
  lastPromptTokens: number;
  /** Total tokens (prompt + completion) for the most recent individual call. */
  lastTotalTokens: number;
}

// ─── TokenTracker ─────────────────────────────────────────────────────────────

export class TokenTracker {
  private _promptTokens = 0;
  private _completionTokens = 0;
  private _lastPromptTokens = 0;
  private _lastTotalTokens = 0;

  /**
   * Record token usage from a model API response.
   *
   * - If `usage` is present (most providers return it), those exact numbers are used.
   * - If `usage` is absent or both counters are zero, falls back to local estimation
   *   using gpt-tokenizer for `messages` and the raw response content string.
   *
   * @param usage           The `usage` field from `ModelResponse` (may be undefined)
   * @param messages        The request messages array (used for fallback estimation)
   * @param responseContent The raw response text (used for completion fallback)
   */
  record(
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined,
    messages?: Message[],
    responseContent?: string,
  ): void {
    let prompt = usage?.promptTokens ?? 0;
    let completion = usage?.completionTokens ?? 0;

    // Fall back to local estimation when the API omits usage data
    if (prompt === 0 && messages && messages.length > 0) {
      prompt = TokenTracker.estimateMessagesTokens(messages);
    }
    if (completion === 0 && responseContent) {
      completion = TokenTracker.estimateTokens(responseContent);
    }

    this._promptTokens += prompt;
    this._completionTokens += completion;
    this._lastPromptTokens = prompt;
    this._lastTotalTokens = prompt + completion;
  }

  /** Return a snapshot of the current accumulated state. */
  getSnapshot(): TokenUsageSnapshot {
    return {
      promptTokens: this._promptTokens,
      completionTokens: this._completionTokens,
      totalTokens: this._promptTokens + this._completionTokens,
      lastPromptTokens: this._lastPromptTokens,
      lastTotalTokens: this._lastTotalTokens,
    };
  }

  /** Reset all counters (e.g., when starting a fresh conversation). */
  reset(): void {
    this._promptTokens = 0;
    this._completionTokens = 0;
    this._lastPromptTokens = 0;
    this._lastTotalTokens = 0;
  }

  // ─── Static helpers ────────────────────────────────────────────────────────

  /**
   * Estimate the token count of a plain string using gpt-tokenizer (cl100k_base).
   * Falls back to a 4-chars-per-token heuristic if the tokenizer throws.
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    try {
      return encode(text).length;
    } catch {
      // Absolute fallback: GPT-4 averages ~4 chars/token for English prose
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Estimate the token count for a full messages array.
   * Adds per-message overhead (role label + separators, ~4 tokens each) plus a
   * reply-priming constant of 2, matching the OpenAI cookbook formula.
   */
  static estimateMessagesTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += 4; // per-message overhead (role, delimiters)
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<{ text?: string }>)
                .map((c) => c.text ?? '')
                .join('')
            : '';
      if (content) total += TokenTracker.estimateTokens(content);
      if ((msg as any).tool_calls) {
        total += TokenTracker.estimateTokens(JSON.stringify((msg as any).tool_calls));
      }
    }
    total += 2; // reply priming
    return total;
  }
}
