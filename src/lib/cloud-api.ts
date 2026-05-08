/**
 * Cloud API abstraction shim.
 * In Electron: delegates to window.electron.cloud.* IPC calls.
 * In browser (jivamai.com): calls Supabase / Cloud Run directly via fetch.
 */

const SUPABASE_URL = 'https://hcomegrnonxmjupvvyus.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb21lZ3Jub254bWp1cHZ2eXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNTQwMjcsImV4cCI6MjA5MzczMDAyN30.sBBOTrPsdCZk75HDEzJaIv5Mz-bE3HTuJQ-1LcJ45nk'
const CLOUD_RUN_URL = 'https://jiva-hdjcuspt2a-uc.a.run.app'

export interface CloudAuthResult {
  userId: string
  email: string
}

/**
 * Sign in with email + password.
 * Throws on failure.
 */
export async function cloudApiSignIn(email: string, password: string): Promise<CloudAuthResult> {
  if (window.electron?.cloud) {
    const result = await window.electron.cloud.signIn(email, password)
    if ('error' in result) throw new Error(result.error)
    return result
  }
  // Web fallback: call Supabase directly
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(
      (data.error_description ?? data.error ?? data.message ?? 'Sign in failed') as string
    )
  }
  const user = data.user as Record<string, unknown>
  return { userId: user.id as string, email: user.email as string }
}

/**
 * Create a new account.
 * Throws on failure.
 */
export async function cloudApiSignUp(email: string, password: string): Promise<CloudAuthResult> {
  if (window.electron?.cloud) {
    const result = await window.electron.cloud.signUp(email, password)
    if ('error' in result) throw new Error(result.error)
    return result
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(
      (data.error_description ?? data.error ?? data.message ?? 'Sign up failed') as string
    )
  }
  const userObj = ((data.user ?? data) as Record<string, unknown>)
  return { userId: userObj.id as string, email: userObj.email as string }
}

/**
 * Sign out. Clears server-side session (best-effort).
 */
export async function cloudApiSignOut(): Promise<void> {
  if (window.electron?.cloud) {
    await window.electron.cloud.signOut()
    return
  }
  // Web: access token not held here — caller clears localStorage
}

/**
 * Create or restore a cloud session for the given user.
 * Must be called after sign-in before any chat messages.
 * Throws on failure.
 */
export async function cloudApiInit(userId: string, sessionId: string): Promise<void> {
  if (window.electron?.cloud) {
    const result = await window.electron.cloud.init(userId, sessionId)
    if (!result.success) throw new Error(result.error ?? 'Cloud init failed')
    return
  }
  // Web fallback: call Cloud Run session endpoint directly
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
