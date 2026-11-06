# Sarvam-105B Integration Guide

> **Status:** Research complete. Implementation guide for integrating Sarvam-105B into Jiva.

---

## 1. API Fundamentals

| Property | Value |
|---|---|
| Endpoint | `https://api.sarvam.ai/v1/chat/completions` |
| Model ID | `sarvam-105b` |
| Protocol | OpenAI-compatible REST (non-streaming + SSE streaming) |
| Auth header (primary) | `API-Subscription-Key: <key>` |
| Auth header (also works) | `Authorization: Bearer <key>` |

Jiva currently sends `Authorization: Bearer <apiKey>`. **This works with Sarvam** — no auth header change needed.

---

## 2. How Jiva Calls LLMs

Jiva has a single model client (`KrutrimModel` in `src/models/krutrim.ts`) that handles all providers. When a chat request arrives:

1. **Session-manager** reads `models.reasoning` config from the GCS bucket (or falls back to env vars) and instantiates a `KrutrimModel` with a `KrutrimConfig`.
2. **Worker/Manager agents** call `orchestrator.chatWithFallback()`, which routes to the reasoning model (or a dedicated tool-calling model if configured).
3. **`KrutrimModel.attemptChat()`** builds the request body, selects tool format (Harmony vs standard OpenAI), sends via `fetch`, and parses the response.
4. **Tool format selection**: `useHarmonyFormat` config flag. `false` = standard OpenAI `tools[]` array and `tool_calls` response. `true` = Krutrim-specific Harmony XML embedding (only needed for `gpt-oss-120b`).
5. **Reasoning effort**: Controlled by `reasoningEffortStrategy` — `'api_param'` sends `reasoning_effort` in the request body, `'system_prompt'` injects a leading system message, `'both'` does both (default).

---

## 3. Sarvam-105B API Behaviour (From Live Testing)

### 3.1 Authentication
Both methods were tested and confirmed working:
```
API-Subscription-Key: sk_xxx   ← documented primary
Authorization: Bearer sk_xxx   ← also works (Jiva uses this)
```

### 3.2 Response Structure — Critical Difference: `reasoning_content`

Sarvam-105B is a **reasoning model** that exposes its chain-of-thought in a separate field: `reasoning_content`. This is distinct from Groq's `reasoning` field.

**Non-streaming response:**
```json
{
  "id": "20260326_...",
  "choices": [{
    "finish_reason": "stop",
    "message": {
      "role": "assistant",
      "content": "Paris",
      "reasoning_content": "The user asked for the capital of France...(thinking chain)...",
      "tool_calls": null
    }
  }],
  "usage": {
    "completion_tokens": 323,
    "prompt_tokens": 21,
    "total_tokens": 344
  }
}
```

**Streaming delta fields:**
```json
{
  "choices": [{
    "delta": {
      "content": "Paris",
      "reasoning_content": "1. Analyze...",
      "tool_calls": null,
      "role": "assistant"
    },
    "finish_reason": null
  }]
}
```

The final usage chunk in a stream has **empty `choices: []`** — filter it out before accessing `choices[0]`.

### 3.3 Tool Calling

Sarvam-105B supports **full standard OpenAI tool calling** — no Harmony format needed.

**Request:**
```json
{
  "model": "sarvam-105b",
  "messages": [{"role": "user", "content": "Weather in Mumbai?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"]
      }
    }
  }],
  "tool_choice": "auto"
}
```

**Response when tool is selected:**
```json
{
  "choices": [{
    "finish_reason": "tool_calls",
    "message": {
      "role": "assistant",
      "content": null,
      "reasoning_content": "We need to call get_weather with city \"Mumbai\".",
      "tool_calls": [{
        "id": "call_ff3f05830516475fa80778db",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"Mumbai\"}"
        }
      }]
    }
  }]
}
```

**Multi-turn tool flow** — ⚠️ Important: `tools` array **must be re-passed** in every subsequent turn that contains `tool` role messages, otherwise the API returns a 400:
```
"Tool messages found but no tools provided. Tools must be specified if tool calls or tool messages are present."
```

This is consistent with Jiva's existing behaviour — it already passes `tools` on every iteration of the Worker loop.

### 3.4 `reasoning_effort` Parameter

Supported natively as an API parameter:
```json
{ "reasoning_effort": "low" | "medium" | "high" }
```

All three levels were tested and returned valid responses. No system prompt injection needed (unlike gpt-oss-120b on Krutrim).

### 3.5 ⚠️ Critical: `max_tokens` Must Be Set

This is the most important difference from other providers.

Sarvam-105B spends **completion tokens on reasoning first**, then produces the visible response. The default completion token limit (2048) is easily consumed entirely by the reasoning chain, leaving **zero tokens for the actual response** — resulting in `content: null` or empty content with `finish_reason: "length"`.

**Tested behaviour:**
- Without `max_tokens`: model returns empty content, `finish_reason: "length"` ✗
- With `max_tokens: 4096`: model returns full content, `finish_reason: "stop"` ✓
- With `max_tokens: 8192`: same, works correctly ✓

**Recommended setting**: `max_tokens: 8192` for general use. Lower for cost-sensitive workflows.

### 3.6 Streaming

SSE streaming works identically to OpenAI. Jiva's current model client uses **non-streaming** `fetch` — this works fine with Sarvam.

---

## 4. Required Jiva Code Changes

### 4.1 `KrutrimConfig` — add `defaultMaxTokens`

In `src/models/krutrim.ts`, add to `KrutrimConfig`:
```typescript
/**
 * Default max tokens for completion. MUST be set for reasoning models
 * (e.g. Sarvam-105B) that spend tokens on reasoning before producing output.
 * Without this, reasoning models hit the provider default (~2048) and return
 * empty content. Recommended: 8192 for Sarvam-105B.
 */
defaultMaxTokens?: number;
```

In `attemptChat()`, use it when `options.maxTokens` is not provided:
```typescript
const maxTokens = options.maxTokens ?? this.config.defaultMaxTokens;
if (maxTokens) {
  requestBody.max_tokens = maxTokens;
}
```

### 4.2 `reasoning_content` field — normalise across providers

In `src/models/krutrim.ts`, the current code reads Groq's `reasoning` field:
```typescript
// Current (Groq-specific):
const reasoningTokens: string | undefined = choice.message?.reasoning;
```

Change to read both:
```typescript
// Supports Groq (choice.message.reasoning) and Sarvam (choice.message.reasoning_content):
const reasoningTokens: string | undefined =
  choice.message?.reasoning_content ?? choice.message?.reasoning;
```

### 4.3 `reasoningEffortStrategy` — set to `'api_param'` for Sarvam

Sarvam understands `reasoning_effort` natively. There is no benefit to also injecting a `Reasoning: high` system message — it just wastes tokens. Set `reasoningEffortStrategy: 'api_param'` in the bucket config (see Section 5).

---

## 5. Bucket Config for Sarvam-105B

Place this at `{tenantId}/config.json` in your GCS bucket:

```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://api.sarvam.ai/v1/chat/completions",
      "apiKey": "sk_m8gszi34_ZHa9L0sI5xnzeRIWoePRVNfe",
      "defaultModel": "sarvam-105b",
      "useHarmonyFormat": false,
      "reasoningEffortStrategy": "api_param",
      "defaultReasoningEffort": "high",
      "defaultMaxTokens": 8192
    },
    "multimodal": null
  }
}
```

> **Note:** `defaultMaxTokens` will not be recognised until the code change in §4.1 is implemented.

---

## 6. What Does NOT Need to Change

| Concern | Status |
|---|---|
| Auth header (`Authorization: Bearer`) | ✅ Works as-is |
| Standard OpenAI tool call format | ✅ Works as-is |
| Multi-turn tool loop (tools re-passed each turn) | ✅ Worker already does this |
| `temperature`, `top_p` params | ✅ Standard, works |
| `reasoning_effort` API param | ✅ Works via `reasoningEffortStrategy: 'api_param'` |
| Harmony format | ✅ Not needed, set `useHarmonyFormat: false` |
| `usage` tracking | ✅ Same field names as OpenAI |

---

## 7. Compatibility Summary

```
Sarvam-105B = OpenAI-compatible + reasoning model quirks

Works natively:
  ✓ POST /v1/chat/completions
  ✓ Bearer token auth
  ✓ Standard tool calling (tools[], tool_calls)
  ✓ reasoning_effort API param
  ✓ system / user / assistant / tool roles
  ✓ Non-streaming and SSE streaming

Requires adaptation:
  ! max_tokens MUST be set (≥4096) — reasoning tokens eat the budget
  ! reasoning_content field (not .reasoning like Groq)
  ! reasoningEffortStrategy should be 'api_param' (not 'both')
```

---

## 8. Test Commands

Quick smoke-test against the live API:

```bash
# Basic chat
curl -s https://api.sarvam.ai/v1/chat/completions \
  -H "API-Subscription-Key: sk_m8gszi34_ZHa9L0sI5xnzeRIWoePRVNfe" \
  -H "Content-Type: application/json" \
  -d '{"model":"sarvam-105b","messages":[{"role":"user","content":"What is 2+2?"}],"max_tokens":4096,"stream":false,"reasoning_effort":"low"}' | jq '.choices[0].message.content'

# Tool calling
curl -s https://api.sarvam.ai/v1/chat/completions \
  -H "API-Subscription-Key: sk_m8gszi34_ZHa9L0sI5xnzeRIWoePRVNfe" \
  -H "Content-Type: application/json" \
  -d '{"model":"sarvam-105b","messages":[{"role":"user","content":"Weather in Mumbai?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"tool_choice":"auto","max_tokens":4096,"stream":false}' | jq '.choices[0]'
```
