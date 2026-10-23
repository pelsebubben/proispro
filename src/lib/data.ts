import { runtime } from './runtime'
import { devAccessToken } from './devAuth'
import { entraAccessToken } from './entra'

type Filters = Record<string, string>
type Resource = 'discs' | 'bags' | 'bag_history' | 'collections' | 'collection_discs' |
  'wishlist_items' | 'forsale_listings' | 'sale_tokens' | 'course_pins' | 'hole_assignments'

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  try {
    const token = runtime.devAuth ? devAccessToken() : await entraAccessToken()
    if (!token) throw new Error('Your session has expired. Please sign in again.')
    const response = await fetch(`/api/v1/${path}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const detail = await response.json()
      throw new Error(`Could not ${method === 'GET' ? 'load' : 'save'} data (${response.status}: ${detail.error})`)
    }
    return await response.json()
  } catch (error) {
    window.dispatchEvent(new CustomEvent('griplock-data-error', {
      detail: error instanceof Error ? error.message : 'Data request failed',
    }))
    throw error
  }
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
