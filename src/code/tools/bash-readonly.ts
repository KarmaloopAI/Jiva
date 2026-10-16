/**
 * Conservative read-only detection for shell commands.
 *
 * Used only to decide whether a `bash` call may run concurrently with other
 * read-only calls. Any doubt ⇒ false (the call then runs alone, exactly as
 * before). This is NOT a security boundary — it never blocks a command, it
 * only decides scheduling.
 *
 * Accepted: a single command, or a pipeline of commands, where every command
 * is on the allowlist (with per-command argument checks) and the line contains
 * no redirection, substitution, backgrounding, chaining or newlines.
 */

/** Characters/sequences that make a command non-trivial to reason about. */
const FORBIDDEN = [
  '>', '<', '`', '$(', '${', ';', '&', '\n', '\r', '||',
];

/** Commands that only read state, regardless of (non-forbidden) arguments. */
const ALWAYS_READONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'pwd', 'echo',
  'which', 'file', 'stat', 'tree', 'du', 'df', 'basename', 'dirname', 'realpath',
  'sort', 'uniq', 'cut', 'tr', 'nl', 'diff', 'cmp', 'md5sum', 'sha256sum', 'shasum',
]);

/** Per-command arguments that make an otherwise read-only command write or execute. */
const ARG_DENY: Record<string, (a: string) => boolean> = {
  sort: (a) => a === '-o' || a.startsWith('--output'),
  tree: (a) => a === '-o',
  rg: (a) => a.startsWith('--pre'),
  file: (a) => a === '-C' || a === '--compile',
};

/** git subcommands that never modify the repository or working tree. */
const GIT_READONLY = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'describe',
  'shortlog', 'cat-file', 'ls-tree', 'grep',
]);

/** find actions that write or execute. */
const FIND_FORBIDDEN = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);

/** Split a command into whitespace-separated words, honouring simple quotes. */
function splitWords(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        words.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (quote) return null; // unbalanced quotes
  if (cur) words.push(cur);
  return words;
}

function isReadOnlySimpleCommand(segment: string): boolean {
  const words = splitWords(segment.trim());
  if (!words || words.length === 0) return false;
  // Leading env assignments (FOO=bar cmd) are rejected — keep it simple.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return false;

  const [cmd, ...args] = words;
  if (ALWAYS_READONLY.has(cmd)) {
    const deny = ARG_DENY[cmd];
    return !deny || !args.some((a) => deny(a) || (a.startsWith('-o') && cmd === 'sort'));
  }

  if (cmd === 'find') {
    return !args.some((a) => FIND_FORBIDDEN.has(a));
  }

  if (cmd === 'git') {
    // Skip global options like `-C dir`, `--no-pager`; reject anything we don't know.
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) {
      // `-c key=val` is rejected: it can set core.pager/aliases that execute commands.
      if (args[i] === '-C') i += 2;
      else if (args[i] === '--no-pager') i += 1;
      else return false;
    }
    const sub = args[i];
    if (!sub) return false;
    if (sub === 'branch') {
      // `git branch` / `git branch -a|-r|--list|-v` only; any name argument would create a branch.
      return args.slice(i + 1).every((a) => ['-a', '-r', '-v', '-vv', '--list', '--all', '--remotes', '--show-current'].includes(a));
    }
    if (sub === 'stash') return args[i + 1] === 'list';
    // `--output=<file>` (diff/log/show) writes a file; `--ext-diff`/`--textconv` can run external programs.
    if (args.slice(i + 1).some((a) => a.startsWith('--output') || a === '--ext-diff' || a === '--textconv')) return false;
    return GIT_READONLY.has(sub);
  }

  return false;
}

/**
 * True when `command` only reads state and is safe to run concurrently with
 * other read-only tool calls. Always false on Windows (commands run in
 * PowerShell there, whose syntax this does not model).
 */
export function isReadOnlyCommand(command: unknown, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') return false;
  if (typeof command !== 'string') return false;
  const cmd = command.trim();
  if (!cmd || cmd.length > 2000) return false;
  if (FORBIDDEN.some((f) => cmd.includes(f))) return false;
  // Pipelines: every stage must be read-only. (`||` was rejected above.)
  return cmd.split('|').every((segment) => isReadOnlySimpleCommand(segment));
}
