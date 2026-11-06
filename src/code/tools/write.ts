import path from 'path';
import fs from 'fs';
import { createTwoFilesPatch, diffLines } from 'diff';
import { fileLock } from '../file-lock.js';
import { resolveToolPath, type ICodeTool, type CodeToolContext } from './index.js';
import { collectDiagnostics } from './diagnostics.js';
import { EXCLUSIVE, writesPath } from '../../core/tool-scheduler.js';

export const WriteFileTool: ICodeTool = {
  name: 'write_file',
  description: `Create a new file or completely overwrite an existing file with new content.

Use this when:
- Creating a new file from scratch
- Rewriting an entire file

Prefer edit_file for partial edits. write_file is for when you need to replace the whole file.

Returns a summary of changes and LSP diagnostics (if any errors).`,

  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to write (preferred). The alias "path" is also accepted.',
      },
      path: {
        type: 'string',
        description: 'Alias for file_path. Prefer file_path; either is accepted.',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
    },
    // Only `content` is hard-required at the schema level so that models which emit
    // the common `path` alias instead of `file_path` are not rejected by provider-side
    // tool-call validation (Groq/Sarvam). The path is validated in execute() below.
    required: ['content'],
  },

  access(args, ctx) {
    const p = resolveToolPath(args.file_path ?? args.path, ctx.workspaceDir);
    return p ? writesPath(p) : EXCLUSIVE;
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const rawPath = (args.file_path ?? args.path) as string | undefined;
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return 'Error: file_path is required — provide the absolute path to the file to write.';
    }
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);
    const content = args.content as string;

    const locked = await fileLock.withLock(filePath, async (): Promise<{ ok: boolean; text: string }> => {
      // Read existing content for diff
      let before = '';
      const existed = fs.existsSync(filePath);
      if (existed) {
        try {
          before = fs.readFileSync(filePath, 'utf-8');
        } catch {
          before = '';
        }
      }

      // Write the file
      try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
      } catch (e) {
        return { ok: false, text: `Error writing file: ${e instanceof Error ? e.message : String(e)}` };
      }

      // Count changes
      let additions = 0;
      let deletions = 0;
      for (const change of diffLines(before, content)) {
        if (change.added) additions += change.count ?? 0;
        if (change.removed) deletions += change.count ?? 0;
      }

      const relPath = path.relative(ctx.workspaceDir, filePath);
      const action = existed ? 'Updated' : 'Created';

      return { ok: true, text: `${action} ${relPath} (+${additions}/-${deletions} lines).` };
    });

    if (!locked.ok) return locked.text;
    // Diagnostics outside the lock — see edit.ts.
    return locked.text + (await collectDiagnostics(ctx, filePath));
  },
};
