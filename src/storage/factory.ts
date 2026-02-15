/**
 * StorageProviderFactory - Creates the appropriate storage provider
 * based on environment configuration
 * 
 * DESIGN PRINCIPLES:
 * 1. Infrastructure config (bucket names, paths) comes from environment variables
 * 2. Identity context (tenantId, sessionId) comes from the caller (JWT, etc.)
 * 3. CLI mode uses LocalStorageProvider with default context (backward compatible)
 * 4. Cloud mode requires explicit setContext() call before operations
 */

import { StorageProvider } from './provider.js';
import { LocalStorageProvider } from './local-provider.js';
import { GCPBucketProvider } from './gcp-bucket-provider.js';
import { StorageInfraConfig, StorageProviderType, StorageContext } from './types.js';

/**
 * Environment variable names for INFRASTRUCTURE configuration only
 * Identity (tenantId, sessionId) must come from authenticated requests
 */
const ENV_VARS = {
  // Provider selection
  PROVIDER: 'JIVA_STORAGE_PROVIDER',
  
  // Local filesystem
  BASE_PATH: 'JIVA_STORAGE_PATH',
  
  // GCP
  GCP_BUCKET: 'JIVA_GCP_BUCKET',
  GCP_PROJECT: 'JIVA_GCP_PROJECT',
  GCP_KEY_FILE: 'JIVA_GCP_KEY_FILE',
  
  // AWS S3 (future)
  S3_BUCKET: 'JIVA_S3_BUCKET',
  S3_REGION: 'JIVA_S3_REGION',
  
  // Redis (future)
  REDIS_URL: 'JIVA_REDIS_URL',
};

/**
 * Get infrastructure configuration from environment variables
 */
function getInfraConfigFromEnv(): StorageInfraConfig {
  return {
    basePath: process.env[ENV_VARS.BASE_PATH],
    gcpBucketName: process.env[ENV_VARS.GCP_BUCKET],
    gcpProjectId: process.env[ENV_VARS.GCP_PROJECT],
    gcpKeyFilePath: process.env[ENV_VARS.GCP_KEY_FILE],
    s3BucketName: process.env[ENV_VARS.S3_BUCKET],
    s3Region: process.env[ENV_VARS.S3_REGION],
    redisUrl: process.env[ENV_VARS.REDIS_URL],
  };
}

/**
 * Determine provider type from environment or explicit config
 */
function determineProviderType(infraConfig?: StorageInfraConfig): StorageProviderType {
  // Explicit environment variable takes precedence
  const envProvider = process.env[ENV_VARS.PROVIDER];
  if (envProvider) {
    return envProvider as StorageProviderType;
  }

  // Infer from available configuration
  if (infraConfig?.gcpBucketName || process.env[ENV_VARS.GCP_BUCKET]) {
    return StorageProviderType.GCP_BUCKET;
  }
  
  if (infraConfig?.s3BucketName || process.env[ENV_VARS.S3_BUCKET]) {
    return StorageProviderType.AWS_S3;
  }
  
  if (infraConfig?.redisUrl || process.env[ENV_VARS.REDIS_URL]) {
    return StorageProviderType.REDIS;
  }

  // Default to local filesystem
  return StorageProviderType.LOCAL;
}

/**
 * Create a storage provider instance
 * 
 * For CLI mode: Provider is returned with default context, ready to use
 * For Cloud mode: Caller must call setContext() with authenticated identity
 * 
 * @param explicitInfraConfig - Explicit infrastructure config (overrides environment)
 * @param providerType - Explicit provider type (overrides auto-detection)
 */
export async function createStorageProvider(
  explicitInfraConfig?: StorageInfraConfig,
  providerType?: StorageProviderType
): Promise<StorageProvider> {
  // Merge environment config with explicit config
  const envConfig = getInfraConfigFromEnv();
  const infraConfig: StorageInfraConfig = {
    basePath: explicitInfraConfig?.basePath || envConfig.basePath,
    gcpBucketName: explicitInfraConfig?.gcpBucketName || envConfig.gcpBucketName,
    gcpProjectId: explicitInfraConfig?.gcpProjectId || envConfig.gcpProjectId,
    gcpKeyFilePath: explicitInfraConfig?.gcpKeyFilePath || envConfig.gcpKeyFilePath,
    s3BucketName: explicitInfraConfig?.s3BucketName || envConfig.s3BucketName,
    s3Region: explicitInfraConfig?.s3Region || envConfig.s3Region,
    redisUrl: explicitInfraConfig?.redisUrl || envConfig.redisUrl,
  };

  // Determine provider type
  const type = providerType || determineProviderType(infraConfig);

  // Create provider instance
  let provider: StorageProvider;

  switch (type) {
    case StorageProviderType.GCP_BUCKET:
      provider = new GCPBucketProvider(infraConfig);
      break;

    case StorageProviderType.AWS_S3:
      throw new Error('AWS S3 provider not yet implemented. Coming soon!');

    case StorageProviderType.REDIS:
      throw new Error('Redis provider not yet implemented. Coming soon!');

    case StorageProviderType.LOCAL:
    default:
      provider = new LocalStorageProvider(infraConfig);
      break;
  }

  // Initialize provider
  await provider.initialize();

  return provider;
}

/**
 * Create a local storage provider for CLI/Desktop mode
 * Returns provider with default context, ready to use immediately
 * 
 * @param basePath - Optional custom base path (defaults to ~/.jiva)
 */
export async function createLocalProvider(
  basePath?: string
): Promise<LocalStorageProvider> {
  const provider = new LocalStorageProvider({ basePath });
  await provider.initialize();
  // LocalStorageProvider has default context set in constructor
  return provider;
}

/**
 * Create a GCP bucket provider for Cloud mode
 * 
 * IMPORTANT: Caller MUST call setContext() with authenticated identity
 * before performing any operations
 * 
 * @param bucketName - GCP bucket name
 * @param projectId - Optional GCP project ID
 */
export async function createGCPProvider(
  bucketName: string,
  projectId?: string
): Promise<GCPBucketProvider> {
  const provider = new GCPBucketProvider({
    gcpBucketName: bucketName,
    gcpProjectId: projectId,
  });
  await provider.initialize();
  // Context must be set by caller via setContext()
  return provider;
}

/**
 * Create a storage provider and set context in one call
 * Convenience method for cloud functions
 * 
 * @param context - Authenticated user context (from JWT, etc.)
 * @param infraConfig - Optional infrastructure config
 * @param providerType - Optional explicit provider type
 */
export async function createStorageProviderWithContext(
  context: StorageContext,
  infraConfig?: StorageInfraConfig,
  providerType?: StorageProviderType
): Promise<StorageProvider> {
  const provider = await createStorageProvider(infraConfig, providerType);
  provider.setContext(context);
  return provider;
}
