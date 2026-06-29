/**
 * Deterministic verifier — runs Node's built-in test runner against a workspace
 * and reports pass/fail. No external test framework, no network.
 *
 * Two checks gate a pass:
 *   1. Tamper check — the protected test files must be byte-identical to what was
 *      scaffolded. If the agent edited a test to make it pass, the task fails
 *      with reason `tests-modified`.
 *   2. Test run — `node --test` must exit 0 with at least one passing test and
 *      zero failures.
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { VerifyResult } from './types.js';

/** Read a workspace file, returning null if it is missing. */
async function tryRead(workspaceDir: string, relPath: string): Promise<string | null> {
  try {
    return await readFile(join(workspaceDir, relPath), 'utf-8');
  } catch {
    return null;
  }
}

/** Parse `# pass N` / `# fail N` from Node's TAP-ish test output. */
function parseCounts(output: string): { passed: number; failed: number } {
  const pass = output.match(/^# pass (\d+)/m);
  const fail = output.match(/^# fail (\d+)/m);
  return {
    passed: pass ? parseInt(pass[1], 10) : 0,
    failed: fail ? parseInt(fail[1], 10) : 0,
  };
}

/** Parse failing top-level test names from the TAP `not ok N - <name>` lines. */
function parseFailingTests(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^not ok \d+ - (.+?)(?: # .*)?$/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

/**
 * Run the verifier.
 *
 * @param workspaceDir absolute path of the task workspace
 * @param protectedFiles map of relative path → original content (the scaffolded tests)
 * @param timeoutMs hard cap for the test process
 */
export async function runNodeTests(
  workspaceDir: string,
  protectedFiles: Record<string, string>,
  timeoutMs = 60_000,
): Promise<VerifyResult> {
  // 1. Tamper check.
  for (const [relPath, original] of Object.entries(protectedFiles)) {
    const current = await tryRead(workspaceDir, relPath);
    if (current === null) {
      return { passed: false, testsPassed: 0, testsFailed: 0, failingTests: [], reason: 'tests-modified', output: `Protected test file was removed: ${relPath}` };
    }
    if (current !== original) {
      return { passed: false, testsPassed: 0, testsFailed: 0, failingTests: [], reason: 'tests-modified', output: `Protected test file was modified: ${relPath}` };
    }
  }

  // 2. Run `node --test`, scoped to ONLY the canonical protected test files.
  // Bare `node --test` discovers any test file in the workspace, so an agent's own
  // scratch tests would pollute the counts and could cause false failures. Passing the
  // protected paths explicitly makes scoring depend solely on the canonical suite.
  const testPaths = Object.keys(protectedFiles);
  const args = testPaths.length > 0 ? ['--test', ...testPaths] : ['--test'];
  return new Promise<VerifyResult>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: workspaceDir,
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    let out = '';
    const append = (buf: Buffer) => {
      out += buf.toString();
      if (out.length > 200_000) out = out.slice(-200_000); // cap memory
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ passed: false, testsPassed: 0, testsFailed: 0, failingTests: parseFailingTests(out), reason: 'timeout', output: trimOutput(out) });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ passed: false, testsPassed: 0, testsFailed: 0, failingTests: [], reason: 'runner-error', output: `${err.message}\n${trimOutput(out)}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const { passed, failed } = parseCounts(out);
      const ok = code === 0 && failed === 0 && passed > 0;
      resolve({
        passed: ok,
        testsPassed: passed,
        testsFailed: failed,
        failingTests: parseFailingTests(out),
        reason: ok ? undefined : 'tests-failed',
        output: trimOutput(out),
      });
    });
  });
}

/** Keep the most relevant tail of the runner output for diagnostics. */
function trimOutput(out: string): string {
  const max = 4_000;
  return out.length > max ? out.slice(-max) : out;
}
