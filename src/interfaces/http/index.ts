#!/usr/bin/env node
/**
 * HTTP/WebSocket Interface for Jiva
 * 
 * Entry point for Cloud Run deployment. Provides REST API and WebSocket
 * endpoints for stateful, persistent sessions backed by GCS.
 * 
 * Usage:
 *   - Cloud Run: Deployed as container, auto-scales to zero
 *   - Local dev: npm run serve
 */

import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';
import { logger, LogLevel } from '../../utils/logger.js';
import { SessionManager } from './session-manager.js';
import { createStorageProvider } from '../../storage/factory.js';
import { setupHealthRoutes } from './routes/health.js';
import { setupSessionRoutes } from './routes/session.js';
import { setupChatRoutes } from './routes/chat.js';
import { setupWebSocketHandler } from './websocket-handler.js';
import { authMiddleware } from './middleware/auth.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '100', 10);
const SESSION_IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '1800000', 10); // 30 min default

// Configure logger
logger.setLogLevel(LOG_LEVEL);

async function bootstrap(): Promise<{ app: Express; server: HttpServer; wss: WebSocketServer }> {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // CORS for development (restrict in production)
  app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // Initialize storage provider (auto-detects environment)
  const storageProvider = await createStorageProvider();
  logger.info(`[HTTP] Storage provider initialized: ${storageProvider.constructor.name}`);

  // Initialize session manager
  const sessionManager = new SessionManager({
    storageProvider,
    maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  });

  // Health check routes (no auth required)
  setupHealthRoutes(app);

  // API routes (auth required)
  app.use('/api', authMiddleware);
  setupSessionRoutes(app, sessionManager);
  setupChatRoutes(app, sessionManager);

  // WebSocket upgrade handler
  server.on('upgrade', (request, socket, head) => {
    // Extract token from query params or headers
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || request.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Auth will be validated in WebSocket handler
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Setup WebSocket handler
  setupWebSocketHandler(wss, sessionManager);

  // Error handling
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('[HTTP] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  return { app, server, wss };
}

async function start(): Promise<void> {
  try {
    logger.info('[HTTP] Starting Jiva HTTP/WebSocket server...');
    logger.info(`[HTTP] Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`[HTTP] Storage: ${process.env.JIVA_STORAGE_PROVIDER || 'auto-detect'}`);
    logger.info(`[HTTP] Max sessions: ${MAX_CONCURRENT_SESSIONS}`);
    logger.info(`[HTTP] Idle timeout: ${SESSION_IDLE_TIMEOUT_MS}ms`);

    const { app, server, wss } = await bootstrap();

    server.listen(PORT, HOST, () => {
      logger.info(`[HTTP] Server listening on ${HOST}:${PORT}`);
      logger.info(`[HTTP] Health check: http://${HOST}:${PORT}/health`);
      logger.info(`[HTTP] WebSocket: ws://${HOST}:${PORT}/ws`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`[HTTP] Received ${signal}, shutting down gracefully...`);
      
      wss.clients.forEach((client) => {
        client.close(1000, 'Server shutting down');
      });

      server.close(() => {
        logger.info('[HTTP] Server closed');
        process.exit(0);
      });

      // Force exit after 30s
      setTimeout(() => {
        logger.error('[HTTP] Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('[HTTP] Failed to start server:', error);
    process.exit(1);
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { bootstrap, start };
