/**
 * Storage Module - Exports for the storage abstraction layer
 * 
 * This module provides a unified interface for state persistence
 * across different deployment modes:
 * 
 * - CLI/Desktop: Uses LocalStorageProvider with filesystem (default)
 * - Cloud Functions: Uses GCPBucketProvider (or other cloud providers)
 * 
 * USAGE PATTERNS:
 * 
 * 1. CLI Mode (backward compatible):
 *    const provider = await createLocalProvider();
 *    // Ready to use immediately with default context
 * 
 * 2. Cloud Mode (with authenticated context):
 *    const provider = await createStorageProviderWithContext(
 *      { tenantId: jwt.sub, sessionId: req.sessionId },
 *      { gcpBucketName: 'my-bucket' }
 *    );
 *    // Ready to use with user's context
 * 
 * 3. Cloud Mode (manual context):
 *    const provider = await createGCPProvider('my-bucket');
 *    provider.setContext({ tenantId, sessionId }); // From JWT
 *    // Now ready to use
 */

// Types
export {
  StorageContext,
  ConversationMetadata,
  SavedConversation,
  LogEntry,
  JivaState,
  StorageInfraConfig,
  StorageProviderType,
} from './types.js';

// Base class
export { StorageProvider } from './provider.js';

// Implementations
export { LocalStorageProvider } from './local-provider.js';
export { GCPBucketProvider } from './gcp-bucket-provider.js';

// Factory
export {
  createStorageProvider,
  createStorageProviderWithContext,
  createLocalProvider,
  createGCPProvider,
} from './factory.js';
