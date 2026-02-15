/**
 * Chat routes - REST API with Server-Sent Events (SSE) streaming
 */

import { Express, Request, Response } from 'express';
import { SessionManager } from '../session-manager.js';
import { logger } from '../../../utils/logger.js';

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
        plan: response.plan,
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
          plan: response.plan,
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
