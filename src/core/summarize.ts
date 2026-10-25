/**
 * Shared conversation summarisation / condensing used by every compaction
 * path: DualAgent's cross-turn condense, CodeAgent's cross-turn compaction and
 * the public `compact()` on both agents.
 */

import type { Message } from '../models/base.js';
import type { ModelOrchestrator } from '../models/orchestrator.js';
import { logger } from '../utils/logger.js';
import { TokenTracker } from '../models/token-tracker.js';

/** Marker that starts every compaction summary message (detected when rebuilding context). */
export const COMPACTION_MARKER = '[Context compacted — previous conversation history summarised]';

export interface CompactionContext {
  directive?: string;
  currentGoal?: string;
}

function messageText(msg: Message): string {
  if (msg.role === 'tool') {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return `[Tool result]: ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}`;
  }
  const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : msg.role;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return `${role}: ${content}`;
}

/**
 * Produce a structured summary of `messages` (opencode-style template) with
 * one auxiliary model call. Throws when the model call fails.
 */
export async function summarizeMessages(
  messages: Message[],
  orchestrator: ModelOrchestrator,
  ctx?: CompactionContext,
): Promise<string> {
  const conversationText = messages.map(messageText).join('\n\n');
  const contextParts: string[] = [];
  if (ctx?.directive) contextParts.push(`WORKSPACE DIRECTIVE (prioritise retaining context aligned with this):\n${ctx.directive}`);
  if (ctx?.currentGoal) contextParts.push(`CURRENT GOAL:\n${ctx.currentGoal}`);
  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n\n') + '\n\nWhen summarising, prioritise information that directly supports the directive and current goal above.\n\n---\n\n'
    : '';

  const summaryPrompt = `${contextBlock}Provide a detailed summary for continuing our conversation. The summary will be used so another agent can read it and continue the work.

When constructing the summary, follow this template:

## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give that are still relevant]
- [If there is a plan or spec, include information about it so the next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]

---

Conversation to summarise:
${conversationText}

Keep the summary focused and complete — include file paths, function names, and specific changes made.`;

  const response = await orchestrator.chat({
    purpose: 'auxiliary',
    messages: [{ role: 'user', content: summaryPrompt }],
    temperature: 0.1,
    maxTokens: 1500,
  });
  if (!response.content?.trim()) throw new Error('Empty summary');
  return response.content;
}

/** Build the summary message inserted in place of the condensed history. */
export function summaryMessage(summary: string): Message {
  // role 'user' so it is valid in every provider's message format
  return { role: 'user', content: `${COMPACTION_MARKER}\n\n${summary}\n\n[Continuing conversation...]` };
}

/**
 * Condense a conversation to roughly `targetMessageCount` messages:
 *   - leading system/developer messages are kept (only if actually present —
 *     plain user/assistant histories have none, so nothing is pinned forever);
 *   - the most recent messages are kept verbatim, starting on a user message;
 *   - everything in between (including an earlier summary) becomes one summary.
 * On summariser failure falls back to keeping just the recent tail.
 */
export async function condenseHistory(
  messages: Message[],
  orchestrator: ModelOrchestrator,
  targetMessageCount: number,
  ctx?: CompactionContext,
): Promise<Message[]> {
  if (messages.length <= targetMessageCount) return messages;

  let pinned = 0;
  while (pinned < messages.length && (messages[pinned].role === 'system' || messages[pinned].role === 'developer')) pinned++;
  const head = messages.slice(0, pinned);

  // Keep enough recent messages to hit the target (head + summary + tail), at least 2.
  let keep = Math.max(2, targetMessageCount - pinned - 1);
  let tailStart = Math.max(pinned, messages.length - keep);
  // Start the verbatim tail on a user message so the exchange reads naturally.
  while (tailStart > pinned && messages[tailStart].role !== 'user') tailStart--;
  const middle = messages.slice(pinned, tailStart);
  const tail = messages.slice(tailStart);
  if (middle.length === 0) return messages;

  try {
    const summary = await summarizeMessages(middle, orchestrator, ctx);
    const replacement = summaryMessage(summary);
    // Never grow the context: if the summary is not smaller than what it
    // replaces (short exchanges), keep the original history.
    if (TokenTracker.estimateMessagesTokens([replacement]) >= TokenTracker.estimateMessagesTokens(middle)) {
      logger.info('Compaction skipped — the summary would not be smaller than the messages it replaces');
      return messages;
    }
    const result = [...head, replacement, ...tail];
    logger.info(`Conversation condensed: ${messages.length} → ${result.length} messages`);
    return result;
  } catch (error) {
    logger.error('Failed to condense conversation — keeping the recent tail only', error);
    return [...head, ...tail];
  }
}
