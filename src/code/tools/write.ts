import path from 'path';
import fs from 'fs';
import { createTwoFilesPatch, diffLines } from 'diff';
import { fileLock } from '../file-lock.js';
import type { ICodeTool, CodeToolContext } from './index.js';

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
        description: 'Absolute path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const rawPath = args.file_path as string;
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);
    const content = args.content as string;

    return fileLock.withLock(filePath, async () => {
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
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
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

      // LSP diagnostics
      let diagnosticsOutput = '';
      try {
        await ctx.lsp.touchFile(filePath);
        const errors = ctx.lsp.getErrorsForFile(filePath);
        if (errors) {
          diagnosticsOutput = `\n\nLSP errors detected — please fix:\n<diagnostics file="${filePath}">\n${errors}\n</diagnostics>`;
        }
      } catch {
        // LSP should not block the write result
      }

      return `${action} ${relPath} (+${additions}/-${deletions} lines).${diagnosticsOutput}`;
    });
  },
};
