/**
 * Benchmark routes — run the code-mode benchmark suite over HTTP.
 *
 * The suite runs in isolated temp workspaces (not session-bound), so these
 * routes build their own ModelOrchestrator from the stored configuration,
 * cached across requests. Long runs should prefer the streaming variant.
 *
 *   GET  /api/benchmark/tasks       → list available tasks (metadata only)
 *   POST /api/benchmark/run         → run the suite, return the full SuiteResult
 *   POST /api/benchmark/run/stream  → run the suite, stream per-task progress (SSE)
 */

import { Express, Request, Response } from 'express';
import { configManager } from '../../../core/config.js';
import { logger } from '../../../utils/logger.js';
import {
  createOrchestrator,
  selectTasks,
  runBenchmark,
  listTaskMetadata,
  listSuiteMetadata,
  getSuite,
  DEFAULT_SUITE_ID,
} from '../../../code/benchmark/index.js';
import type { ModelOrchestrator } from '../../../models/orchestrator.js';
import type { RunnerOptions } from '../../../code/benchmark/index.js';

let orchestratorPromise: Promise<{ orchestrator: ModelOrchestrator; modelLabel: string }> | null = null;

/** Build (and cache) the orchestrator from stored config. */
function getOrchestrator(): Promise<{ orchestrator: ModelOrchestrator; modelLabel: string }> {
  if (!orchestratorPromise) {
    orchestratorPromise = (async () => {
      if (!configManager.isConfigured()) {
        throw new Error('Jiva is not configured on this server');
      }
      configManager.validateConfig();
      return createOrchestrator({
        reasoning: configManager.getReasoningModel() as any,
        multimodal: configManager.getMultimodalModel() as any,
        toolCalling: configManager.getToolCallingModel() as any,
        testConnectivity: true,
        log: (m) => logger.info(`[benchmark] ${m}`),
      });
    })().catch((err) => {
      orchestratorPromise = null; // allow retry on next request
      throw err;
    });
  }
  return orchestratorPromise;
}

/** Map a request body to RunnerOptions. */
function parseRunOptions(body: any): { options: RunnerOptions; taskIds?: string[]; maxTier?: number; suiteId: string } {
  return {
    suiteId: typeof body?.suite === 'string' && body.suite ? body.suite : DEFAULT_SUITE_ID,
    maxTier: typeof body?.maxTier === 'number' ? body.maxTier : undefined,
    taskIds: Array.isArray(body?.tasks) ? body.tasks : undefined,
    options: {
      maxIterations: typeof body?.maxIterations === 'number' ? body.maxIterations : undefined,
      timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
      lspEnabled: !!body?.lsp,
      continuous: !!body?.continuous,
    },
  };
}

export function setupBenchmarkRoutes(app: Express): void {
  app.get('/api/benchmark/suites', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, suites: listSuiteMetadata() });
  });

  app.get('/api/benchmark/tasks', (req: Request, res: Response) => {
    const suiteId = (typeof req.query.suite === 'string' && req.query.suite) || DEFAULT_SUITE_ID;
    const suite = getSuite(suiteId);
    if (!suite) {
      res.status(404).json({ error: `Unknown suite "${suiteId}"` });
      return;
    }
    res.status(200).json({ success: true, suite: suite.id, tasks: listTaskMetadata(suite.tasks) });
  });

  app.post('/api/benchmark/run', async (req: Request, res: Response) => {
    try {
      const { options, taskIds, maxTier, suiteId } = parseRunOptions(req.body);
      const suite = getSuite(suiteId);
      if (!suite) {
        res.status(404).json({ error: `Unknown suite "${suiteId}"` });
        return;
      }
      const { orchestrator, modelLabel } = await getOrchestrator();
      const tasks = selectTasks(suite.tasks, { maxTier, taskIds });
      if (tasks.length === 0) {
        res.status(400).json({ error: 'No benchmark tasks match the given filters' });
        return;
      }
      const result = await runBenchmark(orchestrator, tasks, {
        ...options,
        model: modelLabel,
        suiteId: suite.id,
        suiteName: suite.name,
        scoring: suite.scoring,
      });
      res.status(200).json({ success: true, suite: result });
    } catch (error) {
      logger.error('[API] Benchmark run error:', error);
      res.status(500).json({ error: 'Benchmark failed', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/benchmark/run/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { options, taskIds, maxTier, suiteId } = parseRunOptions(req.body);
      const suite = getSuite(suiteId);
      if (!suite) {
        sendEvent('error', { message: `Unknown suite "${suiteId}"` });
        res.end();
        return;
      }
      const { orchestrator, modelLabel } = await getOrchestrator();
      const tasks = selectTasks(suite.tasks, { maxTier, taskIds });
      if (tasks.length === 0) {
        sendEvent('error', { message: 'No benchmark tasks match the given filters' });
        res.end();
        return;
      }

      const result = await runBenchmark(
        orchestrator,
        tasks,
        { ...options, model: modelLabel, suiteId: suite.id, suiteName: suite.name, scoring: suite.scoring },
        {
          onTaskStart: (task, index, total) => sendEvent('task-start', { id: task.id, tier: task.tier, title: task.title, index, total }),
          onTaskDone: (taskResult, index, total) => sendEvent('task-done', { result: taskResult, index, total }),
        },
      );

      sendEvent('done', { suite: result });
      res.end();
    } catch (error) {
      sendEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' });
      res.end();
    }
  });
}
