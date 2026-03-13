import path from 'path';
import fs from 'fs';
import type { ICodeTool, CodeToolContext } from './index.js';

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024; // 50KB

export const ReadFileTool: ICodeTool = {
  name: 'read_file',
  description: `Read the contents of a file or list a directory.

REQUIRED parameter: "path" (string) — absolute path to file or directory.
Example: {"path": "/workspace/src/index.ts"}
Example: {"path": "/workspace/src/index.ts", "offset": 100, "limit": 50}

Do NOT pass "command", "query", or "pattern" to this tool — use bash or grep for those.

For files:
- Returns file content with line numbers (cat -n style)
- Limits to ${MAX_LINES} lines and ${MAX_BYTES / 1024}KB
- Use offset and limit to paginate large files
- Binary files return "[binary file, cannot display]"

For directories:
- Returns a listing with [FILE] and [DIR] prefixes`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file or directory to read',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed, default: 1)',
      },
      limit: {
        type: 'number',
        description: `Max lines to read (default: ${MAX_LINES})`,
      },
    },
    required: ['path'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const rawPath = args.path as string;
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return `Error: Path not found: ${filePath}`;
    }

    if (stat.isDirectory()) {
      return listDirectory(filePath);
    }

    return readFile(filePath, args.offset as number | undefined, args.limit as number | undefined);
  },
};

function listDirectory(dirPath: string): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return `Error reading directory: ${e instanceof Error ? e.message : String(e)}`;
  }

  const lines: string[] = [`Directory: ${dirPath}`, ''];
  entries.sort((a, b) => {
    // Dirs first, then files, alphabetically
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const tag = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    lines.push(`${tag} ${entry.name}`);
  }
  return lines.join('\n');
}

function readFile(filePath: string, offset?: number, limit?: number): string {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (e) {
    return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Binary detection: look for null bytes in the first 8KB
  if (isBinary(buffer)) {
    return `[binary file: ${filePath}]`;
  }

  // Enforce byte limit
  let text = buffer.slice(0, MAX_BYTES).toString('utf-8');
  const wasTruncatedByBytes = buffer.length > MAX_BYTES;

  const allLines = text.split('\n');
  const startLine = Math.max(1, (offset ?? 1));
  const maxLines = Math.min(limit ?? MAX_LINES, MAX_LINES);
  const slice = allLines.slice(startLine - 1, startLine - 1 + maxLines);

  const truncatedByLines = startLine - 1 + maxLines < allLines.length;

  const numbered = slice.map((line, i) => {
    const lineNo = String(startLine + i).padStart(6);
    return `${lineNo}\t${line}`;
  });

  let result = numbered.join('\n');

  if (wasTruncatedByBytes) {
    result += `\n\n[File truncated at ${MAX_BYTES / 1024}KB. Use offset/limit to read more.]`;
  } else if (truncatedByLines) {
    const remaining = allLines.length - (startLine - 1 + maxLines);
    result += `\n\n[${remaining} more line(s). Use offset=${startLine + maxLines} to continue.]`;
  }

  return result;
}

function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(8192, buffer.length);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
