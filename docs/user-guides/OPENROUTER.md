# OpenRouter

[OpenRouter](https://openrouter.ai) is a single OpenAI-compatible endpoint that routes each request to one of many upstream providers (Together, Fireworks, DeepInfra, Anthropic, Azure, …). Jiva treats it as a first-class provider: you can **rank the upstream providers** per model, control fallbacks, and Jiva records which provider actually served each call.

## Quick start

```bash
jiva setup        # choose "OpenRouter" as the provider
```

The wizard fills in the endpoint, asks for your OpenRouter API key and a model ID (e.g. `openai/gpt-oss-120b`), lists the providers OpenRouter offers for that model, and asks for your **priority ranking**.

Or edit `~/.jiva/config.json` directly:

```json
{
  "models": {
    "reasoning": {
      "endpoint": "https://openrouter.ai/api/v1/chat/completions",
      "apiKey": "sk-or-...",
      "type": "reasoning",
      "defaultModel": "openai/gpt-oss-120b",
      "reasoningEffortStrategy": "api_param",
      "openrouter": {
        "providerOrder": ["fireworks", "together", "deepinfra/turbo"],
        "allowFallbacks": true
      }
    }
  }
}
```

## How routing works

Without any routing config, OpenRouter load-balances across providers, favouring the cheapest stable one. Jiva sends a `provider` object only when you configure one:

| Config key (`openrouter` block) | Sent as | Meaning |
|---|---|---|
| `providerOrder` | `provider.order` | Ranked slugs; first is tried first. **Disables load balancing.** |
| `allowFallbacks` | `provider.allow_fallbacks` | `false` = strict pinning: the request fails if every listed provider fails. OpenRouter default is `true`. |
| `only` | `provider.only` | Restrict to these slugs. |
| `ignore` | `provider.ignore` | Never use these slugs. |
| `sort` | `provider.sort` | `price`, `throughput` or `latency`. Cannot be combined with `providerOrder`. |
| `requireParameters` | `provider.require_parameters` | Only providers that support every request parameter. **Defaults to `true` for requests that carry tools**, so a provider never silently drops your tool definitions. |
| `dataCollection` | `provider.data_collection` | `"deny"` = only providers that don't collect/train on your data. |
| `zdr` | `provider.zdr` | Zero-Data-Retention endpoints only. |
| `quantizations` | `provider.quantizations` | e.g. `["fp8", "bf16"]`. |
| `maxPrice` | `provider.max_price` | Hard price ceiling in $/M tokens (`prompt`, `completion`). |
| `modelFallbacks` | `models` | Other models to try if the primary errors (rate limit, downtime, context length). |
| `referer`, `title` | `HTTP-Referer`, `X-Title` | App attribution on openrouter.ai. Defaults to Jiva's. |

### Provider slugs

Slugs are OpenRouter's provider slugs — copy them from the model page on openrouter.ai, or let `jiva setup` list them for you.

- A **base slug** (`deepinfra`) matches every variant and region of that provider.
- A **full slug** (`deepinfra/turbo`, `google-vertex/us-east5`) matches only that variant.

### Strict vs. soft ranking

| Goal | Config |
|---|---|
| "Prefer Fireworks, but never fail because of it" | `providerOrder: ["fireworks"]`, `allowFallbacks: true` |
| "Only Fireworks or Together, in that order" | `providerOrder: ["fireworks","together"]`, `allowFallbacks: false` |
| "Fastest available" | `sort: "throughput"` |
| "Cheapest, but keep my data private" | `sort: "price"`, `dataCollection: "deny"` |

## Per-role routing

Each model role (`reasoning`, `multimodal`, `toolCalling`) has its own `openrouter` block, because the available providers differ per model.

## Cloud / HTTP server

Environment variables (applied when a tenant has no stored config yet):

| Variable | Purpose |
|---|---|
| `JIVA_MODEL_PROVIDER=openrouter` | Defaults the endpoint to OpenRouter |
| `JIVA_MODEL_BASE_URL`, `JIVA_MODEL_API_KEY`, `JIVA_MODEL_NAME` | Endpoint / key / model |
| `JIVA_MODEL_PROVIDER_ORDER` | Comma-separated ranked slugs, e.g. `fireworks,together` |
| `JIVA_MODEL_ALLOW_FALLBACKS` | `true` / `false` |
| `JIVA_TOOL_CALLING_MODEL_PROVIDER_ORDER`, `JIVA_TOOL_CALLING_MODEL_ALLOW_FALLBACKS` | Same, for the tool-calling model |

Per-session override via the request's `agentConfig` (never persisted):

```json
{ "agentConfig": { "model": "openai/gpt-oss-120b", "providerOrder": ["fireworks"], "allowFallbacks": false } }
```

## What Jiva does with OpenRouter's responses

- **Served-by tracking** — the response's `provider` and `model` are captured (visible at debug level: `served by Fireworks (openai/gpt-oss-120b), cost $0.0012`) and available on `ModelResponse.routing`.
- **Cost** — OpenRouter's reported `usage.cost` is accumulated by the token tracker (`totalCostUsd`).
- **Errors** — failures that OpenRouter reports inside an HTTP 200 body, or mid-stream, are surfaced as normal errors and retried by status code. `402` (out of credits) is not retried and says so. `503`/`404` ("no provider satisfies the routing") include your active routing constraints in the message.
- **Reasoning continuity** — structured `reasoning_details` are echoed back unchanged on tool-call turns, which some models (e.g. Claude) require.
- **Retries** — OpenRouter already fails over between upstream providers before any tokens are sent, so Jiva uses fewer client-side retries (2 instead of 4).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `503` / `404` "No available provider…" | A slug in `providerOrder`/`only` isn't offered for this model, `allowFallbacks: false` with all listed providers down, `maxPrice` too low, or `requireParameters` excluded everyone. |
| `402` | Out of OpenRouter credits. |
| Tool calls ignored | A provider without tool support was used — leave `requireParameters` unset (defaults on for tool requests) or set it `true`. |
| Wrong provider used | `providerOrder` not set — OpenRouter is load-balancing by price. |
