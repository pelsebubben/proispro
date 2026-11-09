import { createHash } from 'node:crypto'
import { searchPdga, readPdgaCourse } from './pdga-client.mjs'
import { layoutConfiguration, readEventLayouts, readEventLayout } from './pdga-layouts.mjs'
import { readCourseMaps } from './pdga-maps.mjs'

export const pdgaCacheMs = 24 * 60 * 60_000
const unavailable = (code, retryAfterMs) => Object.assign(new Error(code),
  { code, ...(retryAfterMs ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) } : {}) })

export function createPdgaService({ username, password, pool, fetcher = fetch, now = Date.now,
  indexTemplate, overviewTemplate, logger = value => console.warn(JSON.stringify(value)) } = {}) {
  if (!username && !password) return null
  if (!username || !password) throw new Error('Both PDGA server credentials must be configured.')
  if (!pool) throw new Error('PDGA requires a PostgreSQL cache.')
  const credentials = { username, password }
  const config = layoutConfiguration(indexTemplate, overviewTemplate)
  const inFlight = new Map()
  const log = error => logger({ event: 'pdga_request_failed',
    code: error?.pdgaHttpStatus === 429 ? 'pdga_rate_limited' : 'pdga_unavailable',
    phase: ['user/login','course','user/logout','layouts'].includes(error?.pdgaPhase) ? error.pdgaPhase : 'validation',
    reason: ['network','http','invalid_response'].includes(error?.pdgaFailure) ? error.pdgaFailure : 'unexpected_response',
    httpStatus: Number.isInteger(error?.pdgaHttpStatus) && error.pdgaHttpStatus >= 400 && error.pdgaHttpStatus <= 599 ? error.pdgaHttpStatus : null })
  const prune = () => pool.query('DELETE FROM provider_cache.entries WHERE expires_at <= now()')
  const sweep = setInterval(() => { void prune().catch(() => logger({ event: 'pdga_cache_cleanup_failed' })) }, 60_000).unref()
  const read = (key, load) => {
    const hash = createHash('sha256').update(key).digest('hex')
    if (inFlight.has(hash)) return inFlight.get(hash)
    const promise = (async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout='5s'")
        const cached = await client.query('SELECT value,expires_at FROM provider_cache.entries WHERE key=$1 AND expires_at>now()', [hash])
        if (cached.rowCount) {
          await client.query('COMMIT')
          return { value: cached.rows[0].value, expiresAt: new Date(cached.rows[0].expires_at).getTime() }
        }
        // Serialize misses across replicas; cached reads never acquire this provider lock.
        const lock = await client.query('SELECT pg_try_advisory_xact_lock(72491928) AS acquired')
        if (!lock.rows[0].acquired) throw unavailable('pdga_busy')
        const second = await client.query('SELECT value,expires_at FROM provider_cache.entries WHERE key=$1 AND expires_at>now()', [hash])
        if (second.rowCount) {
          await client.query('COMMIT')
          return { value: second.rows[0].value, expiresAt: new Date(second.rows[0].expires_at).getTime() }
        }
        const control = (await client.query('SELECT * FROM provider_cache.control WHERE id FOR UPDATE')).rows[0]
        const blockedFor = new Date(control.blocked_until).getTime() - now()
        if (blockedFor > 0) throw unavailable('pdga_rate_limited', blockedFor)
        const reset = now() - new Date(control.window_start).getTime() >= 60_000
        if (!reset && control.requests >= 20) throw unavailable('pdga_rate_limited', 60_000 - (now() - new Date(control.window_start).getTime()))
        await client.query(`UPDATE provider_cache.control SET requests=$1,window_start=$2 WHERE id`,
          [reset ? 1 : control.requests + 1, reset ? new Date(now()) : control.window_start])
        let value
        try { value = await load() } catch (error) {
          log(error)
          if (error?.pdgaHttpStatus === 429) {
            await client.query('UPDATE provider_cache.control SET blocked_until=$1 WHERE id',
              [new Date(now() + (error.retryAfterMs ?? 15 * 60_000))])
          }
          // Persist the miss budget and upstream cooldown even when the provider fails.
          await client.query('COMMIT')
          throw unavailable(error?.pdgaHttpStatus === 429 ? 'pdga_rate_limited' : 'pdga_unavailable',
            error?.pdgaHttpStatus === 429 ? error.retryAfterMs ?? 15 * 60_000 : undefined)
        }
        const expiresAt = now() + pdgaCacheMs
        await client.query('DELETE FROM provider_cache.entries WHERE expires_at<=now()')
        await client.query(`DELETE FROM provider_cache.entries WHERE key IN
          (SELECT key FROM provider_cache.entries ORDER BY expires_at DESC OFFSET 499)`)
        await client.query(`INSERT INTO provider_cache.entries(key,value,expires_at) VALUES($1,$2,$3)
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at`,
        [hash, JSON.stringify(value), new Date(expiresAt)])
        // Reuse validated search results when resolving pins without extra authenticated requests.
        if (key.startsWith('search:')) for (const course of value) {
          const courseKey = createHash('sha256').update(course.id).digest('hex')
          await client.query(`INSERT INTO provider_cache.entries(key,value,expires_at) VALUES($1,$2,$3)
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at`,
          [courseKey, JSON.stringify(course), new Date(expiresAt)])
        }
        await client.query(`DELETE FROM provider_cache.entries WHERE key IN
          (SELECT key FROM provider_cache.entries ORDER BY expires_at DESC,key OFFSET 500)`)
        await client.query('COMMIT')
        return { value, expiresAt }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    })().finally(() => inFlight.delete(hash))
    inFlight.set(hash, promise)
    return promise
  }
  const course = id => read(id, () => readPdgaCourse(credentials, id, fetcher))
  const layouts = async id => {
    if (!config) throw unavailable('pdga_layouts_not_configured')
    const found = await course(id)
    if (!found.value) throw unavailable('course_not_found')
    // Earlier cache entries sliced non-ISO dates, losing part of the year.
    return read(`layouts:v2:${id}`, () => readEventLayouts(config, found.value, fetcher))
  }
  return {
    search: query => read(`search:${query.trim().toLowerCase()}`, () => searchPdga(credentials, query, fetcher)),
    course, layouts,
    maps: async id => {
      const found = await course(id)
      if (!found.value) throw unavailable('course_not_found')
      return read(`maps:v1:${id}`, () => readCourseMaps(found.value, fetcher))
    },
    layout: async (id, tournamentId, layoutId) => {
      const index = await layouts(id)
      const selected = index.value.find(l => l.tournament_id === tournamentId && l.layout_id === layoutId)
      if (!selected) throw unavailable('layout_not_found')
      return read(`layout:v2:${id}:${tournamentId}:${layoutId}`, () => readEventLayout(config, selected, fetcher))
    },
    clear: () => pool.query('DELETE FROM provider_cache.entries'),
    close: () => clearInterval(sweep),
  }
}
