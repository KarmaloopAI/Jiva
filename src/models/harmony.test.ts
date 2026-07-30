import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message, ToolCall } from './base.js';
import { ensureToolResultPairing, formatToolResult } from './harmony.js';

function toolCall(id: string, name = 'grep'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

test('ensureToolResultPairing: inserts a stub for a declared call missing its result', () => {
  const messages: Message[] = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [toolCall('a'), toolCall('b')] },
    formatToolResult('a', 'grep', 'result a'),
    { role: 'user', content: 'next turn' },
  ];

  const repaired = ensureToolResultPairing(messages);

  const toolMsgs = repaired.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.ok(toolMsgs.some((m) => m.tool_call_id === 'a' && m.content === 'result a'));
  const stub = toolMsgs.find((m) => m.tool_call_id === 'b');
  assert.ok(stub, 'expected a synthetic stub for the missing call b');
  assert.match(String(stub!.content), /orphaned tool call/i);
});

test('ensureToolResultPairing: drops a tool message with no matching declared call', () => {
  const messages: Message[] = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [toolCall('a')] },
    formatToolResult('a', 'grep', 'result a'),
    formatToolResult('zzz', 'grep', 'orphan result'), // no declared call for this id
    { role: 'user', content: 'next turn' },
  ];

  const repaired = ensureToolResultPairing(messages);
  const toolMsgs = repaired.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 1);
  assert.equal(toolMsgs[0].tool_call_id, 'a');
});

test('ensureToolResultPairing: Harmony-mode round (no tool_calls field) passes through unchanged', () => {
  const messages: Message[] = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: '<|call|>functions.bash<|call|>echo hi' }, // rawHarmony, no tool_calls
    formatToolResult('bash-1', 'bash', 'hi'),
  ];

  const repaired = ensureToolResultPairing(messages);
  assert.deepEqual(repaired, messages);
});

test('ensureToolResultPairing: idempotent on already-valid input', () => {
  const messages: Message[] = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [toolCall('a')] },
    formatToolResult('a', 'grep', 'result a'),
  ];
  const once = ensureToolResultPairing(messages);
  const twice = ensureToolResultPairing(once);
  assert.deepEqual(once, twice);
});
