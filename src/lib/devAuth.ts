// Development identity client. Active only when the server reports devAuth: the
// loopback-only local server, or the hosted dev app behind a shared passcode.
const storageKey = 'griplock.devAccessToken'

export async function devSignIn(user: string, passcode?: string) {
  const response = await fetch('/dev-auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passcode === undefined ? { user } : { user, passcode }),
  })
  if (!response.ok) {
    if (response.status === 400) throw new Error('Use lowercase letters, digits, ".", "_" or "-"')
    if (response.status === 401) throw new Error('Wrong dev passcode')
    if (response.status === 429) throw new Error('Too many attempts. Wait a minute and try again')
    throw new Error(`Dev sign-in failed (${response.status})`)
  }
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('access_token' in data) || typeof data.access_token !== 'string') {
    throw new Error('Invalid local sign-in response')
  }
  sessionStorage.setItem(storageKey, data.access_token)
  return devUser()
}

export async function devUser() {
  const token = sessionStorage.getItem(storageKey)
  if (!token) return null
  const response = await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (response.status === 401) {
    sessionStorage.removeItem(storageKey)
    return null
  }
  if (!response.ok) throw new Error(`Could not verify your application session (${response.status})`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('userId' in data) || typeof data.userId !== 'string') {
    throw new Error('Invalid application session response')
  }
  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  return { id: data.userId, email: typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined }
}

export function devAccessToken() {
  return sessionStorage.getItem(storageKey)
}

export function devSignOut() {
  sessionStorage.removeItem(storageKey)
}
