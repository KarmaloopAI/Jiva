/**
 * WebSocket handler for real-time bidirectional communication
 * 
 * Protocol:
 * Client -> Server:
 *   { type: 'message', content: string }
 *   { type: 'ping' }
 * 
 * Server -> Client:
 *   { type: 'response', content: string, ... }
 *   { type: 'status', message: string }
 *   { type: 'error', message: string }
 *   { type: 'pong' }
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionManager } from './session-manager.js';
import { extractAuthFromWebSocket, AuthContext } from './middleware/auth.js';
import { logger } from '../../utils/logger.js';

interface WebSocketMessage {
  type: 'message' | 'ping';
  content?: string;
}

interface WebSocketClient extends WebSocket {
  auth?: AuthContext;
  isAlive?: boolean;
}

export function setupWebSocketHandler(wss: WebSocketServer, sessionManager: SessionManager): void {
  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: WebSocketClient) => {
      if (ws.isAlive === false) {
        logger.debug('[WS] Terminating dead connection');
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // 30 seconds

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', async (ws: WebSocketClient, request: IncomingMessage) => {
    ws.isAlive = true;

    // Setup heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    try {
      // Authenticate
      const auth = await extractAuthFromWebSocket(request);
      ws.auth = auth;

      logger.info(`[WS] Client connected: ${auth.tenantId}:${auth.sessionId}`);

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Connected to Jiva',
      }));

      // Create/restore session
      try {
        await sessionManager.getOrCreateSession(auth.tenantId, auth.sessionId);
        
        ws.send(JSON.stringify({
          type: 'status',
          message: 'Session ready',
          sessionInfo: sessionManager.getSessionInfo(auth.tenantId, auth.sessionId),
        }));
      } catch (error) {
        logger.error('[WS] Failed to initialize session:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to initialize session',
        }));
        ws.close(1011, 'Session initialization failed');
        return;
      }

      // Handle messages
      ws.on('message', async (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());

          // Handle ping
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          // Handle chat message
          if (message.type === 'message' && message.content) {
            await handleChatMessage(ws, auth, message.content, sessionManager);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid message format',
            }));
          }

        } catch (error) {
          logger.error('[WS] Message handling error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message',
          }));
        }
      });

      // Handle disconnect
      ws.on('close', (code, reason) => {
        logger.info(`[WS] Client disconnected: ${auth.tenantId}:${auth.sessionId} (${code}: ${reason})`);
        // Note: Session is not destroyed here - it will idle timeout naturally
      });

      ws.on('error', (error) => {
        logger.error('[WS] WebSocket error:', error);
      });

    } catch (error) {
      logger.error('[WS] Connection setup error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Authentication failed',
      }));
      ws.close(1008, 'Authentication failed');
    }
  });
}

/**
 * Handle a chat message via WebSocket
 */
async function handleChatMessage(
  ws: WebSocketClient,
  auth: AuthContext,
  message: string,
  sessionManager: SessionManager
): Promise<void> {
  try {
    // Get session
    const agent = await sessionManager.getOrCreateSession(auth.tenantId, auth.sessionId);

    // Send status
    ws.send(JSON.stringify({
      type: 'status',
      message: 'Processing...',
    }));

    // Process message
    const response = await agent.chat(message);

    // Update activity
    sessionManager.updateActivity(auth.tenantId, auth.sessionId);

    // Send response
    ws.send(JSON.stringify({
      type: 'response',
      content: response.content,
      iterations: response.iterations,
      toolsUsed: response.toolsUsed,
      plan: response.plan,
    }));

  } catch (error) {
    logger.error('[WS] Failed to process message:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to process message',
    }));
  }
}
