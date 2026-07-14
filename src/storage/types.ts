/**
 * Storage Types - Core type definitions for the storage abstraction layer
 */

import { Message } from '../models/base.js';

/**
 * Tenant and session identification for multi-tenancy support
 * These MUST be provided by the caller (from JWT, API key, etc.) in cloud mode
 * In CLI mode, defaults are used for backward compatibility
 */
export interface StorageContext {
  tenantId: string;   // Required - identifies the user/organization
  sessionId: string;  // Required - identifies the conversation session
}

/**
 * Extra context captured for code-mode conversations only — lets a UI (e.g.
 * Jivam) reconstruct exactly how a code task was configured when resuming
 * or reviewing it later.
 */
export interface CodeConversationMeta {
  /** Names of MCP servers that were enabled for this code task. */
  mcpServers?: string[];
  /** Iteration budget configured for this task. */
  maxIterations?: number;
  /**
   * Free-form harness/mode label, if any — e.g. jiva-core's own 'evaluator'
   * harness, or a UI-level feature like Jivam's 'deep-run'. Not validated
   * against a fixed enum since callers outside jiva-core (like Jivam) may
   * set their own values here.
   */
  harness?: string;
}

/**
 * Conversation metadata (lightweight, for listing)
 */
export interface ConversationMetadata {
  id: string;
  title?: string;
  created: string;
  updated: string;
  messageCount: number;
  workspace?: string;
  summary?: string;
  type?: 'chat' | 'code';
  /** Lifetime accumulated prompt tokens for this conversation (optional — absent in older JSON files). */
  totalPromptTokens?: number;
  /** Lifetime accumulated completion tokens for this conversation. */
  totalCompletionTokens?: number;
  /** totalPromptTokens + totalCompletionTokens */
  totalTokens?: number;
  /** Code-mode specific context — see CodeConversationMeta. Only meaningful when type === 'code'. */
  mcpServers?: string[];
  maxIterations?: number;
  harness?: string;
}

/**
 * Full conversation with messages
 */
export interface SavedConversation {
  metadata: ConversationMetadata;
  messages: Message[];
}

/**
 * Log entry for orchestration events
 */
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  data?: Record<string, any>;
}

/**
 * Complete Jiva state snapshot for cloud function state transfer
 */
export interface JivaState {
  version: string;
  tenantId: string;
  sessionId: string;
  exportedAt: string;
  
  // Configuration (non-sensitive only)
  config: Record<string, any>;
  
  // Current conversation
  conversation: SavedConversation | null;
  
  // Directive content
  directive?: string;
  
  // Buffered logs (to be flushed)
  logBuffer: LogEntry[];
}

/**
 * Infrastructure configuration for storage providers
 * These come from environment variables or deployment config
 * NOT from user requests - these are deployment-time settings
 */
export interface StorageInfraConfig {
  // Local filesystem specific
  basePath?: string; // Defaults to ~/.jiva
  
  // GCP Bucket specific
  gcpBucketName?: string;
  gcpProjectId?: string;
  gcpKeyFilePath?: string; // Optional - uses ADC if not provided
  
  // AWS S3 specific (future)
  s3BucketName?: string;
  s3Region?: string;
  
  // Redis specific (future)
  redisUrl?: string;
}

/**
 * Provider type enum
 */
export enum StorageProviderType {
  LOCAL = 'local',
  GCP_BUCKET = 'gcp-bucket',
  AWS_S3 = 'aws-s3',
  REDIS = 'redis',
}
