/**
 * @deprecated
 * This file is kept for backward compatibility only.
 * Import from './model-client.js' instead.
 *
 * KrutrimModel  → ModelClient
 * KrutrimConfig → ModelClientConfig
 * createKrutrimModel → createModelClient
 */
export {
  ModelClient as KrutrimModel,
  createModelClient as createKrutrimModel,
} from './model-client.js';
export type { ModelClientConfig as KrutrimConfig } from './model-client.js';
