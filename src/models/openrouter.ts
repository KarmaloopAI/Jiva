/**
 * OpenRouter support.
 *
 * OpenRouter is a *router*: one endpoint that fronts many upstream providers
 * (Together, Fireworks, DeepInfra, Anthropic, …). Which upstream serves a call
 * is decided per request via the `provider` object in the request body, so —
 * unlike other providers, where "provider" is just a URL — Jiva needs a place
 * to hold that routing policy. This module owns:
 *
 *  - the config schema (`openrouter` block on a model config)
 *  - pure builders that turn it into request body fields / headers
 *  - helpers to read OpenRouter's response metadata and error bodies
 *
 * Everything here is side-effect free so it can be unit-tested without HTTP.
 * Routing fields are only ever sent when the model is actually an OpenRouter
 * model (see `isOpenRouterModel`) — other servers may reject unknown fields.
 */

import { z } from 'zod';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

const SortSchema = z.enum(['price', 'throughput', 'latency']);

/**
 * Per-model-role OpenRouter routing policy.
 *
 * Provider slugs are OpenRouter slugs, e.g. `fireworks`, `together`,
 * `deepinfra/turbo`, `google-vertex/us-east5`. A base slug matches every
 * variant/region of that provider; a full slug matches only that variant.
 */
export const OpenRouterConfigSchema = z
  .object({
    /**
     * Priority-ranked provider slugs — first entry is tried first. Setting this
     * disables OpenRouter's default price-weighted load balancing.
     */
    providerOrder: z.array(z.string()).optional(),
    /**
     * Allow OpenRouter to fall back to providers that are NOT in `providerOrder`
     * when the listed ones fail. false = strict pinning (request fails if every
     * listed provider fails). OpenRouter's own default is true.
     */
    allowFallbacks: z.boolean().optional(),
    /** Restrict this request to these provider slugs only. */
    only: z.array(z.string()).optional(),
    /** Never use these provider slugs. */
    ignore: z.array(z.string()).optional(),
    /** Sort candidates by price / throughput / latency (disables load balancing). */
    sort: SortSchema.optional(),
    /**
     * Only route to providers that support every parameter in the request.
     * When unset, Jiva enables this automatically for requests that carry
     * tools, so tool calls are never silently dropped by a provider.
     */
    requireParameters: z.boolean().optional(),
    /** 'deny' = only providers that do not collect/train on your data. */
    dataCollection: z.enum(['allow', 'deny']).optional(),
    /** Restrict to Zero-Data-Retention endpoints. */
    zdr: z.boolean().optional(),
    /** Restrict to quantizations, e.g. ['fp8', 'bf16']. */
    quantizations: z.array(z.string()).optional(),
    /** Hard price ceiling in $/M tokens — the request fails if it cannot be met. */
    maxPrice: z
      .object({
        prompt: z.number().optional(),
        completion: z.number().optional(),
        request: z.number().optional(),
        image: z.number().optional(),
      })
      .optional(),
    /**
     * Model-level fallbacks (OpenRouter `models` array). Tried in order when the
     * primary model errors (rate limit, downtime, context length, moderation).
     */
    modelFallbacks: z.array(z.string()).optional(),
    /** Attribution: sent as the `HTTP-Referer` header. */
    referer: z.string().optional(),
    /** Attribution: sent as the `X-Title` header. */
    title: z.string().optional(),
  })
  .refine((c) => !(c.providerOrder && c.providerOrder.length > 0 && c.sort), {
    message: "Set either 'providerOrder' or 'sort', not both (both disable load balancing and conflict)",
  });

export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;

/** True when the endpoint URL points at OpenRouter. */
export function isOpenRouterEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/** A model is treated as OpenRouter if it has a routing block or points at openrouter.ai. */
export function isOpenRouterModel(cfg: { endpoint?: string; openrouter?: unknown }): boolean {
  return cfg.openrouter !== undefined || isOpenRouterEndpoint(cfg.endpoint);
}

/** Normalise user-entered slugs: trim, lowercase, drop empties and duplicates (order preserved). */
export function normalizeSlugs(slugs: readonly string[] | undefined): string[] | undefined {
  if (!slugs) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of slugs) {
    const s = raw.trim().toLowerCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Parse a comma/space separated list of slugs ("fireworks, together deepinfra/turbo"). */
export function parseSlugList(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  return normalizeSlugs(input.split(/[\s,]+/));
}

export interface OpenRouterRoutingFields {
  /** Spread into the request body. */
  provider?: Record<string, unknown>;
  models?: string[];
}

/**
 * Build the OpenRouter-specific body fields for a request.
 *
 * @param hasTools whether the request carries `tools`. Used to default
 *   `require_parameters` to true for tool-calling requests only — enabling it
 *   unconditionally would also exclude providers that merely don't support an
 *   optional parameter such as `reasoning`.
 */
export function buildOpenRouterRouting(
  cfg: OpenRouterConfig | undefined,
  hasTools: boolean,
): OpenRouterRoutingFields {
  const provider: Record<string, unknown> = {};

  const order = normalizeSlugs(cfg?.providerOrder);
  if (order) provider.order = order;
  if (cfg?.allowFallbacks !== undefined) provider.allow_fallbacks = cfg.allowFallbacks;

  const only = normalizeSlugs(cfg?.only);
  if (only) provider.only = only;
  const ignore = normalizeSlugs(cfg?.ignore);
  if (ignore) provider.ignore = ignore;

  if (cfg?.sort) provider.sort = cfg.sort;
  if (cfg?.dataCollection) provider.data_collection = cfg.dataCollection;
  if (cfg?.zdr !== undefined) provider.zdr = cfg.zdr;
  const quant = normalizeSlugs(cfg?.quantizations);
  if (quant) provider.quantizations = quant;
  if (cfg?.maxPrice && Object.keys(cfg.maxPrice).length > 0) provider.max_price = cfg.maxPrice;

  const requireParameters = cfg?.requireParameters ?? (hasTools ? true : undefined);
  if (requireParameters !== undefined) provider.require_parameters = requireParameters;

  const fields: OpenRouterRoutingFields = {};
  if (Object.keys(provider).length > 0) fields.provider = provider;
  const fallbacks = cfg?.modelFallbacks?.map((m) => m.trim()).filter(Boolean);
  if (fallbacks && fallbacks.length > 0) fields.models = fallbacks;
  return fields;
}

/** Attribution headers (plus any user-supplied extra headers). */
export function buildOpenRouterHeaders(cfg: OpenRouterConfig | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'HTTP-Referer': cfg?.referer || 'https://github.com/KarmaloopAI/Jiva',
    'X-Title': cfg?.title || 'Jiva',
  };
  return headers;
}

export interface OpenRouterRoutingInfo {
  /** Model that actually served the request (may differ from the requested one via fallbacks). */
  model?: string;
  /** Upstream provider that served the request, e.g. "Fireworks". */
  provider?: string;
}

/** Extract served-by metadata from a (reassembled) response body. */
export function extractRoutingInfo(data: any): OpenRouterRoutingInfo | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const model = typeof data.model === 'string' ? data.model : undefined;
  const provider = typeof data.provider === 'string' ? data.provider : undefined;
  if (!model && !provider) return undefined;
  return { model, provider };
}

export interface OpenRouterErrorBody {
  code?: number;
  message: string;
  providerName?: string;
}

/**
 * OpenRouter reports generation-time failures with HTTP 200 and an `error`
 * object in the body (non-stream) or as a top-level `error` on an SSE chunk.
 * Returns the parsed error, or undefined when the body is not an error.
 */
export function parseOpenRouterErrorBody(data: any): OpenRouterErrorBody | undefined {
  const err = data?.error;
  if (!err) return undefined;
  if (typeof err === 'string') return { message: err };
  const code = typeof err.code === 'number' ? err.code : Number(err.code);
  return {
    code: Number.isFinite(code) ? code : undefined,
    message: typeof err.message === 'string' ? err.message : JSON.stringify(err),
    providerName: err.metadata?.provider_name,
  };
}

/**
 * Add OpenRouter-specific guidance to an HTTP error. The original status and
 * body are preserved verbatim (the retry logic matches on "(NNN)").
 */
export function describeOpenRouterHttpError(
  status: number,
  body: string,
  cfg: OpenRouterConfig | undefined,
): string {
  const base = `API error (${status}): ${body}`;
  switch (status) {
    case 402:
      return `${base}\n[OpenRouter] Insufficient credits for this account/API key — add credits at https://openrouter.ai/credits.`;
    case 404:
    case 503: {
      const routing = buildOpenRouterRouting(cfg, false).provider;
      const hint = routing
        ? ` Current routing constraints: ${JSON.stringify(routing)}.`
        : '';
      return (
        `${base}\n[OpenRouter] No available provider satisfied the routing requirements.` +
        `${hint} Check provider slugs, 'only'/'ignore', 'requireParameters', 'maxPrice', and account-level allowed providers.`
      );
    }
    default:
      return base;
  }
}

export interface OpenRouterProviderEndpoint {
  /** Slug to put in `providerOrder` (OpenRouter's endpoint `tag`, e.g. "deepinfra/turbo"). */
  slug: string;
  /** Human-readable provider name. */
  name: string;
  quantization?: string;
}

/**
 * Best-effort lookup of the provider endpoints OpenRouter offers for a model
 * (GET /models/{author}/{slug}/endpoints). Used by the setup wizard to show
 * valid slugs and warn on typos. Returns undefined on any failure (offline,
 * unknown model, unexpected shape) — callers must treat it as advisory.
 */
export async function fetchModelProviderEndpoints(
  modelId: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterProviderEndpoint[] | undefined> {
  const [author, ...rest] = modelId.split('/');
  const slug = rest.join('/');
  if (!author || !slug) return undefined;
  try {
    const res = await fetchImpl(
      `${OPENROUTER_API_BASE}/models/${encodeURIComponent(author)}/${slug
        .split('/')
        .map(encodeURIComponent)
        .join('/')}/endpoints`,
      {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return undefined;
    const body: any = await res.json();
    const endpoints: any[] = body?.data?.endpoints ?? [];
    const out: OpenRouterProviderEndpoint[] = [];
    for (const e of endpoints) {
      const name: string | undefined = e.provider_name ?? e.name;
      const tag: string | undefined = typeof e.tag === 'string' ? e.tag : undefined;
      const slugCandidate = tag ?? (name ? name.toLowerCase().replace(/\s+/g, '-') : undefined);
      if (!slugCandidate) continue;
      out.push({
        slug: slugCandidate.toLowerCase(),
        name: name ?? slugCandidate,
        quantization: typeof e.quantization === 'string' ? e.quantization : undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compare ranked slugs against a model's known endpoints. A base slug
 * ("deepinfra") is valid if any endpoint slug equals it or starts with
 * "deepinfra/". Returns the slugs that match nothing.
 */
export function findUnknownSlugs(
  slugs: readonly string[],
  endpoints: readonly OpenRouterProviderEndpoint[],
): string[] {
  const known = endpoints.map((e) => e.slug);
  return slugs.filter((s) => !known.some((k) => k === s || k.startsWith(`${s}/`)));
}
