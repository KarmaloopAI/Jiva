/**
 * Builds a minimal CodeAgent for a single benchmark task.
 *
 * The agent is deliberately stripped down — no MCP servers, no persona, no
 * conversation persistence, LSP off by default — so the benchmark measures the
 * model's raw code-mode capability with as little environmental variance as
 * possible.
 */

import { CodeAgent } from '../agent.js';
import { WorkspaceManager } from '../../core/workspace.js';
import type { ModelOrchestrator } from '../../models/orchestrator.js';

export interface BenchmarkAgentOptions {
  orchestrator: ModelOrchestrator;
  workspaceDir: string;
  maxIterations: number;
  lspEnabled?: boolean;
}

export async function buildBenchmarkAgent(opts: BenchmarkAgentOptions): Promise<CodeAgent> {
  const workspace = new WorkspaceManager({ workspaceDir: opts.workspaceDir });
  await workspace.initialize();

  return new CodeAgent({
    orchestrator: opts.orchestrator,
    workspace,
    maxIterations: opts.maxIterations,
    lspEnabled: opts.lspEnabled ?? false,
  });
}
