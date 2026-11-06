/**
 * Process guard — keeps the agent from killing the process it runs in.
 *
 * jiva-core runs inside a Node.js process: the `jiva` CLI, the HTTP server,
 * or an embedding app such as Jivam (where jiva-core lives *inside the Jivam
 * server process*). A model that "cleans up" with `pkill node` or
 * `lsof -ti :7842 | xargs kill` kills that process — and with it the very
 * agent that issued the command.
 *
 * Two layers use this module:
 *   1. Prompt: `describeHostForPrompt()` tells the model who it is (PID, host,
 *      protected ports) and how to stop processes safely.
 *   2. Enforcement: `checkShellCommand()` is called before every shell
 *      execution (code-mode `bash` tool and shell-type MCP tools in
 *      `MCPClient.executeTool`) and refuses commands that would hit this
 *      process — regardless of what the model decides.
 *
 * Host identity is process-wide (one process, one identity). Embedding apps
 * call `registerHostIdentity()` once at startup; everything else gets the
 * default derived from `process`.
 */

import { splitSegments, splitWords } from '../code/tools/shell-parse.js';

export interface HostIdentity {
  /** Human name of the host application, e.g. "Jivam" or "jiva CLI". */
  name: string;
  /** Runtime the host runs on. */
  framework: 'node';
  /** PID of the process jiva-core runs in. */
  pid: number;
  /** Parent PID (supervisor / terminal / launchd). */
  ppid: number;
  /** TCP ports this process serves (killing whatever listens there kills us). */
  ports: number[];
  /** Other PIDs the host wants protected (e.g. a supervisor). */
  extraPids: number[];
}

let host: HostIdentity = {
  name: 'jiva',
  framework: 'node',
  pid: process.pid,
  ppid: process.ppid,
  ports: [],
  extraPids: [],
};

/** Register (or extend) the host identity. Call once from the embedding app. */
export function registerHostIdentity(partial: Partial<Omit<HostIdentity, 'framework'>>): HostIdentity {
  host = {
    ...host,
    ...partial,
    framework: 'node',
    pid: partial.pid ?? process.pid,
    ppid: partial.ppid ?? process.ppid,
    ports: [...new Set([...(partial.ports ?? host.ports)])].filter((p) => Number.isInteger(p) && p > 0),
    extraPids: [...new Set([...(partial.extraPids ?? host.extraPids)])].filter((p) => Number.isInteger(p) && p > 1),
  };
  return host;
}

export function getHostIdentity(): HostIdentity {
  return host;
}

export type ShellCheck =
  | { blocked: false }
  | { blocked: true; reason: string; suggestion: string };

/** Names that identify Node.js / this framework's processes. */
const NODE_NAME_RE = /(^|[\s/\\"'=])(node(js)?(\.exe)?|npm|npx|tsx|ts-node|jiva|jivam|jiva-core|jivamai)($|[\s"'.:])/i;

const SAFE_SUGGESTION =
  'Stop only the specific process you started: use its PID (e.g. from `$!` or `pgrep -f "<your exact script>"` ' +
  'and confirm it is not this agent), or free the port of the dev server you launched (e.g. `lsof -ti :3000 | xargs kill`).';

function protectedPids(h: HostIdentity): Set<number> {
  return new Set([h.pid, h.ppid, ...h.extraPids].filter((p) => p > 1));
}

function block(reason: string, h: HostIdentity = host): ShellCheck {
  return {
    blocked: true,
    reason:
      `Refused: ${reason}. This agent runs inside ${h.name} (Node.js, PID ${h.pid}` +
      `${h.ports.length ? `, serving port${h.ports.length > 1 ? 's' : ''} ${h.ports.join(', ')}` : ''}); ` +
      `that command would kill it.`,
    suggestion: SAFE_SUGGESTION,
  };
}

/** Does this segment *select* Node/framework processes (pgrep/pidof/ps|grep …)? */
function selectsNodeProcesses(segment: string): boolean {
  const words = splitWords(segment) ?? segment.split(/\s+/);
  const cmd = words[0]?.toLowerCase();
  if (cmd === 'pgrep' || cmd === 'pidof') return words.slice(1).some((w) => !w.startsWith('-') && NODE_NAME_RE.test(` ${w} `));
  if (cmd === 'grep' || cmd === 'egrep' || cmd === 'rg') return words.slice(1).some((w) => !w.startsWith('-') && NODE_NAME_RE.test(` ${w} `));
  if (cmd === 'lsof' && words.includes('-c')) return NODE_NAME_RE.test(` ${words[words.indexOf('-c') + 1] ?? ''} `);
  return false;
}

/** Does this segment select whatever listens on a protected port? */
function selectsProtectedPort(segment: string, ports: number[]): number | undefined {
  if (ports.length === 0) return undefined;
  const words = (splitWords(segment) ?? segment.split(/\s+/)).map((w) => w.toLowerCase());
  const cmd = words[0];
  if (cmd !== 'lsof' && cmd !== 'fuser' && cmd !== 'ss' && cmd !== 'netstat') return undefined;
  for (const p of ports) {
    if (words.some((w) => w === `:${p}` || w.endsWith(`:${p}`) || w === `${p}/tcp` || w === `tcp:${p}` || w === String(p))) return p;
  }
  return undefined;
}

/** Targets of a `kill` invocation (signal spec and options removed). */
function killTargets(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  if (args[i] === '-s' || args[i] === '-n' || args[i] === '--signal') i += 2;
  else if (args[i]?.startsWith('-') && args.length > 1 && /^-([A-Za-z]+|\d+)$/.test(args[i])) i += 1;
  for (; i < args.length; i++) {
    if (args[i] === '--') continue;
    out.push(args[i]);
  }
  return out;
}

/** True when a segment is a "kill" sink fed by a pipeline (xargs kill, | kill). */
function isKillSink(segment: string): boolean {
  const words = splitWords(segment) ?? segment.split(/\s+/);
  const cmd = words[0]?.toLowerCase();
  if (cmd === 'kill') return true;
  if (cmd === 'xargs') return words.slice(1).some((w) => w === 'kill' || w === 'pkill' || w.endsWith('/kill'));
  if (cmd === 'stop-process' || cmd === 'spps') return true;
  return false;
}

/**
 * Check a shell command line before it runs. Never throws; returns
 * `{ blocked: false }` for anything not recognised as a self-kill.
 */
export function checkShellCommand(command: unknown, h: HostIdentity = host): ShellCheck {
  if (typeof command !== 'string' || !command.trim()) return { blocked: false };
  const pids = protectedPids(h);
  const segments = splitSegments(command);

  // Command substitution feeding kill: kill $(pgrep node), kill `pidof node`, kill -9 $(lsof -ti :7842)
  const subst = command.match(/\bkill\b[^\n;|&]*?(\$\(([^)]*)\)|`([^`]*)`)/i);
  if (subst) {
    const inner = subst[2] ?? subst[3] ?? '';
    if (splitSegments(inner).some(selectsNodeProcesses)) return block('it kills every Node.js process selected by name', h);
    const port = splitSegments(inner).map((s) => selectsProtectedPort(s, h.ports)).find((p) => p !== undefined);
    if (port !== undefined) return block(`it kills the process listening on port ${port}`, h);
  }
  if (/\bkill\b[^\n;|&]*\$PPID\b/.test(command)) return block('it kills the parent of the shell, which is this agent\'s process', h);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const words = splitWords(seg) ?? seg.split(/\s+/);
    if (words.length === 0) continue;
    // Strip leading sudo / env assignments
    let k = 0;
    while (k < words.length && (words[k] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]))) k++;
    const cmd = (words[k] ?? '').toLowerCase().replace(/^.*[\\/]/, '');
    const args = words.slice(k + 1);

    // pkill / killall by name
    if (cmd === 'pkill' || cmd === 'killall') {
      if (args.includes('-u') || args.includes('--user')) return block(`\`${cmd} -u\` kills every process of the user`, h);
      if (args.some((a) => !a.startsWith('-') && NODE_NAME_RE.test(` ${a} `))) {
        return block(`\`${cmd}\` would kill Node.js processes by name`, h);
      }
    }

    // kill with explicit targets: kill [-SIG | -s SIG | -n N] target...
    if (cmd === 'kill') {
      const targets = killTargets(args);
      if (targets.includes('-1')) return block('`kill -1` targets every process you own', h);
      if (targets.includes('0')) return block('`kill 0` targets this process group', h);
      const hit = targets.map(Number).find((n) => Number.isInteger(n) && pids.has(n));
      if (hit !== undefined) return block(`PID ${hit} is this agent's own process (or its parent)`, h);
    }

    // Pipelines: <select node | protected port> | ... | xargs kill
    if (isKillSink(seg) && i > 0) {
      const upstream = segments.slice(0, i);
      if (upstream.some(selectsNodeProcesses)) return block('the pipeline kills every Node.js process selected by name', h);
      const port = upstream.map((s) => selectsProtectedPort(s, h.ports)).find((p) => p !== undefined);
      if (port !== undefined) return block(`the pipeline kills the process listening on port ${port}`, h);
    }

    // fuser -k <port>/tcp, npx kill-port <port>
    if (cmd === 'fuser' && args.includes('-k')) {
      const port = selectsProtectedPort(seg, h.ports);
      if (port !== undefined) return block(`it kills the process listening on port ${port}`, h);
    }
    const killPortIdx = words.findIndex((w) => w === 'kill-port' || w.endsWith('/kill-port'));
    if (killPortIdx >= 0) {
      const hit = words.slice(killPortIdx + 1).map(Number).find((p) => h.ports.includes(p));
      if (hit !== undefined) return block(`it kills the process listening on port ${hit}`, h);
    }

    // Windows: taskkill /IM node.exe | /PID <ours>; PowerShell Stop-Process -Name node
    if (cmd === 'taskkill' || cmd === 'taskkill.exe') {
      const lower = args.map((a) => a.toLowerCase());
      const im = lower.indexOf('/im');
      if (im >= 0 && NODE_NAME_RE.test(` ${lower[im + 1] ?? ''} `)) return block('`taskkill /IM node.exe` kills every Node.js process', h);
      const pid = lower.indexOf('/pid');
      if (pid >= 0 && pids.has(Number(lower[pid + 1]))) return block(`PID ${lower[pid + 1]} is this agent's own process`, h);
    }
    if (cmd === 'stop-process' || cmd === 'spps') {
      const lower = args.map((a) => a.toLowerCase());
      const name = lower.findIndex((a) => a === '-name' || a === '-processname');
      if (name >= 0 && NODE_NAME_RE.test(` ${lower[name + 1] ?? ''} `)) return block('`Stop-Process -Name node` kills every Node.js process', h);
      const id = lower.findIndex((a) => a === '-id');
      if (id >= 0 && pids.has(Number(lower[id + 1]))) return block(`PID ${lower[id + 1]} is this agent's own process`, h);
    }
    if ((cmd === 'get-process' || cmd === 'gps') && args.some((a) => NODE_NAME_RE.test(` ${a} `)) && segments.slice(i + 1).some(isKillSink)) {
      return block('the pipeline stops every Node.js process', h);
    }
  }

  return { blocked: false };
}

/** Tool names (MCP or built-in) that execute shell commands with a `command` argument. */
export function isShellToolName(toolName: string): boolean {
  const base = toolName.includes('__') ? toolName.slice(toolName.lastIndexOf('__') + 2) : toolName;
  return /^(shell_exec|run_command|execute_command|exec_command|run_shell_command|shell|bash|terminal|run_terminal_command)$/i.test(base);
}

/** Paragraph for system prompts: who the agent is and how to stop processes safely. */
export function describeHostForPrompt(h: HostIdentity = host): string {
  const ports = h.ports.length ? ` It serves port${h.ports.length > 1 ? 's' : ''} ${h.ports.join(', ')}.` : '';
  return (
    `PROCESS SAFETY: You are running inside ${h.name}, a Node.js process (PID ${h.pid}, parent PID ${h.ppid}).${ports} ` +
    `Killing that process kills you mid-task. NEVER kill processes by name or broadly — no \`pkill node\`, ` +
    `\`pkill -f node\`, \`killall node\`, \`kill $(pgrep node)\`, \`taskkill /IM node.exe\`` +
    `${h.ports.length ? `, and never kill whatever listens on port ${h.ports.join('/')}` : ''}. ` +
    `To stop something you started, kill its specific PID or free the port of that specific dev server. ` +
    `Such commands are refused by a guard anyway.`
  );
}
