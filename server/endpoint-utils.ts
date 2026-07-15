/**
 * OpenAI-compatible providers are typically documented with their base URL
 * (".../v1") but users often paste the full chat-completions URL instead
 * (".../v1/chat/completions") — or vice versa. Both are valid ways to think
 * about "the endpoint", so accept either and normalize to whichever shape a
 * given caller actually needs.
 */

const CHAT_COMPLETIONS_SUFFIX = '/chat/completions'

/** Strips a trailing slash, if any. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Normalizes any accepted endpoint form to the full chat-completions URL. */
export function toChatCompletionsUrl(rawEndpoint: string): string {
  const url = stripTrailingSlash(rawEndpoint.trim())
  if (url.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) return url
  return `${url}${CHAT_COMPLETIONS_SUFFIX}`
}

/** Normalizes any accepted endpoint form to the base URL (for hitting /models). */
export function toBaseUrl(rawEndpoint: string): string {
  const url = stripTrailingSlash(rawEndpoint.trim())
  if (url.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    return url.slice(0, -CHAT_COMPLETIONS_SUFFIX.length)
  }
  return url
}
