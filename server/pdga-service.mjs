import { searchPdga, readPdgaCourse } from './pdga-client.mjs'

export const pdgaCacheMs = 15 * 60_000
const unavailable = code => Object.assign(new Error(code), { code })

// Process-local, expiring content only: no disk cache, catalogue replication or stale-on-error.
export function createPdgaService({ username, password, fetcher = fetch, now = Date.now,
  logger = value => console.warn(JSON.stringify(value)) } = {}) {
  if (!username && !password) return null
  if (!username || !password) throw new Error('Both PDGA server credentials must be configured.')
  const credentials = { username, password }
  const cache = new Map()
  let inFlight = null
  let windowStart = now()
  let requests = 0
  const prune = () => {
    for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key)
  }
  const sweep = setInterval(prune, 60_000).unref()
  const put = (key, value, expiresAt) => {
    cache.delete(key)
    while (cache.size >= 100) cache.delete(cache.keys().next().value)
    cache.set(key, { value, expiresAt })
  }
  const read = async (key, load) => {
    prune()
    if (cache.has(key)) return cache.get(key)
    if (inFlight?.key === key) return inFlight.promise
    if (inFlight) throw unavailable('pdga_busy')
    if (now() - windowStart >= 60_000) { requests = 0; windowStart = now() }
    if (++requests > 20) throw unavailable('pdga_rate_limited')
    const promise = (async () => {
      try {
        const value = await load()
        const expiresAt = now() + pdgaCacheMs
        put(key, value, expiresAt)
        for (const course of Array.isArray(value) ? value : value ? [value] : []) put(course.id, course, expiresAt)
        return { value, expiresAt }
      } catch {
        logger({ event: 'pdga_request_failed', code: 'pdga_unavailable' })
        throw unavailable('pdga_unavailable')
      } finally { inFlight = null }
    })()
    inFlight = { key, promise }
    return promise
  }
  return {
    search: query => read(`search:${query.trim().toLowerCase()}`, () => searchPdga(credentials, query, fetcher)),
    course: id => read(id, () => readPdgaCourse(credentials, id, fetcher)),
    clear: () => cache.clear(),
    close: () => { clearInterval(sweep); cache.clear() },
  }
}
