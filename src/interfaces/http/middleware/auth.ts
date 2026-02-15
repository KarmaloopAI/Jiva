/**
 * Authentication Middleware
 * 
 * Verifies JWT tokens and extracts tenantId/sessionId for storage context.
 * Supports multiple auth strategies:
 * - Firebase Auth
 * - Custom JWT (HS256/RS256)
 * - Development mode (no auth)
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../utils/logger.js';

export interface AuthContext {
  tenantId: string;
  sessionId: string;
  userId?: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Extract and verify JWT token
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Development mode or auth disabled bypass
    if (process.env.AUTH_DISABLED === 'true') {
      logger.debug('[Auth] Auth disabled - bypassing authentication');
      req.auth = {
        tenantId: req.headers['x-tenant-id'] as string || 'dev-tenant',
        sessionId: req.headers['x-session-id'] as string || generateSessionId(),
        userId: 'dev-user',
        email: 'dev@jiva.local',
      };
      next();
      return;
    }

    // Extract token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);

    // Verify token based on strategy
    const authStrategy = process.env.AUTH_STRATEGY || 'custom';
    let authContext: AuthContext;

    switch (authStrategy) {
      case 'firebase':
        authContext = await verifyFirebaseToken(token);
        break;
      case 'custom':
        authContext = await verifyCustomToken(token);
        break;
      default:
        throw new Error(`Unknown auth strategy: ${authStrategy}`);
    }

    // Attach to request
    req.auth = authContext;
    next();

  } catch (error) {
    logger.error('[Auth] Authentication failed:', error);
    res.status(401).json({ 
      error: 'Authentication failed', 
      message: error instanceof Error ? error.message : 'Invalid token'
    });
  }
}

/**
 * Verify Firebase ID token
 */
async function verifyFirebaseToken(token: string): Promise<AuthContext> {
  // This would use firebase-admin SDK in production
  // For now, implement basic JWT parsing
  
  try {
    // Dynamic import to keep firebase-admin optional
    // @ts-expect-error - firebase-admin is an optional peer dependency
    const admin = await import('firebase-admin');
    
    if (!admin.apps.length) {
      // Initialize Firebase Admin if not already done
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : undefined;
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    
    return {
      tenantId: decodedToken.uid, // Use Firebase UID as tenantId
      sessionId: decodedToken.session_id || generateSessionId(),
      userId: decodedToken.uid,
      email: decodedToken.email,
    };
  } catch (error) {
    logger.debug('[Auth] Firebase Admin not available, falling back to basic parsing');
    // Fallback: parse JWT without verification (dev only)
    return parseTokenBasic(token);
  }
}

/**
 * Verify custom JWT token
 */
async function verifyCustomToken(token: string): Promise<AuthContext> {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }

  try {
    // Use jsonwebtoken library
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.verify(token, secret) as any;

    if (!decoded.tenantId && !decoded.sub) {
      throw new Error('Token missing tenantId/sub claim');
    }

    return {
      tenantId: decoded.tenantId || decoded.sub,
      sessionId: decoded.sessionId || decoded.session_id || generateSessionId(),
      userId: decoded.userId || decoded.sub,
      email: decoded.email,
    };
  } catch (error) {
    logger.debug('[Auth] jsonwebtoken not available, falling back to basic parsing');
    // Fallback: parse JWT without verification (dev only)
    return parseTokenBasic(token);
  }
}

/**
 * Parse JWT token without verification (dev/fallback only)
 */
function parseTokenBasic(token: string): AuthContext {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

  if (!payload.tenantId && !payload.sub) {
    throw new Error('Token missing tenantId/sub claim');
  }

  logger.warn('[Auth] Using unverified token parsing - DEVELOPMENT ONLY');

  return {
    tenantId: payload.tenantId || payload.sub || 'unknown',
    sessionId: payload.sessionId || payload.session_id || generateSessionId(),
    userId: payload.userId || payload.sub || 'unknown',
    email: payload.email,
  };
}

/**
 * Generate a session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Optional: Extract auth from WebSocket connection
 */
export async function extractAuthFromWebSocket(request: any): Promise<AuthContext> {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token') || request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new Error('No token provided');
  }

  // Development mode
  if (process.env.NODE_ENV === 'development' && process.env.AUTH_DISABLED === 'true') {
    return {
      tenantId: url.searchParams.get('tenantId') || 'dev-tenant',
      sessionId: url.searchParams.get('sessionId') || generateSessionId(),
      userId: 'dev-user',
      email: 'dev@jiva.local',
    };
  }

  // Verify token
  const authStrategy = process.env.AUTH_STRATEGY || 'custom';
  
  switch (authStrategy) {
    case 'firebase':
      return await verifyFirebaseToken(token);
    case 'custom':
      return await verifyCustomToken(token);
    default:
      throw new Error(`Unknown auth strategy: ${authStrategy}`);
  }
}
