/**
 * Chat routes - REST API with Server-Sent Events (SSE) streaming
 */

import { Express, Request, Response } from 'express';
import { SessionManager } from '../session-manager.js';
import { logger } from '../../../utils/logger.js';
import { getDefaultFilesystemAllowedPath } from '../../../utils/platform.js';

export function setupChatRoutes(app: Express, sessionManager: SessionManager): void {
  /**
   * Send a message (non-streaming)
   * POST /api/chat
   */
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required and must be a string' });
        return;
      }

      // Get or create session
      const agent = await sessionManager.getOrCreateSession(tenantId, sessionId);

      // Process message
      const response = await agent.chat(message);

      // Update activity
      sessionManager.updateActivity(tenantId, sessionId);

      res.status(200).json({
        success: true,
        response: response.content,
        iterations: response.iterations,
        toolsUsed: response.toolsUsed,
        ...(response.plan !== undefined && { plan: response.plan }),
      });
    } catch (error) {
      logger.error('[API] Chat error:', error);
      res.status(500).json({ 
        error: 'Failed to process message',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Send a message with streaming (Server-Sent Events)
   * POST /api/chat/stream
   */
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required and must be a string' });
        return;
      }

      // Setup SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Helper to send SSE message
      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Get or create session
        const agent = await sessionManager.getOrCreateSession(tenantId, sessionId);

        sendEvent('status', { message: 'Processing request...' });

        // Process message (for now, not truly streaming from agent)
        // TODO: Implement streaming support in DualAgent
        const response = await agent.chat(message);

        // Send response
        sendEvent('response', {
          content: response.content,
          iterations: response.iterations,
          toolsUsed: response.toolsUsed,
          ...(response.plan !== undefined && { plan: response.plan }),
        });

        // Update activity
        sessionManager.updateActivity(tenantId, sessionId);

        sendEvent('done', { success: true });
        res.end();

      } catch (error) {
        logger.error('[API] Chat stream error:', error);
        sendEvent('error', { 
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        res.end();
      }

    } catch (error) {
      logger.error('[API] Chat stream setup error:', error);
      res.status(500).json({ 
        error: 'Failed to setup stream',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Stop an ongoing agent turn (cooperative stop — finishes current step then exits)
   * POST /api/chat/stop
   */
  app.post('/api/chat/stop', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      const agent = sessionManager.getActiveAgent(tenantId, sessionId);
      if (!agent) {
        res.status(404).json({ error: 'No active session found' });
        return;
      }
      agent.stop();
      res.status(200).json({ success: true, message: 'Stop signal sent — agent will halt after current step' });
    } catch (error) {
      logger.error('[API] Failed to stop agent:', error);
      res.status(500).json({ error: 'Failed to send stop signal', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * Get conversation history
   * GET /api/chat/history
   */
  app.get('/api/chat/history', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;

      // Get session
      const agent = await sessionManager.getOrCreateSession(tenantId, sessionId);
      const history = agent.getConversationHistory();

      res.status(200).json({
        success: true,
        history,
        count: history.length,
      });
    } catch (error) {
      logger.error('[API] Failed to get history:', error);
      res.status(500).json({ 
        error: 'Failed to get history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Run a message through the Evaluator Harness.
   * The main agent processes the request, then the evaluator validates completion
   * and nudges the main agent if gaps are found.
   *
   * POST /api/chat/harness
   * Body: { message: string, harness: "evaluator", conversationId?: string }
   */
  app.post('/api/chat/harness', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      const { message, conversationId } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required and must be a string' });
        return;
      }

      // Get the main agent session (creates one if needed)
      const mainAgent = await sessionManager.getOrCreateSession(tenantId, sessionId);
      sessionManager.updateActivity(tenantId, sessionId);

      // Build evaluator harness from environment variables
      // (same model config as the main agent uses in session-manager.ts)
      const { createEvaluatorHarness } = await import('../../../evaluator/index.js');

      const evalEndpoint = process.env.JIVA_MODEL_BASE_URL || 'https://cloud.olakrutrim.com/v1/chat/completions';
      const evalApiKey = process.env.JIVA_MODEL_API_KEY || '';
      const evalModel = process.env.JIVA_MODEL_NAME || 'gpt-oss-120b';

      const tcEndpoint = process.env.JIVA_TOOL_CALLING_MODEL_BASE_URL;
      const tcApiKey = process.env.JIVA_TOOL_CALLING_MODEL_API_KEY;
      const tcModel = process.env.JIVA_TOOL_CALLING_MODEL_NAME;

      const orchestratorCfg = {
        endpoint: evalEndpoint,
        apiKey: evalApiKey,
        model: evalModel,
        useHarmonyFormat: false,
        ...(tcEndpoint && tcApiKey && tcModel && {
          toolCallingEndpoint: tcEndpoint,
          toolCallingApiKey: tcApiKey,
          toolCallingModel: tcModel,
        }),
      };

      // MCP servers for evaluator — filesystem access to validate produced files
      const envAllowedPaths = process.env.MCP_FILESYSTEM_ALLOWED_PATHS;
      const defaultAllowedPath = getDefaultFilesystemAllowedPath();
      const allowedPaths = envAllowedPaths
        ? envAllowedPaths.split(',').map((p) => p.trim()).filter(Boolean)
        : [defaultAllowedPath];

      const evalMcpServers: Record<string, any> = {
        filesystem: {
          command: 'npx',
          args: ['--no', '@modelcontextprotocol/server-filesystem', ...allowedPaths],
          enabled: true,
        },
      };

      const harness = await createEvaluatorHarness(mainAgent, evalMcpServers, orchestratorCfg, {
        verbose: false,
      });

      const result = await harness.run(message, { targetConversationId: conversationId });

      // Cleanup evaluator MCP servers (main agent cleanup is handled by session manager)
      await harness['evaluatorAgent']['mcpManager'].cleanup();

      res.status(200).json({
        success: true,
        mainAgentResponse: result.mainAgentResponse,
        mainAgentIterations: result.mainAgentIterations,
        evaluation: result.evaluation,
      });
    } catch (error) {
      logger.error('[API] Harness error:', error);
      res.status(500).json({
        error: 'Failed to process harness request',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Clear conversation history
   * DELETE /api/chat/history
   */
  app.delete('/api/chat/history', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;

      // Destroy and recreate session to clear history
      await sessionManager.destroySession(tenantId, sessionId);

      res.status(200).json({
        success: true,
        message: 'Conversation history cleared',
      });
    } catch (error) {
      logger.error('[API] Failed to clear history:', error);
      res.status(500).json({ 
        error: 'Failed to clear history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
