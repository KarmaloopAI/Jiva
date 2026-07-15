import { Router } from 'express'
import { readConfig, writeConfig, getJivamConfigPath } from '../config-manager'
import os from 'os'

const router = Router()

type ProviderKey = 'sarvam' | 'krutrim' | 'groq' | 'openai-compatible'

const PROVIDER_PRESETS: Record<ProviderKey, {
  endpoint: string
  defaultModel: string
  useHarmonyFormat: boolean
  reasoningEffortStrategy: string
  defaultMaxTokens?: number
  maxRequestsPerMinute?: number
  // Whether this preset's *reasoning* model itself has native vision — as
  // opposed to vision being provided via a separate `multimodal` model
  // below. None of the built-in presets' reasoning models are vision-native
  // today (vision comes from the bundled multimodal model instead), but
  // openai-compatible users pointing at their own vision-capable model (via
  // ModelSetupStep's "This model supports vision" toggle) need this set.
  hasVision?: boolean
  multimodal: { defaultModel: string } | null
}> = {
  sarvam: {
    endpoint: 'https://api.sarvam.ai/v1/chat/completions',
    defaultModel: 'sarvam-105b',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'api_param',
    // Sarvam-105B's standard plan caps completions at 4096 output tokens
    // (enterprise plans allow more) and 40 requests/minute.
    defaultMaxTokens: 4096,
    maxRequestsPerMinute: 40,
    multimodal: null,
  },
  krutrim: {
    endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
    defaultModel: 'gpt-oss-120b',
    useHarmonyFormat: true,
    reasoningEffortStrategy: 'system_prompt',
    multimodal: { defaultModel: 'Llama-4-Maverick-17B-128E-Instruct' },
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'api_param',
    multimodal: { defaultModel: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
  },
  'openai-compatible': {
    endpoint: '',
    defaultModel: '',
    useHarmonyFormat: false,
    reasoningEffortStrategy: 'both',
    multimodal: null,
  },
}

router.get('/', (_req, res) => {
  res.json(readConfig())
})

router.post('/', (req, res) => {
  const ok = writeConfig(req.body)
  res.json(ok)
})

router.get('/path', (_req, res) => {
  res.json(getJivamConfigPath())
})

router.post('/setup-provider', (req, res) => {
  const { provider, apiKey, customEndpoint, customModel, hasVision } = req.body as {
    provider: ProviderKey
    apiKey: string
    customEndpoint?: string
    customModel?: string
    // Only meaningful for 'openai-compatible' — built-in presets' reasoning
    // models aren't vision-native (see PROVIDER_PRESETS comment above).
    hasVision?: boolean
  }
  try {
    const preset = PROVIDER_PRESETS[provider]
    if (!preset) return res.json({ success: false, error: `Unknown provider: ${provider}` })

    const endpoint = provider === 'openai-compatible' ? (customEndpoint ?? '') : preset.endpoint
    const defaultModel = provider === 'openai-compatible' ? (customModel ?? '') : preset.defaultModel

    const existing = readConfig()
    const config = existing ?? { models: { reasoning: null } }

    config.models = {
      ...config.models,
      reasoning: {
        name: 'reasoning',
        type: 'reasoning',
        provider,
        endpoint,
        apiKey,
        defaultModel,
        useHarmonyFormat: preset.useHarmonyFormat,
        reasoningEffortStrategy: preset.reasoningEffortStrategy,
        ...(preset.defaultMaxTokens ? { defaultMaxTokens: preset.defaultMaxTokens } : {}),
        ...(preset.maxRequestsPerMinute ? { maxRequestsPerMinute: preset.maxRequestsPerMinute } : {}),
        ...(provider === 'openai-compatible' ? { hasVision: !!hasVision } : (preset.hasVision ? { hasVision: true } : {})),
      } as Parameters<typeof writeConfig>[0]['models']['reasoning'],
      multimodal: (preset.multimodal
        ? { name: 'multimodal', type: 'multimodal', endpoint, apiKey, defaultModel: preset.multimodal.defaultModel }
        : undefined) as Parameters<typeof writeConfig>[0]['models']['multimodal'],
    }

    if (!config.mcpServers) {
      const allowedPath = process.platform === 'win32' ? 'C:\\Users' : `${os.homedir()}`
      config.mcpServers = {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath], enabled: true },
        'mcp-shell-server': { command: 'npx', args: ['-y', '@mkusaka/mcp-shell-server'], enabled: true },
      }
    }

    const ok = writeConfig(config)
    return res.json({ success: ok, error: ok ? undefined : 'Failed to write config' })
  } catch (err) {
    return res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
