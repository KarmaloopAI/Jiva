/**
 * Token pricing — used only when a provider does NOT report the cost of a call
 * in its response (OpenRouter does; most providers don't).
 *
 * Resolution order (truthful, never guessed):
 *   1. Provider price list ("catalog"): the provider's own `/models` endpoint,
 *      when it publishes prices (OpenRouter: per-token strings; Together:
 *      per-million numbers). Fetched once per base URL per process.
 *   2. User-configured price for the model (`pricing` in model config).
 *   3. Unknown — the cost is reported as unknown, not as $0.
 */

export interface ModelPricing {
  /** USD per million prompt (input) tokens. */
  promptPerM: number;
  /** USD per million completion (output) tokens. */
  completionPerM: number;
  /** USD per million cached prompt tokens (defaults to promptPerM when unknown). */
  cachedPromptPerM?: number;
}

export interface ResolvedPrice extends ModelPricing {
  source: 'catalog' | 'config';
}

type Catalog = Map<string, ModelPricing>;

const catalogCache = new Map<string, Promise<Catalog | undefined>>();

/** Strip the chat-completions suffix to get the provider's API base URL. */
export function apiBaseFromEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/completions$/, '');
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Parse one model's pricing object from a `/models` listing.
 *   - OpenRouter style: `{ prompt: "0.00000015", completion: "0.0000006", input_cache_read? }` — USD per token.
 *   - Together style:   `{ input: 0.88, output: 0.88 }` — USD per million tokens.
 */
export function parsePricing(pricing: any): ModelPricing | undefined {
  if (!pricing || typeof pricing !== 'object') return undefined;
  if (pricing.prompt !== undefined || pricing.completion !== undefined) {
    const p = num(pricing.prompt);
    const c = num(pricing.completion);
    if (p === undefined || c === undefined) return undefined;
    const cached = num(pricing.input_cache_read);
    const perM = (x: number) => Math.round(x * 1_000_000 * 1e6) / 1e6;
    return { promptPerM: perM(p), completionPerM: perM(c), ...(cached !== undefined ? { cachedPromptPerM: perM(cached) } : {}) };
  }
  if (pricing.input !== undefined || pricing.output !== undefined) {
    const p = num(pricing.input);
    const c = num(pricing.output);
    if (p === undefined || c === undefined) return undefined;
    return { promptPerM: p, completionPerM: c };
  }
  return undefined;
}

async function fetchCatalog(baseUrl: string, apiKey: string | undefined, fetchImpl: typeof fetch): Promise<Catalog | undefined> {
  try {
    const res = await fetchImpl(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return undefined;
    const body: any = await res.json();
    const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const catalog: Catalog = new Map();
    for (const m of list) {
      if (typeof m?.id !== 'string') continue;
      const price = parsePricing(m.pricing);
      if (price) catalog.set(m.id, price);
    }
    return catalog.size > 0 ? catalog : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a model's price: provider catalog first, then user config, else undefined.
 * Catalog lookups are cached per base URL for the life of the process.
 */
export async function resolveModelPrice(
  endpoint: string,
  model: string,
  apiKey: string | undefined,
  configPrice: ModelPricing | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedPrice | undefined> {
  const base = apiBaseFromEndpoint(endpoint);
  let pending = catalogCache.get(base);
  if (!pending) {
    pending = fetchCatalog(base, apiKey, fetchImpl);
    catalogCache.set(base, pending);
    // Don't cache failures forever — allow a retry on a later turn.
    pending.then((c) => { if (!c) catalogCache.delete(base); }).catch(() => catalogCache.delete(base));
  }
  const catalog = await pending;
  const fromCatalog = catalog?.get(model);
  if (fromCatalog) return { ...fromCatalog, source: 'catalog' };
  if (configPrice && num(configPrice.promptPerM) !== undefined && num(configPrice.completionPerM) !== undefined) {
    return { ...configPrice, source: 'config' };
  }
  return undefined;
}

/** USD cost of one call at `price`. Cached prompt tokens use the cached rate when known. */
export function computeCost(
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
  price: ModelPricing,
): number {
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens);
  const uncached = usage.promptTokens - cached;
  const cost =
    uncached * price.promptPerM +
    cached * (price.cachedPromptPerM ?? price.promptPerM) +
    usage.completionTokens * price.completionPerM;
  return cost / 1_000_000;
}

/** Test hook: forget cached catalogs. */
export function clearPricingCache(): void {
  catalogCache.clear();
}
