/**
 * Session management routes
 */

import { Express, Request, Response } from 'express';
import { SessionManager } from '../session-manager.js';
import { logger } from '../../../utils/logger.js';

export function setupSessionRoutes(app: Express, sessionManager: SessionManager): void {
  /**
   * Create or restore a session
   * POST /api/session
   */
  app.post('/api/session', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.auth!;
      
      // Get or create session
      await sessionManager.getOrCreateSession(tenantId, sessionId);
      
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
