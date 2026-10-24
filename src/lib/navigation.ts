export type Tab = 'inventory' | 'bags' | 'courses' | 'collections' | 'wishlist' | 'forsale' | 'analytics'

export interface AppLocation { tab: Tab; bagId?: string; pinId?: string }

const PATHS: Record<Tab, string> = {
  inventory: '/', bags: '/bags', courses: '/courses', collections: '/collections',
  wishlist: '/wishlist', forsale: '/for-sale', analytics: '/analytics',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const id = (value: string | null) => value && UUID.test(value) ? value : undefined

export function parseLocation(location: Pick<Location, 'pathname' | 'search'> = window.location): AppLocation {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const tab = (Object.keys(PATHS) as Tab[]).find(key => PATHS[key] === path) ?? 'inventory'
  const params = new URLSearchParams(location.search)
  const bagId = tab === 'bags' || tab === 'courses' ? id(params.get('bag')) : undefined
  const pinId = tab === 'courses' ? id(params.get('pin')) : undefined
  return { tab, ...(bagId ? { bagId } : {}), ...(pinId ? { pinId } : {}) }
}

export function locationUrl({ tab, bagId, pinId }: AppLocation) {
  const params = new URLSearchParams()
  if (bagId && (tab === 'bags' || tab === 'courses')) params.set('bag', bagId)
  if (pinId && tab === 'courses') params.set('pin', pinId)
  const query = params.toString()
  return `${PATHS[tab]}${query ? `?${query}` : ''}`
}
