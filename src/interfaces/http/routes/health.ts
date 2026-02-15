/**
 * Health check routes for Cloud Run
 */

import { Express, Request, Response } from 'express';

export function setupHealthRoutes(app: Express): void {
  /**
   * Liveness probe - is the server running?
   */
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * Readiness probe - is the server ready to accept traffic?
   */
  app.get('/ready', (req: Request, res: Response) => {
    // Could check database connections, model availability, etc.
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  });

  /**
   * Startup probe - has the server finished initialization?
   */
  app.get('/startup', (req: Request, res: Response) => {
    res.status(200).json({ status: 'started', timestamp: new Date().toISOString() });
  });
}
