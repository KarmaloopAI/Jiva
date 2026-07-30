import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message, ToolCall } from '../models/base.js';
import { groupMessagesIntoRounds, splitRoundsForCompaction } from './rounds.js';

function toolCall(id: string, name = 'grep'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

function toolResult(id: string, name = 'grep'): Message {
  return { role: 'tool', name, tool_call_id: id, content: `result for ${id}` };
}

test('groupMessagesIntoRounds: reproduces the reported failure shape without splitting the round', () => {
  // An assistant message issuing 6 parallel tool_calls (functions.grep:1..6),
  // followed by their 6 tool-result messages — wide enough that the old
  // KEEP_RECENT=10 raw-message slice would land mid-round.
  const ids = Array.from({ length: 6 }, (_, i) => `functions.grep:${i + 1}`);
  const messages: Message[] = [
    { role: 'developer', content: 'system prompt' },
    { role: 'user', content: 'find all usages of foo' },
    { role: 'assistant', content: null, tool_calls: ids.map((id) => toolCall(id)) },
    ...ids.map((id) => toolResult(id)),
  ];

  const rounds = groupMessagesIntoRounds(messages);

  // developer, user, and the assistant+6-tool-results round are 3 distinct rounds.
  assert.equal(rounds.length, 3);
  const toolRound = rounds[2];
  assert.equal(toolRound.length, 7); // 1 assistant + 6 tool results
  assert.equal(toolRound[0].role, 'assistant');
  assert.ok(toolRound.slice(1).every((m) => m.role === 'tool'));
});

test('groupMessagesIntoRounds: N alternating turns produce N rounds', () => {
  const messages: Message[] = [];
  for (let i = 0; i < 4; i++) {
    messages.push({ role: 'user', content: `turn ${i}` });
    messages.push({ role: 'assistant', content: null, tool_calls: [toolCall(`id-${i}`)] });
    messages.push(toolResult(`id-${i}`));
  }
  const rounds = groupMessagesIntoRounds(messages);
  // Each iteration pushes a user round (no trailing tool messages) and an
  // assistant+tool-result round, so 4 iterations produce 8 rounds.
  assert.equal(rounds.length, 8);
});

test('groupMessagesIntoRounds: Harmony-mode assistant message (no tool_calls field) still groups with its tool results', () => {
  const messages: Message[] = [
    { role: 'user', content: 'do something' },
    { role: 'assistant', content: '<|call|>functions.bash<|call|>echo hi' }, // rawHarmony — no tool_calls field
    toolResult('bash-1', 'bash'),
    toolResult('bash-2', 'bash'),
  ];
  const rounds = groupMessagesIntoRounds(messages);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1].length, 3);
  assert.equal(rounds[1][0].role, 'assistant');
});

test('groupMessagesIntoRounds: a round with zero trailing tool messages is still its own round', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ];
  const rounds = groupMessagesIntoRounds(messages);
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds, [[messages[0]], [messages[1]]]);
});

test('splitRoundsForCompaction: never lets recentMessages start with an orphaned tool message', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `functions.grep:${i + 1}`);
  const messages: Message[] = [
    { role: 'user', content: 'task 1' },
    { role: 'assistant', content: 'ok 1' },
    { role: 'user', content: 'task 2' },
    { role: 'assistant', content: null, tool_calls: ids.map((id) => toolCall(id)) },
    ...ids.map((id) => toolResult(id)),
    { role: 'user', content: 'task 3' },
    { role: 'assistant', content: 'ok 3' },
  ];

  const { recentMessages, middleMessages } = splitRoundsForCompaction(messages, 2);

  // With keepRounds=2, only the last 2 rounds ("task 3" round pair) are kept;
  // the wide tool-call round must be fully in the summarized-away middle,
  // never split.
  assert.ok(middleMessages.length > 0);
  if (recentMessages.length > 0) {
    assert.notEqual(recentMessages[0].role, 'tool');
  }
  // The 6-call round must appear entirely on one side.
  const middleHasAnyToolMsg = middleMessages.some((m) => m.role === 'tool');
  const recentHasAnyToolMsg = recentMessages.some((m) => m.role === 'tool');
  assert.ok(!(middleHasAnyToolMsg && recentHasAnyToolMsg));
});

test('splitRoundsForCompaction: fewer rounds than keepRounds keeps everything, summarizes nothing', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ];
  const { recentMessages, middleMessages } = splitRoundsForCompaction(messages, 5);
  assert.equal(middleMessages.length, 0);
  assert.equal(recentMessages.length, 2);
});
