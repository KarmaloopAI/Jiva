/**
 * Structural grouping of a conversation's message array into "rounds", used to
 * keep context-compaction boundaries from splitting a tool_call away from the
 * tool_result message(s) that answer it.
 */

import type { Message } from '../models/base.js';

/**
 * One "round" = a non-tool message plus the maximal contiguous run of
 * role:'tool' messages immediately following it. Grouping is purely
 * structural (role-adjacency), not id-based, so it works identically whether
 * the assistant message carries a structured `tool_calls` array (standard
 * tool-calling mode) or not (Harmony mode, where tool_calls exist only
 * in-memory in the caller — see the `Message.tool_calls` doc comment).
 */
export function groupMessagesIntoRounds(messages: Message[]): Message[][] {
  const rounds: Message[][] = [];
  for (const msg of messages) {
    if (msg.role === 'tool' && rounds.length > 0) {
      rounds[rounds.length - 1].push(msg);
    } else {
      rounds.push([msg]);
    }
  }
  return rounds;
}

/**
 * Splits messages into a "keep verbatim" tail and a "summarize away" middle,
 * cutting strictly on round boundaries so a tool_call/tool_result pair can
 * never be split across the two halves — regardless of how wide a single
 * round is (e.g. a large parallel tool-call batch), since the cut is chosen
 * by round count, not by a fixed message-count budget.
 */
export function splitRoundsForCompaction(
  messages: Message[],
  keepRounds: number,
): { recentMessages: Message[]; middleMessages: Message[] } {
  const rounds = groupMessagesIntoRounds(messages);
  if (rounds.length <= keepRounds) {
    return { recentMessages: rounds.flat(), middleMessages: [] };
  }
  const recentRounds = rounds.slice(-keepRounds);
  const middleRounds = rounds.slice(0, -keepRounds);
  return { recentMessages: recentRounds.flat(), middleMessages: middleRounds.flat() };
}
