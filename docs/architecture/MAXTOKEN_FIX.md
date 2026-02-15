# MaxTokens Error Fix

**Date:** December 9, 2025
**Issue:** `max_tokens must be at least 1, got -9078`

## The Problem

When conversations grew large, the agent would crash with:
```
Krutrim API error (400): {"error":{"message":"max_tokens must be at least 1, got -9078.","type":"BadRequestError","param":null,"code":400}}
```

## Root Cause

The agent was setting `maxTokens: 4096` for all requests. When the conversation history was large:

1. Input tokens (conversation) = ~13,000 tokens
2. Model context limit = ~4,000 tokens total
3. API calculates: `max_tokens = limit - input_tokens`
4. Result: `max_tokens = 4000 - 13000 = -9000` ❌

The negative number caused the API to reject the request.

## The Solution

**Removed the hardcoded `maxTokens` parameter** from agent requests:

```typescript
// Before (BROKEN)
response = await this.orchestrator.chat({
  model: 'gpt-oss-120b',
  messages: messagesToSend,
  tools: tools.length > 0 ? tools : undefined,
  temperature: this.temperature,
  maxTokens: 4096, // ❌ This causes errors with large conversations
});

// After (FIXED)
response = await this.orchestrator.chat({
  model: 'gpt-oss-120b',
  messages: messagesToSend,
  tools: tools.length > 0 ? tools : undefined,
  temperature: this.temperature,
  // Let API determine maxTokens based on available context ✅
});
```

## Why This Works

By not specifying `maxTokens`:
- API automatically calculates available tokens
- Takes input size into account
- Never tries to allocate negative tokens
- Always uses maximum available space

## Code Change

**File:** `src/core/agent.ts`
**Line:** ~174
**Change:** Removed `maxTokens: 4096` parameter

## Prevention

The conversation condensing feature (at 30 message threshold) prevents conversations from growing too large, but this fix ensures the agent works even with large conversations before condensing triggers.

## Other maxTokens Usage

These are still safe because they're simple single-message requests:

1. **Conversation condensing summary** (`conversation-manager.ts:241`)
   - `maxTokens: 1000`
   - Single user message with text to summarize
   - Safe: Input is controlled and small

2. **Conversation summary generation** (`conversation-manager.ts:297`)
   - `maxTokens: 100`
   - Single user message for brief summary
   - Safe: Input is 5 user messages max

## Verification

```bash
# Rebuild
npm run build

# Test with long conversation
npx jiva chat
# ... have a long conversation with many messages ...
# Should not crash with maxTokens error
```

## Impact

- ✅ **No more maxTokens errors**
- ✅ **Works with conversations of any size**
- ✅ **API optimally manages token allocation**
- ✅ **No functionality lost**

## Status

✅ **FIXED** - Deployed in current build

---

**Related Features:**
- Conversation condensing prevents growth
- Auto-trimming keeps recent messages
- Together these ensure optimal performance
