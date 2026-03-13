import path from 'path';
import fs from 'fs';
import type { ICodeTool, CodeToolContext } from './index.js';

const MAX_MATCHES = 100;
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB per file

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build', '.cache',
  '__pycache__', '.mypy_cache', 'target', 'vendor',
]);

export const GrepTool: ICodeTool = {
  name: 'grep',
  description: `Search for a regex pattern across files in the workspace.

REQUIRED parameter: "pattern" (string) — the regex to search for.
Example: {"pattern": "class UserService"}
Example: {"pattern": "TODO|FIXME", "include": "*.ts"}

Returns matches in the format: file:line: content`,

  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in (default: workspace root)',
      },
      include: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.ts", "*.py")',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case-insensitive search (default: false)',
      },
    },
    required: ['pattern'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const patternStr = args.pattern as string;
    const searchPath = args.path
      ? (path.isAbsolute(args.path as string) ? args.path as string : path.resolve(ctx.workspaceDir, args.path as string))
      : ctx.workspaceDir;
    const includePattern = args.include as string | undefined;
    const caseInsensitive = (args.case_insensitive as boolean) ?? false;

    let regex: RegExp;
    try {
      regex = new RegExp(patternStr, caseInsensitive ? 'i' : '');
    } catch (e) {
      return `Error: Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`;
    }

    const results: string[] = [];
    let truncated = false;

    try {
      const stat = fs.statSync(searchPath);
      if (stat.isFile()) {
        searchFile(searchPath, regex, ctx.workspaceDir, results, { max: MAX_MATCHES });
      } else {
        searchDir(searchPath, regex, ctx.workspaceDir, results, includePattern, {
          max: MAX_MATCHES,
          truncated: () => { truncated = true; },
        });
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (results.length === 0) {
      return `No matches found for: ${patternStr}`;
    }

    let output = results.join('\n');
    if (truncated) {
      output += `\n\n[Results truncated at ${MAX_MATCHES} matches. Narrow the search path or pattern.]`;
    }
    return output;
  },
};

function matchesInclude(filename: string, include?: string): boolean {
  if (!include) return true;
  // Simple glob matching: support *.ext patterns
  if (include.startsWith('*.')) {
    const ext = include.slice(1);
    return filename.endsWith(ext);
  }
  return filename.includes(include);
}

function searchFile(
  filePath: string,
  regex: RegExp,
  workspaceDir: string,
  results: string[],
  opts: { max: number },
): void {
  if (results.length >= opts.max) return;

  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return; }
  if (stat.size > MAX_FILE_SIZE) return;

  let content: string;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return; }

  const relPath = path.relative(workspaceDir, filePath);
  const lines = content.split('\n');

  for (let i = 0; i < lines.length && results.length < opts.max; i++) {
    if (regex.test(lines[i])) {
      results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

function searchDir(
  dirPath: string,
  regex: RegExp,
  workspaceDir: string,
  results: string[],
  include: string | undefined,
  opts: { max: number; truncated: () => void },
): void {
  if (results.length >= opts.max) { opts.truncated(); return; }

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (results.length >= opts.max) { opts.truncated(); return; }

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      searchDir(path.join(dirPath, entry.name), regex, workspaceDir, results, include, opts);
    } else if (entry.isFile()) {
      if (!matchesInclude(entry.name, include)) continue;
      searchFile(path.join(dirPath, entry.name), regex, workspaceDir, results, opts);
    }
  }
}
