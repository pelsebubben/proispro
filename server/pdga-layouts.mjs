import { createHash } from 'node:crypto'

const numericId = value => /^[1-9][0-9]{0,15}$/.test(String(value))
const invalid = () => { throw new Error('Invalid provider layout response') }
const text = (value, max) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > max) invalid()
  return value.trim()
}
const number = (value, min, max, integer = false) => {
  if (value == null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      integer && !Number.isInteger(value)) invalid()
  return value
}
const eventDate = value => {
  if (value == null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid()
  const iso = value.match(/^\d{4}-\d{2}-\d{2}(?:T|$)/)
  if (iso) return value.slice(0, 10)
  // Provider calendar dates must not shift with the server's local timezone.
  const timestamp = Date.parse(`${value} UTC`)
  if (!Number.isFinite(timestamp)) invalid()
  return new Date(timestamp).toISOString().slice(0, 10)
}

// Routes are protected operational configuration, not distributed API documentation.
export function layoutConfiguration(indexTemplate, overviewTemplate) {
  if (!indexTemplate && !overviewTemplate) return null
  const validate = (template, token) => {
    if (typeof template !== 'string' || template.split(token).length !== 2) invalid()
    const url = new URL(template.replace(token, '1'))
    if (url.origin !== 'https://www.pdga.com' || !url.pathname.startsWith('/api/') ||
        url.username || url.password || url.hash) invalid()
    return template
  }
  return {
    index: validate(indexTemplate, '{courseId}'),
    overview: validate(overviewTemplate, '{tournId}'),
  }
}

async function request(url, fetcher) {
  let response
  try {
    response = await fetcher(url, { headers: { Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30_000) })
  } catch {
    throw Object.assign(new Error('Provider network failure'), { pdgaPhase: 'layouts', pdgaFailure: 'network' })
  }
  if (!response.ok) {
    await response.body?.cancel()
    const seconds = response.headers.get('retry-after')
    throw Object.assign(new Error('Provider HTTP failure'), {
      pdgaPhase: 'layouts', pdgaFailure: 'http', pdgaHttpStatus: response.status,
      retryAfterMs: /^\d+$/.test(seconds ?? '') ? Math.min(86400, Math.max(60, Number(seconds))) * 1000 : 15 * 60_000,
    })
  }
  try {
    const chunks = []
    let bytes = 0
    if (!response.body) invalid()
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > 8 * 1024 * 1024) invalid()
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch { throw new Error('Invalid provider response') }
}

function summary(row, nodeId) {
  if (!row || !numericId(row.layoutId) || !numericId(row.tournId) ||
      String(row.courseId) !== nodeId) invalid()
  const units = row.units
  if (!['Meters', 'Feet'].includes(units)) invalid()
  const date = eventDate(row.liveTournament?.startDate)
  const name = text(row.name, 100)
  if (!name) invalid()
  return {
    layout_id: String(row.layoutId), tournament_id: String(row.tournId), node_id: nodeId,
    name, hole_count: number(row.holes, 1, 72, true), par: number(row.par, 1, 1080, true),
    length: number(row.length, 0, 200000), units,
    event_name: text(row.liveTournament?.tournamentName, 300),
    event_date: date,
  }
}

export async function readEventLayouts(config, course, fetcher = fetch) {
  const nodeId = course.source_url?.match(/^https:\/\/www\.pdga\.com\/node\/([1-9][0-9]{0,15})$/)?.[1]
  if (!nodeId) invalid()
  const rows = await request(config.index.replace('{courseId}', nodeId), fetcher)
  if (!Array.isArray(rows) || rows.length > 500) invalid()
  const layouts = rows.map(row => summary(row, nodeId))
  if (new Set(layouts.map(l => `${l.tournament_id}:${l.layout_id}`)).size !== layouts.length) invalid()
  return sortEventLayouts(layouts)
}

function sortEventLayouts(layouts) {
  return [...layouts].sort((a, b) =>
    (b.event_date === null ? -Infinity : Date.parse(b.event_date)) -
      (a.event_date === null ? -Infinity : Date.parse(a.event_date)) ||
    b.tournament_id.localeCompare(a.tournament_id, undefined, { numeric: true }) ||
    a.layout_id.localeCompare(b.layout_id, undefined, { numeric: true }))
}

export function latestEventLayouts(layouts) {
  const sorted = sortEventLayouts(layouts)
  const events = new Set()
  for (const layout of sorted) {
    events.add(layout.tournament_id)
    if (events.size === 2) break
  }
  return sorted.filter(layout => events.has(layout.tournament_id))
}

function holeId(layout, hole) {
  const hex = createHash('sha256').update(`${layout.node_id}:${layout.tournament_id}:${layout.layout_id}:${hole}`).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}

export async function readEventLayout(config, selected, fetcher = fetch) {
  const data = await request(config.overview.replace('{tournId}', selected.tournament_id), fetcher)
  if (String(data?.tournId) !== selected.tournament_id || !Array.isArray(data.liveLayouts) ||
      data.liveLayouts.length > 500) invalid()
  const matches = data.liveLayouts.filter(row => String(row.layoutId) === selected.layout_id &&
    String(row.courseId) === selected.node_id)
  if (matches.length !== 1) invalid()
  const row = matches[0]
  const normalized = summary({ ...row, tournId: data.tournId,
    liveTournament: { tournamentName: selected.event_name, startDate: selected.event_date } }, selected.node_id)
  if (!Array.isArray(row.liveLayoutDetails) || row.liveLayoutDetails.length !== normalized.hole_count) invalid()
  const holes = row.liveLayoutDetails.map(hole => {
    if (String(hole.layoutId) !== selected.layout_id || !numericId(hole.layoutDetailId)) invalid()
    const label = text(hole.label, 40)
    if (!label) invalid()
    const length = number(hole.length, 0, 10000)
    return {
      id: holeId(selected, String(hole.layoutDetailId)), label, ordinal: number(hole.holeOrdinal, 1, 200, true),
      par: number(hole.par, 1, 15, true), distance_m: length === null || length === 0 ? null :
        Math.round(length * (row.units === 'Feet' ? 0.3048 : 1) * 100) / 100,
      length, units: row.units, tee: text(hole.tee, 100), target: text(hole.target, 100), notes: text(hole.notes, 500),
    }
  }).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  if (new Set(holes.map(h => h.id)).size !== holes.length ||
      new Set(holes.map(h => h.ordinal)).size !== holes.length) invalid()
  return { ...normalized, holes }
}
