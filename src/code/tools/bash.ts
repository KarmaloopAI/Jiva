import { exec } from 'child_process';
import type { ICodeTool, CodeToolContext } from './index.js';

const DEFAULT_TIMEOUT = 30_000; // 30s
const MAX_TIMEOUT = 300_000; // 5 min

// Output limits — same as read_file to keep model context manageable
const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB

export const BashTool: ICodeTool = {
  name: 'bash',
  description: `Execute a shell command in the workspace directory.

REQUIRED parameter: "command" (string) — the shell command to run.
Example: {"command": "git status"}
Example: {"command": "npm test", "timeout_ms": 60000}

Do NOT pass "path", "limit", "offset", or "query" to this tool — use read_file or grep for those.

Use for:
- Running build commands (npm run build, go build, cargo build)
- Running tests (npm test, pytest, go test ./...)
- Running linters (eslint, pylint, ruff)
- Git operations (git status, git diff --staged)
- Installing dependencies

Returns: stdout + stderr combined, plus exit code.
Commands timeout after ${DEFAULT_TIMEOUT / 1000}s by default (configurable up to ${MAX_TIMEOUT / 1000}s).
Output is truncated at ${MAX_OUTPUT_LINES} lines / ${MAX_OUTPUT_BYTES / 1024}KB.`,

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute (e.g. "git diff --staged", "npm test")',
      },
      timeout_ms: {
        type: 'number',
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`,
      },
    },
    required: ['command'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const command = args.command as string;
    const timeout = Math.min((args.timeout_ms as number) || DEFAULT_TIMEOUT, MAX_TIMEOUT);

    return new Promise<string>((resolve) => {
      const proc = exec(command, {
        cwd: ctx.workspaceDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB raw buffer; we truncate before returning
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        const output: string[] = [];

        if (stdout.trim()) output.push(stdout.trim());
        if (stderr.trim()) output.push(`[stderr]\n${stderr.trim()}`);

        if (error) {
          if (error.killed) {
            output.push(`\n[Command timed out after ${timeout / 1000}s]`);
          } else if (error.code !== undefined && error.code !== 0) {
            output.push(`\n[Exit code: ${error.code}]`);
          }
        }

        const raw = output.join('\n') || '(no output)';
        resolve(truncateOutput(raw));
      });

      // Abort signal support
      if (ctx.signal) {
        ctx.signal.addEventListener('abort', () => {
          try { proc.kill(); } catch { /* ignore */ }
        }, { once: true });
      }
    });
  },
};

/**
 * Truncate command output to MAX_OUTPUT_LINES lines and MAX_OUTPUT_BYTES bytes.
 * Mirrors the limits in read_file so the model context stays manageable.
 * Truncation note is appended so the model knows output was cut.
 */
function truncateOutput(text: string): string {
  // Byte limit first — apply to raw text
  let result = text;
  let bytesTruncated = false;
  if (Buffer.byteLength(result, 'utf-8') > MAX_OUTPUT_BYTES) {
    // Slice to byte limit, then back up to the last complete line
    const buf = Buffer.from(result, 'utf-8').subarray(0, MAX_OUTPUT_BYTES);
    result = buf.toString('utf-8');
    // Trim to last newline to avoid split multibyte char
    const lastNl = result.lastIndexOf('\n');
    if (lastNl > 0) result = result.substring(0, lastNl);
    bytesTruncated = true;
  }

  // Line limit
  const lines = result.split('\n');
  if (lines.length > MAX_OUTPUT_LINES) {
    const kept = lines.slice(0, MAX_OUTPUT_LINES);
    const dropped = lines.length - MAX_OUTPUT_LINES;
    result = kept.join('\n') + `\n\n[Output truncated: ${dropped} more line(s) not shown. Narrow the command or redirect output to a file.]`;
  } else if (bytesTruncated) {
    result += `\n\n[Output truncated at ${MAX_OUTPUT_BYTES / 1024}KB. Redirect output to a file to capture everything.]`;
  }

  return result;
}
