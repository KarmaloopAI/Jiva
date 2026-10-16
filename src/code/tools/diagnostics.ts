import type { CodeToolContext } from './index.js';

/**
 * Notify the LSP that `filePath` changed and format any errors for the model.
 * Called by edit_file / write_file after the file lock is released. Never
 * throws — diagnostics are advisory and must not fail the edit.
 */
export async function collectDiagnostics(ctx: CodeToolContext, filePath: string): Promise<string> {
  try {
    await ctx.lsp.touchFile(filePath);
    const errors = ctx.lsp.getErrorsForFile(filePath);
    if (errors) {
      return `\n\nLSP errors detected — please fix:\n<diagnostics file="${filePath}">\n${errors}\n</diagnostics>`;
    }
  } catch {
    // LSP errors should not block the edit result
  }
  return '';
}
