import { runtime } from './runtime'
import { devAccessToken, devSignOut } from './devAuth'
import { entraAccessToken } from './entra'

type Filters = Record<string, string>
type Resource = 'discs' | 'bags' | 'bag_history' | 'collections' | 'collection_discs' |
  'wishlist_items' | 'forsale_listings' | 'sale_tokens' | 'course_pins' | 'hole_assignments'

export const sessionExpiredMessage = 'Your session expired. Please sign in again.'

function sessionExpired(): never {
  clearPhotoCache()
  if (runtime.devAuth) devSignOut()
  window.dispatchEvent(new Event('griplock-session-expired'))
  throw new Error(sessionExpiredMessage)
}

async function accessToken() {
  const token = runtime.devAuth ? devAccessToken() : await entraAccessToken()
  if (!token) sessionExpired()
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
    if (response.status === 401) sessionExpired()
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

export function readCourseCatalogue<T>(path: string): Promise<T> {
  if (!/^courses(?:\?q=[^#]*|\/pdga:[1-9][0-9]{0,15}\/(?:holes|layouts))$/.test(path)) {
    throw new Error('Invalid course catalogue request')
  }

  return request<T>(path)
}

export function plannerData<T>(path: string, method = 'GET', body?: object): Promise<T> {
  if (!/^planner(?:\?pin_id=[0-9a-f-]{36}(?:&layout_id=[0-9a-f-]{36})?|\/event-layout|\/(?:layouts|pins)\/[0-9a-f-]{36})?$/i.test(path)) {
    throw new Error('Invalid planner request')
  }
  return request<T>(path, method, body)
}

export function confirmPlannerNavigation() {
  return window.dispatchEvent(new Event('griplock-before-navigation', { cancelable: true }))
}

async function fetchDiscPhoto(path: string, signal: AbortSignal): Promise<Blob> {
  if (!/^\/api\/v1\/discs\/[0-9a-f-]{36}\/photo\?v=[0-9a-f-]{36}$/i.test(path)) {
    throw new Error('Invalid disc photo address.')
  }
  const token = await accessToken()
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  if (response.status === 401) sessionExpired()
  if (!response.ok) throw new Error(`Photo could not be loaded (${response.status}).`)
  return response.blob()
}

const PHOTO_CACHE_LIMIT = 64
const photoCache = new Map<string, Promise<Blob>>()
let photoFetches = new AbortController()

// Photo paths carry a version, so a cached entry is never stale. Forgetting them on
// sign-out or an expired session keeps one user's photos from reaching the next.
export function clearPhotoCache() {
  photoFetches.abort()
  photoFetches = new AbortController()
  photoCache.clear()
}

const photoAborted = () => new DOMException('Photo request cancelled.', 'AbortError')

// Cards, list rows and the preview all ask for the same photo. One request is shared
// and keeps running when a single consumer leaves, so a quick hover still warms the cache.
export function loadDiscPhoto(path: string, signal: AbortSignal): Promise<Blob> {
  let shared = photoCache.get(path)
  if (shared) {
    photoCache.delete(path)
    photoCache.set(path, shared)
  } else {
    const fetched = fetchDiscPhoto(path, photoFetches.signal)
    shared = fetched
    photoCache.set(path, fetched)
    fetched.catch(() => { if (photoCache.get(path) === fetched) photoCache.delete(path) })
    if (photoCache.size > PHOTO_CACHE_LIMIT) photoCache.delete(photoCache.keys().next().value as string)
  }
  const result = shared
  return new Promise<Blob>((resolve, reject) => {
    if (signal.aborted) return reject(photoAborted())
    const onAbort = () => reject(photoAborted())
    signal.addEventListener('abort', onAbort, { once: true })
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
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
