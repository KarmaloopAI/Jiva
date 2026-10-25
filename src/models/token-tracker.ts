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
  /** Lifetime cost in USD, summed over calls with a known price (provider-reported or computed). */
  totalCostUsd: number;
  /** Lifetime prompt tokens served from the provider's cache, when reported. */
  cachedTokens?: number;
  /** Lifetime hidden reasoning tokens, when reported. */
  reasoningTokens?: number;
}

/** Where a cost figure came from — reported truthfully, never guessed. */
export type CostSource = 'provider' | 'catalog' | 'config' | 'unknown';

/** Usage fields a model response may carry (see ModelResponse.usage). */
export interface RecordedUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  costSource?: CostSource;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** True when the token counts are a local estimate, not provider-reported. */
  estimated?: boolean;
}

/** Usage of one user turn (all model calls made between beginTurn/endTurn). */
export interface TurnUsage {
  /** Model calls made during the turn (agent + auxiliary). */
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** Cost in USD, when every costed call had a known price; undefined when unknown. */
  costUsd?: number;
  /** 'mixed' when calls used different sources; 'unknown' when any call had no price. */
  costSource: CostSource | 'mixed';
  /** True when any call's token counts were estimated locally. */
  estimated: boolean;
}

export type CallPurpose = 'agent' | 'auxiliary';

function emptyTurn(): TurnUsage {
  return {
    calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    cachedTokens: 0, reasoningTokens: 0, costUsd: 0, costSource: 'unknown', estimated: false,
  };
}

export class TokenTracker {
  private _promptTokens = 0;
  private _completionTokens = 0;
  private _cachedTokens = 0;
  private _reasoningTokens = 0;
  private _lastPromptTokens = 0;
  private _lastTotalTokens = 0;
  private _costUsd = 0;

  /** Turn accounting — nested begin/end pairs share one accumulator. */
  private _turnDepth = 0;
  private _turn: TurnUsage = emptyTurn();
  private _turnSources = new Set<CostSource>();

  /**
   * Record token usage from a model API response.
   *
   * - If `usage` is present (most providers return it), those exact numbers are used.
   * - If `usage` is absent or both counters are zero, falls back to local estimation
   *   using gpt-tokenizer for `messages` and the raw response content string, and
   *   marks the call as estimated.
   * - `purpose: 'auxiliary'` (titles, compaction summaries, host-side brain calls)
   *   counts toward totals and cost but does NOT overwrite `lastPromptTokens`,
   *   which must keep describing the agent's own context.
   *
   * @param usage           The `usage` field from `ModelResponse` (may be undefined)
   * @param messages        The request messages array (used for fallback estimation)
   * @param responseContent The raw response text (used for completion fallback)
   */
  record(
    usage: RecordedUsage | undefined,
    messages?: Message[],
    responseContent?: string,
    purpose: CallPurpose = 'agent',
  ): void {
    let prompt = usage?.promptTokens ?? 0;
    let completion = usage?.completionTokens ?? 0;
    let estimated = usage?.estimated ?? false;

    // Fall back to local estimation when the API omits usage data
    if (prompt === 0 && messages && messages.length > 0) {
      prompt = TokenTracker.estimateMessagesTokens(messages);
      estimated = true;
    }
    if (completion === 0 && responseContent) {
      completion = TokenTracker.estimateTokens(responseContent);
      estimated = true;
    }

    const cached = usage?.cachedTokens ?? 0;
    const reasoning = usage?.reasoningTokens ?? 0;
    const cost = typeof usage?.cost === 'number' ? usage.cost : undefined;
    const costSource: CostSource = cost !== undefined ? (usage?.costSource ?? 'provider') : 'unknown';

    if (cost !== undefined) this._costUsd += cost;
    this._promptTokens += prompt;
    this._completionTokens += completion;
    this._cachedTokens += cached;
    this._reasoningTokens += reasoning;
    if (purpose === 'agent') {
      this._lastPromptTokens = prompt;
      this._lastTotalTokens = prompt + completion;
    }

    if (this._turnDepth > 0) {
      const t = this._turn;
      t.calls++;
      t.promptTokens += prompt;
      t.completionTokens += completion;
      t.totalTokens += prompt + completion;
      t.cachedTokens += cached;
      t.reasoningTokens += reasoning;
      t.estimated = t.estimated || estimated;
      if (cost !== undefined && t.costUsd !== undefined) t.costUsd += cost;
      if (cost === undefined) t.costUsd = undefined; // one unpriced call makes the turn's cost unknown
      this._turnSources.add(costSource);
    }
  }

  /** Start (or join) a turn. Nested calls share the outermost turn. */
  beginTurn(): void {
    if (this._turnDepth === 0) {
      this._turn = emptyTurn();
      this._turnSources.clear();
    }
    this._turnDepth++;
  }

  /**
   * End a turn. Returns the accumulated usage when the outermost turn ends,
   * otherwise a snapshot of the turn so far (nested callers).
   */
  endTurn(): TurnUsage {
    if (this._turnDepth > 0) this._turnDepth--;
    return this.peekTurn();
  }

  /** Usage of the current (or last finished) turn, without ending it. */
  peekTurn(): TurnUsage {
    const t = { ...this._turn };
    const sources = [...this._turnSources];
    if (sources.length === 0) {
      t.costSource = 'unknown';
      t.costUsd = undefined;
    } else if (sources.includes('unknown')) {
      t.costSource = 'unknown';
      t.costUsd = undefined;
    } else {
      t.costSource = sources.length === 1 ? sources[0] : 'mixed';
    }
    return t;
  }

  /** Return a snapshot of the current accumulated state. */
  getSnapshot(): TokenUsageSnapshot {
    return {
      promptTokens: this._promptTokens,
      completionTokens: this._completionTokens,
      totalTokens: this._promptTokens + this._completionTokens,
      lastPromptTokens: this._lastPromptTokens,
      lastTotalTokens: this._lastTotalTokens,
      totalCostUsd: this._costUsd,
      cachedTokens: this._cachedTokens,
      reasoningTokens: this._reasoningTokens,
    };
  }

  /** Reset all counters (e.g., when starting a fresh conversation). */
  reset(): void {
    this._promptTokens = 0;
    this._completionTokens = 0;
    this._cachedTokens = 0;
    this._reasoningTokens = 0;
    this._lastPromptTokens = 0;
    this._lastTotalTokens = 0;
    this._costUsd = 0;
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
