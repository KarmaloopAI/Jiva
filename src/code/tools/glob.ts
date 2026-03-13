import path from 'path';
import fs from 'fs';
import type { ICodeTool, CodeToolContext } from './index.js';

export const GlobTool: ICodeTool = {
  name: 'glob',
  description: `Find files matching a glob pattern.

Examples:
- "**/*.ts" — all TypeScript files
- "src/**/*.test.ts" — all test files under src/
- "*.json" — JSON files in the workspace root

Returns file paths relative to the workspace directory, sorted by modification time (newest first).`,

  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.js")',
      },
      cwd: {
        type: 'string',
        description: 'Directory to search in (default: workspace root)',
      },
    },
    required: ['pattern'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const pattern = args.pattern as string;
    const cwd = args.cwd
      ? (path.isAbsolute(args.cwd as string) ? args.cwd as string : path.resolve(ctx.workspaceDir, args.cwd as string))
      : ctx.workspaceDir;

    try {
      // Use Node.js built-in glob (available in Node 22+) or fall back to manual walk
      const { glob } = await import('glob');
      const matches = await glob(pattern, {
        cwd,
        nodir: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'],
      });

      if (matches.length === 0) {
        return `No files found matching pattern: ${pattern}`;
      }

      // Sort by mtime (newest first)
      const withMtime = matches
        .map((f) => {
          try {
            const stat = fs.statSync(path.join(cwd, f));
            return { file: f, mtime: stat.mtimeMs };
          } catch {
            return { file: f, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);

      return withMtime.map((f) => f.file).join('\n');
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
