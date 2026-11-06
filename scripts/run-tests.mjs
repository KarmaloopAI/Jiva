#!/usr/bin/env node
/**
 * Run every `*.test.ts` under src/ with `tsx --test`.
 *
 * Replaces `tsx --test src/**\/*.test.ts`, whose unquoted glob was expanded by
 * the shell: without globstar (sh, default bash, Windows) `**` matches a single
 * directory level, so nested tests (e.g. src/code/tools/*.test.ts) silently
 * never ran. Discovery here is recursive and shell-independent.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'assets') continue;
      out.push(...findTests(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = findTests('src').sort();
const result = spawnSync('npx', ['tsx', '--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
