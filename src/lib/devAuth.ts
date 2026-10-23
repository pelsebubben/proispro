// Local development identity client. Only active when the local server reports
// devAuth; deployed builds never expose the token endpoint.
const storageKey = 'griplock.devAccessToken'

export async function devSignIn(user: string) {
  const response = await fetch('/dev-auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user }),
  })
  if (!response.ok) throw new Error(response.status === 400 ? 'Use lowercase letters, digits, ".", "_" or "-"' : `Local sign-in failed (${response.status})`)
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
