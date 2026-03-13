import type { LspManager } from '../lsp/manager.js';

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
}

// Re-export all tools
export { ReadFileTool } from './read.js';
export { EditFileTool } from './edit.js';
export { WriteFileTool } from './write.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { BashTool } from './bash.js';
export { SpawnCodeAgentTool } from './spawn.js';
