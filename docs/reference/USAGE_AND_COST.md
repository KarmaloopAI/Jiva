# Usage, Cost, Context Size and Compaction

Jiva reports what each turn actually consumed, says where every cost figure came from, and keeps the carried conversation bounded.

## Per-turn usage

Every `chat()` call on `CodeAgent` and `DualAgent` returns:

| Field | Meaning |
|---|---|
| `turnUsage` | **This turn only**: model calls, prompt / completion / cached / reasoning tokens, `costUsd`, `costSource`, `estimated` |
| `contextTokens` | Estimated size of the context carried into the next turn: system prompt plus user/assistant history. Tool calls and results are not carried across turns, so they are excluded |
| `tokenUsage` | The orchestrator's **lifetime** totals (all turns) |

The turn includes every billable call made during it: Manager, Worker, review and synthesis, sub-agents sharing the orchestrator, compaction summaries and multimodal caption calls.

`ModelOrchestrator.beginTurn()` / `endTurn()` / `peekTurn()` expose the same meter to embedding apps. Turns nest: an app's own turn wrapping agent turns (e.g. Jivam's Deep Run) aggregates into one.

The CLI shows it after every reply:

```
[turn: 16.5k in (7.9k cached) + 467 out · $0.0065 · context: 1.7k · session: 48.2k / $0.031]
```

## Truthful cost

Each call's cost is resolved in this order, and the result says which source was used:

| `costSource` | Where the number comes from |
|---|---|
| `provider` | The provider reported the call's cost in its response (OpenRouter does) |
| `catalog` | The provider's own price list: its `/models` endpoint, when it publishes prices (OpenRouter per-token, Together per-million). Fetched once per provider per process |
| `config` | Your per-model price: `pricing: { promptPerM, completionPerM, cachedPromptPerM? }` (USD per million tokens) on the model config |
| `unknown` | None of the above. The cost is reported as **unknown, never as $0** |

How cost is aggregated:
- Cached prompt tokens are billed at `cachedPromptPerM` when it is set.
- A turn's cost is `unknown` if any call in it had no known price.
- `mixed` means the calls in a turn used different sources.
- `estimated: true` means a provider returned no usage block, so token counts were estimated locally with a tokenizer.

Calls marked `purpose: 'auxiliary'` — titles, compaction summaries, host-side planning calls — are billed and counted. They do **not** overwrite `lastPromptTokens`, which keeps describing the agent's own context.

Saved conversations store `totalPromptTokens`, `totalCompletionTokens`, `totalTokens` and `totalCostUsd`, accumulated per turn.

## Compaction

The carried conversation is condensed into one structured summary plus the most recent messages, kept verbatim.

- **Automatic, chat mode.** Triggers when the estimated carried context exceeds `compaction.threshold` (default 100,000), or the history exceeds `compaction.maxMessages` (default 60).
- **Automatic, code mode.** Triggers at the start of a turn when the carried history exceeds `codeMode.compactionThreshold`. Separately, in-loop compaction of the working message list runs when a response's prompt exceeds the threshold.
- **Manual.** `agent.compact({ keepMessages? })` returns `{ beforeTokens, afterTokens, beforeMessages, afterMessages, usage }`. Also available as the REPL `/compact` command and `POST /api/session/compact` on the HTTP server.

Guarantees:
- Leading system/developer messages are kept.
- Nothing else is pinned forever.
- The verbatim tail starts on a user message.
- If the summary would not be smaller than what it replaces, the history is left unchanged — compaction never grows the context.

```json
{
  "compaction": { "threshold": 100000, "maxMessages": 60 },
  "codeMode": { "compactionThreshold": 100000 }
}
```

The HTTP server reads `JIVA_COMPACTION_THRESHOLD` (chat) and `JIVA_CODE_COMPACTION_THRESHOLD` (code).
