/**
 * Loop-level tests for parallel tool execution in CodeAgent and WorkerAgent,
 * driven by a scripted fake model (no network).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { CodeAgent } from './agent.js';
import { WorkspaceManager } from '../core/workspace.js';
import { WorkerAgent } from '../core/worker-agent.js';
import { READS_ALL } from '../core/tool-scheduler.js';
import { ensureToolResultPairing } from '../models/harmony.js';
import type { Message, ModelResponse, ToolCall } from '../models/base.js';
import type { ICodeTool } from './tools/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tc = (id: string, name: string, args: object): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** Orchestrator stand-in: returns scripted responses and records each request's messages. */
function fakeOrchestrator(script: ModelResponse[]) {
  const requests: Message[][] = [];
  return {
    requests,
    orchestrator: {
      async chatWithFallback(opts: { messages: Message[] }) {
        requests.push(JSON.parse(JSON.stringify(opts.messages)));
        return script.shift() ?? { content: 'done' };
      },
      async chat(opts: { messages: Message[] }) {
        return this.chatWithFallback(opts);
      },
      getReasoningModel: () => ({ getDefaultMaxTokens: () => undefined }),
      hasToolCallingModel: () => false,
      getTokenUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, lastPromptTokens: 0, lastTotalTokens: 0, totalCostUsd: 0 }),
    } as any,
  };
}

async function makeAgent(script: ModelResponse[], parallel = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jiva-par-'));
  const workspace = new WorkspaceManager({ workspaceDir: dir });
  await workspace.initialize();
  const fake = fakeOrchestrator(script);
  const agent = new CodeAgent({
    orchestrator: fake.orchestrator,
    workspace,
    lspEnabled: false,
    maxIterations: 10,
    toolExecution: { parallel, maxConcurrency: 8, resolved: true },
  });
  // A slow read-only probe tool so concurrency is observable.
  const events: string[] = [];
  const probe: ICodeTool = {
    name: 'probe',
    description: 'test probe',
    parameters: { type: 'object', properties: { n: { type: 'number' } } },
    access: () => READS_ALL,
    async execute(args) {
      events.push(`start ${args.n}`);
      await sleep(60);
      events.push(`end ${args.n}`);
      return `probe ${args.n}`;
    },
  };
  (agent as any).tools.push(probe);
  return { agent, fake, events, dir };
}

const toolMsgs = (msgs: Message[]) => msgs.filter((m) => m.role === 'tool');

test('CodeAgent: independent calls run concurrently, results keep call order', async () => {
  const { agent, fake, events } = await makeAgent([
    { content: '', toolCalls: [tc('a', 'probe', { n: 1 }), tc('b', 'probe', { n: 2 }), tc('c', 'probe', { n: 3 })] },
    { content: 'all done' },
  ]);
  const res = await agent.chat('go');
  assert.equal(res.content, 'all done');
  assert.deepEqual(events.slice(0, 3), ['start 1', 'start 2', 'start 3']);
  const second = fake.requests[1];
  assert.deepEqual(toolMsgs(second).map((m) => m.tool_call_id), ['a', 'b', 'c']);
  assert.deepEqual(toolMsgs(second).map((m) => m.content), ['probe 1', 'probe 2', 'probe 3']);
  assert.ok(res.timing && res.timing.maxBatchSize === 3, JSON.stringify(res.timing));
  assert.ok(res.timing!.parallelSavedMs > 60, JSON.stringify(res.timing));
});

test('CodeAgent: parallel disabled runs calls one by one', async () => {
  const { agent, events } = await makeAgent(
    [{ content: '', toolCalls: [tc('a', 'probe', { n: 1 }), tc('b', 'probe', { n: 2 })] }, { content: 'ok' }],
    false,
  );
  await agent.chat('go');
  assert.deepEqual(events, ['start 1', 'end 1', 'start 2', 'end 2']);
});

test('CodeAgent: doom-loop cutoff mid-batch stubs the rest and puts the note after all tool results', async () => {
  const { agent, fake } = await makeAgent([
    {
      content: '',
      toolCalls: [
        tc('a', 'probe', { n: 7 }),
        tc('b', 'probe', { n: 7 }),
        tc('c', 'probe', { n: 7 }), // third identical → doom loop
        tc('d', 'probe', { n: 8 }),
      ],
    },
    { content: 'ok' },
  ]);
  await agent.chat('go');
  const msgs = fake.requests[1];
  const tools = toolMsgs(msgs);
  assert.deepEqual(tools.map((m) => m.tool_call_id), ['a', 'b', 'c', 'd']);
  assert.match(String(tools[2].content), /doom loop/);
  assert.match(String(tools[3].content), /doom loop/);
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'user');
  assert.match(String(last.content), /STOP/);
  // Pairing repair must be a no-op: the group is already complete and contiguous.
  assert.deepEqual(ensureToolResultPairing(msgs), msgs);
});

test('CodeAgent: write then read of the same file stays ordered', async () => {
  const { agent, dir } = await makeAgent([]);
  const file = path.join(dir, 'f.txt');
  const fake = fakeOrchestrator([
    {
      content: '',
      toolCalls: [tc('w', 'write_file', { file_path: file, content: 'hello' }), tc('r', 'read_file', { path: file })],
    },
    { content: 'ok' },
  ]);
  (agent as any).orchestrator = fake.orchestrator;
  await agent.chat('go');
  const tools = toolMsgs(fake.requests[1]);
  assert.match(String(tools[1].content), /hello/);
});

test('WorkerAgent: notes (dry-run, circuit breaker) land after all tool results', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jiva-worker-'));
  const workspace = new WorkspaceManager({ workspaceDir: dir });
  await workspace.initialize();
  let calls = 0;
  const mcpManager = {
    getClient: () => ({
      getAllTools: () => [
        { name: 'fs__read_file', description: 'r', parameters: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
        { name: 'fs__edit_file', description: 'e', parameters: { type: 'object', properties: {} } },
        { name: 'fs__broken', description: 'b', parameters: { type: 'object', properties: {} } },
      ],
      async executeTool(name: string) {
        calls++;
        if (name === 'fs__broken') throw new Error('nope');
        await sleep(5);
        return `${name} ok`;
      },
    }),
  } as any;
  const fake = fakeOrchestrator([
    {
      content: '',
      toolCalls: [
        tc('1', 'fs__edit_file', { path: 'x', dryRun: true }),
        tc('2', 'fs__broken', { a: 1 }),
        tc('3', 'fs__read_file', { path: 'y' }),
      ],
    },
    { content: '', toolCalls: [tc('4', 'fs__broken', { a: 1 }), tc('5', 'fs__read_file', { path: 'z' })] },
    { content: 'finished the subtask' },
  ]);
  const worker = new WorkerAgent(fake.orchestrator, mcpManager, workspace, 5, undefined, undefined, { parallel: true, resolved: true });
  await worker.executeSubtask({ instruction: 'do things' });

  // Second request: three tool results in order, then a single user note with the dry-run reminder.
  const r2 = fake.requests[1];
  const tail2 = r2.slice(r2.findIndex((m) => m.role === 'tool'));
  assert.deepEqual(tail2.slice(0, 3).map((m) => m.tool_call_id), ['1', '2', '3']);
  assert.equal(tail2[3].role, 'user');
  assert.match(String(tail2[3].content), /dryRun/);
  // Third request: second failure of fs__broken → WARNING after both tool results.
  const r3 = fake.requests[2];
  const lastTwoTools = toolMsgs(r3).slice(-2).map((m) => m.tool_call_id);
  assert.deepEqual(lastTwoTools, ['4', '5']);
  assert.match(String(r3[r3.length - 1].content), /WARNING/);
  assert.deepEqual(ensureToolResultPairing(r3), r3);
  assert.equal(calls, 5);
});
