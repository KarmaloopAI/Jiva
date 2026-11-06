import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShellCommand, isShellToolName, describeHostForPrompt, type HostIdentity } from './process-guard.js';

const host: HostIdentity = { name: 'Jivam', framework: 'node', pid: 4242, ppid: 4200, ports: [7842], extraPids: [5150] };
const blocked = (c: string) => checkShellCommand(c, host).blocked;

test('broad Node.js kills are refused', () => {
  for (const c of [
    'pkill node',
    'pkill -9 node',
    'pkill -f node',
    'pkill -f "npm run dev"',
    'pkill -f tsx',
    'sudo pkill node',
    'killall node',
    'killall -9 node',
    'pkill -f jivam',
    'kill $(pgrep node)',
    'kill -9 $(pgrep -f node)',
    'kill `pidof node`',
    'pgrep node | xargs kill',
    'pgrep -f node | xargs -r kill -9',
    'ps aux | grep node | awk \'{print $2}\' | xargs kill -9',
    'taskkill /IM node.exe /F',
    'taskkill /F /IM node.exe',
    'Stop-Process -Name node -Force',
    'Get-Process node | Stop-Process',
    'cd app && pkill node && npm start',
  ]) {
    assert.equal(blocked(c), true, c);
  }
});

test('kills aimed at this process, its parent, protected PIDs or ports are refused', () => {
  for (const c of [
    'kill 4242',
    'kill -9 4242',
    'kill -s TERM 4200',
    'kill 5150',
    'kill $PPID',
    'kill -9 -1',
    'kill 0',
    'lsof -ti :7842 | xargs kill',
    'lsof -t -i:7842 | xargs kill -9',
    'kill -9 $(lsof -ti :7842)',
    'fuser -k 7842/tcp',
    'npx kill-port 7842',
    'taskkill /PID 4242 /F',
  ]) {
    assert.equal(blocked(c), true, c);
  }
});

test('targeted, unrelated process management is allowed', () => {
  for (const c of [
    'kill 12345',
    'kill -9 12345',
    'kill -HUP 777',
    'lsof -ti :3000 | xargs kill',
    'kill $(lsof -ti :5173)',
    'fuser -k 3000/tcp',
    'npx kill-port 3000',
    'pkill -f vite',
    'pkill -f "python manage.py runserver"',
    'killall Safari',
    'npm test',
    'node scripts/build.mjs',
    'pgrep -f node',
    'ps aux | grep node',
    'git status',
    '',
  ]) {
    assert.equal(blocked(c), false, c);
  }
});

test('refusal explains why and what to do instead', () => {
  const r = checkShellCommand('pkill node', host);
  assert.equal(r.blocked, true);
  if (r.blocked) {
    assert.match(r.reason, /Jivam/);
    assert.match(r.reason, /4242/);
    assert.match(r.suggestion, /PID/);
  }
});

test('shell tool detection and prompt paragraph', () => {
  assert.equal(isShellToolName('mcp-shell-server__shell_exec'), true);
  assert.equal(isShellToolName('bash'), true);
  assert.equal(isShellToolName('filesystem__read_file'), false);
  const text = describeHostForPrompt(host);
  assert.match(text, /PID 4242/);
  assert.match(text, /7842/);
  assert.match(text, /pkill node/);
});

test('bash tool and MCP shell tools refuse self-kills without executing anything', async () => {
  const { BashTool } = await import('../code/tools/bash.js');
  const { MCPClient } = await import('../mcp/client.js');
  const out = await BashTool.execute({ command: 'pkill node' }, { workspaceDir: process.cwd(), lsp: {} as any });
  assert.match(out, /^Error: Refused/);

  const client = new MCPClient();
  await assert.rejects(
    () => client.executeTool('mcp-shell-server__shell_exec', { command: 'killall node' }),
    /Refused/,
  );
  // Non-shell tools and harmless commands are not intercepted (fails later only because nothing is connected)
  await assert.rejects(
    () => client.executeTool('mcp-shell-server__shell_exec', { command: 'ls' }),
    /not connected/,
  );
});
