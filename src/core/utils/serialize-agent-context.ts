/**
 * serializeAgentContext - Produces a consistent, role-appropriate string block
 * that each agent embeds in its prompt.
 *
 * Using the same serializer for all three agents ensures the format is identical;
 * the `role` parameter governs what is included, not how it is formatted.
 *
 * Token budget guidelines (tunable):
 *   Directive:            ~500 tokens max (truncate with notice if exceeded)
 *   Conversation summary: ~300 tokens max
 *   Recent messages:      last 6 messages of all roles, ~800 tokens
 *   Validation context:   ~400 tokens max
 */

import { AgentContext } from '../types/agent-context.js';
import { Message } from '../../models/base.js';

// Rough estimate: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;
const DIRECTIVE_TOKEN_LIMIT = 500;
const SUMMARY_TOKEN_LIMIT = 300;
const RECENT_MESSAGES_LIMIT = 6;
const RECENT_MESSAGES_TOKEN_LIMIT = 800;
const VALIDATION_CONTEXT_TOKEN_LIMIT = 400;

/**
 * Truncate text to a token-approximate character limit, appending a notice if truncated.
 */
function truncate(text: string, tokenLimit: number): string {
  const charLimit = tokenLimit * CHARS_PER_TOKEN;
  if (text.length <= charLimit) return text;
  return text.substring(0, charLimit) + '\n[...truncated due to token limit]';
}

/**
 * Serialize a single message to a compact string representation.
 */
function serializeMessage(msg: Message): string {
  const role = msg.role.toUpperCase();
  const content = typeof msg.content === 'string'
    ? msg.content
    : msg.content.map(c => c.text || '[image]').join(' ');
  return `[${role}]: ${content}`;
}

/**
 * Serialize AgentContext into a role-appropriate string block.
 *
 * - manager: directive + conversation (summary + recent). Omits validationContext.
 * - worker:  directive + conversation (summary + recent, incl. tool messages). Omits validationContext.
 * - client:  directive + conversation (summary + recent, incl. tool messages) + validationContext. Omits execution persona.
 */
export function serializeAgentContext(
  ctx: AgentContext,
  role: 'manager' | 'worker' | 'client'
): string {
  const sections: string[] = [];

  // ── Directive ──────────────────────────────────────────────────────────
  if (ctx.directive) {
    sections.push(
      '=== DIRECTIVE ===\n' + truncate(ctx.directive, DIRECTIVE_TOKEN_LIMIT)
    );
  }

  // ── Conversation context ──────────────────────────────────────────────
  const convParts: string[] = [];

  if (ctx.conversation.summary) {
    convParts.push(
      '[Conversation Summary]\n' + truncate(ctx.conversation.summary, SUMMARY_TOKEN_LIMIT)
    );
  }

  if (ctx.conversation.recentMessages.length > 0) {
    const bounded = ctx.conversation.recentMessages.slice(-RECENT_MESSAGES_LIMIT);
    const serialized = bounded.map(serializeMessage).join('\n');
    convParts.push(
      '[Recent Messages]\n' + truncate(serialized, RECENT_MESSAGES_TOKEN_LIMIT)
    );
  }

  if (convParts.length > 0) {
    sections.push('=== CONVERSATION CONTEXT ===\n' + convParts.join('\n\n'));
  }

  // ── Validation context (client only) ──────────────────────────────────
  if (role === 'client' && ctx.persona?.validationContext) {
    sections.push(
      '=== VALIDATION CONTEXT ===\n' +
      truncate(ctx.persona.validationContext, VALIDATION_CONTEXT_TOKEN_LIMIT)
    );
  }

  return sections.join('\n\n');
}
