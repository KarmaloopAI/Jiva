/**
 * Minimal shell-word helpers shared by the read-only classifier
 * (bash-readonly.ts) and the process guard (core/process-guard.ts).
 * Deliberately simple: quotes are honoured, everything else is literal.
 */

/** Split a command into whitespace-separated words, honouring simple quotes. Returns null on unbalanced quotes. */
export function splitWords(cmd: string): string[] | null {
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

/**
 * Split a command line into simple-command segments on `;`, `&&`, `||`, `|`,
 * `&` and newlines (outside quotes). Pipelines are split too — callers that
 * care about pipelines look at neighbouring segments.
 */
export function splitSegments(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '|' || ch === '&') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      // swallow the second char of && / ||
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
