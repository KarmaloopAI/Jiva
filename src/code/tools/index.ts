import path from 'path';
import type { LspManager } from '../lsp/manager.js';
import type { ToolAccess } from '../../core/tool-scheduler.js';

export interface CodeToolContext {
  workspaceDir: string;
  lsp: LspManager;
  signal?: AbortSignal;
  /** Current agent depth — used by spawn tool to limit recursion */
  depth?: number;
  /** Max allowed depth */
  maxDepth?: number;
  /** Callback to spawn a child CodeAgent (injected by CodeAgent) */
  spawnChildAgent?: (task: string, context?: string) => Promise<string>;
}

export interface ICodeTool {
  name: string;
  description: string;
  /** JSON Schema object for tool parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>, ctx: CodeToolContext): Promise<string>;
  /**
   * What this call touches, used by the tool scheduler to decide which calls
   * in one model turn may run concurrently. Omitted ⇒ exclusive (runs alone).
   * See src/core/tool-scheduler.ts.
   */
  access?(args: Record<string, unknown>, ctx: { workspaceDir: string }): ToolAccess;
}

/** Resolve a tool's path argument the same way the tools themselves do. */
export function resolveToolPath(raw: unknown, workspaceDir: string): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(workspaceDir, raw);
}

// Re-export all tools
export { ReadFileTool } from './read.js';
export { EditFileTool } from './edit.js';
export { WriteFileTool } from './write.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { BashTool } from './bash.js';
export { SpawnCodeAgentTool } from './spawn.js';
