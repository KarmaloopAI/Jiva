/**
 * Client-side mirror of server/endpoint-utils.ts — OpenAI-compatible
 * providers are documented with either their base URL (".../v1") or the
 * full chat-completions URL (".../v1/chat/completions"); accept either when
 * a user pastes a custom endpoint and normalize to the full URL, since
 * that's what the model client actually calls.
 */

const CHAT_COMPLETIONS_SUFFIX = '/chat/completions'

export function toChatCompletionsUrl(rawEndpoint: string): string {
  const url = rawEndpoint.trim().replace(/\/+$/, '')
  if (url.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) return url
  return `${url}${CHAT_COMPLETIONS_SUFFIX}`
}
