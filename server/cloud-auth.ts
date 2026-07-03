/**
 * Supabase Auth — fetch-based, no SDK.
 * Project: hcomegrnonxmjupvvyus
 */

const SUPABASE_URL = 'https://hcomegrnonxmjupvvyus.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb21lZ3Jub254bWp1cHZ2eXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNTQwMjcsImV4cCI6MjA5MzczMDAyN30.sBBOTrPsdCZk75HDEzJaIv5Mz-bE3HTuJQ-1LcJ45nk'

const CLOUD_RUN_URL = 'https://jiva-hdjcuspt2a-uc.a.run.app'

export interface CloudUser {
  userId: string
  email: string
  accessToken: string
  refreshToken: string
}

async function supabaseFetch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const msg = (data.error_description ?? data.error ?? data.message ?? 'Auth failed') as string
    throw new Error(msg)
  }
  return data
}

export async function cloudSignIn(email: string, password: string): Promise<CloudUser> {
  const data = await supabaseFetch('/auth/v1/token?grant_type=password', { email, password })
  return {
    userId: (data.user as Record<string, unknown>).id as string,
    email: (data.user as Record<string, unknown>).email as string,
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
  }
}

export async function cloudSignUp(email: string, password: string): Promise<CloudUser> {
  const data = await supabaseFetch('/auth/v1/signup', { email, password })
  // Supabase signup response varies by project config:
  // - Auto-confirm ON: { access_token, refresh_token, user: { id, email, ... } }
  // - Email confirmation required: user object at top level, no access_token
  const userObj = ((data.user ?? data) as Record<string, unknown>)
  return {
    userId: userObj.id as string,
    email: userObj.email as string,
    accessToken: (data.access_token ?? '') as string,
    refreshToken: (data.refresh_token ?? '') as string,
  }
}

export async function cloudSignOut(accessToken: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
  })
}

/**
 * Create or restore a Cloud Run session for the given user.
 * Returns the sessionId to use for subsequent API calls.
 */
export async function initCloudSession(userId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${CLOUD_RUN_URL}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': userId,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloud session init failed: ${text}`)
  }
}
