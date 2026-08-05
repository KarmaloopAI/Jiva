/**
 * Session management routes
 */

import { Express, Request, Response } from 'express';
import { SessionManager } from '../session-manager.js';
import { validateAgentConfig } from '../agent-config.js';
import { logger } from '../../../utils/logger.js';

export function setupSessionRoutes(app: Express, sessionManager: SessionManager): void {
  /**
   * Create or restore a session
   * POST /api/session
   *
   * Optional body field `agentConfig` supplies per-session overrides (model,
   * tool-calling model, MCP servers, code-mode LSP, max iterations, workspace
   * dir). It is structurally validated BEFORE any session or MCP subprocess is
   * created, so an invalid config returns a 400 without side effects.
   */
  app.post('/api/session', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;

      // Validate per-session agentConfig (if supplied) before creating anything.
      const agentConfig = req.body?.agentConfig;
      const validation = validateAgentConfig(agentConfig);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid agentConfig',
          details: validation.errors,
        });
        return;
      }

      // Get or create session
      await sessionManager.getOrCreateSession(tenantId, sessionId, agentConfig);

      const info = sessionManager.getSessionInfo(tenantId, sessionId);

      res.status(200).json({
        success: true,
        session: info,
      });
    } catch (error) {
      logger.error('[API] Failed to create session:', error);
      res.status(500).json({
        error: 'Failed to create session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get session info
   * GET /api/session/:sessionId
   */
  app.get('/api/session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!;
      const { sessionId } = req.params;

      const info = sessionManager.getSessionInfo(tenantId, sessionId);
      
      if (!info) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.status(200).json({ success: true, session: info });
    } catch (error) {
      logger.error('[API] Failed to get session:', error);
      res.status(500).json({ 
        error: 'Failed to get session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get the live status of an in-flight agent turn.
   * GET /api/session/:sessionId/status
   *
   * Returns the latest orchestration event the session's agent emitted while
   * processing a `POST /api/chat` turn (e.g. "Planning execution…",
   * "Running filesystem__read_file…", "Synthesizing results…"). Designed to be
   * polled concurrently from a second HTTP request while a chat turn is in
   * flight — Node's event loop services this poll while `agent.chat()` awaits
   * the model provider.
   *
   * Returns 404 if the session does not exist (an expected poll outcome, e.g.
   * polling before the session has been created or after it was destroyed —
   * not an error). Returns 200 with `{ status }` otherwise.
   */
  app.get('/api/session/:sessionId/status', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!;
      const { sessionId } = req.params;

      const status = sessionManager.getSessionStatus(tenantId, sessionId);

      if (status === null) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.status(200).json({ status });
    } catch (error) {
      logger.error('[API] Failed to get session status:', error);
      res.status(500).json({
        error: 'Failed to get session status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * List sessions for tenant
   * GET /api/sessions
   */
  app.get('/api/sessions', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!;
      
      const sessions = sessionManager.listSessions(tenantId);
      
      res.status(200).json({
        success: true,
        sessions,
        count: sessions.length,
      });
    } catch (error) {
      logger.error('[API] Failed to list sessions:', error);
      res.status(500).json({ 
        error: 'Failed to list sessions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Delete session
   * DELETE /api/session/:sessionId
   */
  app.delete('/api/session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!;
      const { sessionId } = req.params;

      await sessionManager.destroySession(tenantId, sessionId);
      
      res.status(200).json({ success: true, message: 'Session deleted' });
    } catch (error) {
      logger.error('[API] Failed to delete session:', error);
      res.status(500).json({ 
        error: 'Failed to delete session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get token usage for the active session
   * GET /api/stats/tokens
   */
  app.get('/api/stats/tokens', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      const agent = sessionManager.getActiveAgent(tenantId, sessionId);
      if (!agent) {
        res.status(404).json({ error: 'No active session found' });
        return;
      }
      res.status(200).json({ success: true, sessionId, tokenUsage: agent.getTokenUsage() });
    } catch (error) {
      logger.error('[API] Failed to get token usage:', error);
      res.status(500).json({
        error: 'Failed to get token usage',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Get manager stats
   * GET /api/stats
   */
  app.get('/api/stats', async (req: Request, res: Response) => {
    try {
      const stats = sessionManager.getStats();
      
      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error('[API] Failed to get stats:', error);
      res.status(500).json({ 
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
