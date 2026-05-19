/**
 * Google Application Default Credentials (ADC) token provider.
 *
 * Fetches short-lived OAuth2 tokens for calling Google Cloud APIs
 * (e.g. Vertex AI MaaS endpoints) from within Cloud Run or any GCP
 * environment that has a service account attached.
 *
 * Token source priority:
 *   1. GCP metadata server at 169.254.169.254 (Cloud Run, GCE, GKE)
 *      — uses the IP directly, not the hostname, because musl libc
 *        (node:20-alpine) cannot resolve `metadata.google.internal`.
 *   2. google-auth-library (ADC) — fallback for local development
 *      when gcloud application-default credentials are active.
 *
 * Tokens are cached in-process and refreshed 5 minutes before expiry,
 * so there is at most one outbound metadata call per hour.
 */

import http from 'http';
import { logger } from '../utils/logger.js';

const METADATA_IP   = '169.254.169.254';
const METADATA_PATH = '/computeMetadata/v1/instance/service-accounts/default/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

interface CachedToken {
  access_token: string;
  expires_at: number; // epoch ms
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

function fetchFromMetadataServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: METADATA_IP,
        port: 80,
        path: METADATA_PATH,
        method: 'GET',
        headers: { 'Metadata-Flavor': 'Google' },
        timeout: 3000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Metadata server returned HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed: { access_token: string; expires_in: number } = JSON.parse(body);
            cached = {
              access_token: parsed.access_token,
              expires_at: Date.now() + parsed.expires_in * 1000,
            };
            logger.debug(
              `[GoogleADC] Token refreshed from metadata server, ` +
              `expires in ${Math.round(parsed.expires_in / 60)} min`
            );
            resolve(cached.access_token);
          } catch (e) {
            reject(new Error('Failed to parse metadata token response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Metadata server request timed out'));
    });
    req.end();
  });
}

async function fetchFromGoogleAuthLibrary(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error('google-auth-library returned null token');
  // Cache for 55 min (library manages its own refresh internally,
  // but we cache to avoid re-instantiating on every call).
  cached = { access_token: token, expires_at: Date.now() + 55 * 60 * 1000 };
  logger.debug('[GoogleADC] Token obtained via google-auth-library (local ADC)');
  return token;
}

/**
 * Returns a valid GCP OAuth2 access token, refreshing from the metadata
 * server (Cloud Run) or local ADC (development) as needed.
 *
 * Call this once per model API request — the call is cheap because the
 * token is cached in-process until 5 minutes before expiry.
 */
export async function getGoogleADCToken(): Promise<string> {
  // Return cached token if still fresh
  if (cached && cached.expires_at - Date.now() > REFRESH_BUFFER_MS) {
    return cached.access_token;
  }

  // Deduplicate concurrent refresh calls
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      return await fetchFromMetadataServer();
    } catch (metadataErr) {
      logger.debug(
        `[GoogleADC] Metadata server unavailable (${(metadataErr as Error).message}), ` +
        `falling back to google-auth-library`
      );
      try {
        return await fetchFromGoogleAuthLibrary();
      } catch (adcErr) {
        throw new Error(
          `Google ADC token fetch failed.\n` +
          `  Metadata server: ${(metadataErr as Error).message}\n` +
          `  google-auth-library: ${(adcErr as Error).message}\n` +
          `Ensure the service account has the 'aiplatform.endpoints.predict' permission ` +
          `or set useGoogleADC: false and provide a static apiKey.`
        );
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
