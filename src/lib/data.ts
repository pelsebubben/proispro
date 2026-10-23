import { runtime } from './runtime'
import { devAccessToken } from './devAuth'
import { entraAccessToken } from './entra'

type Filters = Record<string, string>
type Resource = 'discs' | 'bags' | 'bag_history' | 'collections' | 'collection_discs' |
  'wishlist_items' | 'forsale_listings' | 'sale_tokens' | 'course_pins' | 'hole_assignments'

async function accessToken() {
  const token = runtime.devAuth ? devAccessToken() : await entraAccessToken()
  if (!token) throw new Error('Your session has expired. Please sign in again.')
  return token
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  try {
    const token = await accessToken()
    const response = await fetch(`/api/v1/${path}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const detail = await response.json()
      throw new Error(`Could not ${method === 'GET' ? 'load' : 'save'} data (${response.status}: ${detail.error})`)
    }
    const result = await response.json()
    if (method !== 'GET') {
      window.dispatchEvent(new CustomEvent('griplock-data-changed', { detail: path.split(/[/?]/)[0] }))
    }
    return result
  } catch (error) {
    window.dispatchEvent(new CustomEvent('griplock-data-error', {
      detail: error instanceof Error ? error.message : 'Data request failed',
    }))
    throw error
  }
}

export async function loadDiscPhoto(path: string, signal: AbortSignal): Promise<Blob> {
  if (!/^\/api\/v1\/discs\/[0-9a-f-]{36}\/photo\?v=[0-9a-f-]{36}$/i.test(path)) {
    throw new Error('Invalid disc photo address.')
  }
  const token = await accessToken()
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Photo could not be loaded (${response.status}).`)
  return response.blob()
}

export function subscribeToChanges(resources: Resource[], reload: () => Promise<void>) {
  const listener = (event: Event) => {
    if (resources.includes((event as CustomEvent<Resource>).detail)) void reload().catch(console.error)
  }
  window.addEventListener('griplock-data-changed', listener)
  return () => window.removeEventListener('griplock-data-changed', listener)
}

export async function listRows<T>(resource: Resource, filters: Filters = {}): Promise<T[]> {
  const result = await request<Record<string, T[]>>(`${resource}?${new URLSearchParams(filters)}`)
  return result[resource]
}

export function createRow<T>(resource: Resource, body: object): Promise<T> {
  return request<T>(resource, 'POST', body)
}

export function updateRow<T = unknown>(resource: Resource, id: string, body: object): Promise<T> {
  return request<T>(`${resource}/${id}`, 'PATCH', body)
}

export function deleteRows(resource: Resource, id: string | Filters): Promise<unknown> {
  return request(`${resource}${typeof id === 'string' ? `/${id}` : `?${new URLSearchParams(id)}`}`, 'DELETE')
}

export function ensureToken(): Promise<{ id: string; token: string; is_public: boolean }> {
  return request('sale_tokens', 'POST', {})
}

export function saveToken(id: string, isPublic: boolean) {
  return updateRow('sale_tokens', id, { is_public: isPublic })
}
