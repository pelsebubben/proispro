// Only public OSM data enters this pipeline. Never infer course membership from proximity.
export const osmAttribution = {
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL-1.0',
}
export const norwayQuery = `[out:json][timeout:90];
area["ISO3166-1"="NO"]["admin_level"="2"]->.no;
(nwr(area.no)["leisure"="disc_golf_course"];
 relation(area.no)["type"="disc_golf_course"];
 way(area.no)["disc_golf"="hole"];);
out meta geom;`

const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter']
const maxBytes = 32 * 1024 * 1024
const key = element => `osm:${element.type}:${element.id}`
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const positive = (value, max, integer = false) => {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null
  const n = Number(value)
  return n > 0 && n <= max && (!integer || Number.isInteger(n)) ? n : null
}
const point = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lon) &&
  Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180
const position = element => point(element) ? element : element.bounds
  ? { lat: (element.bounds.minlat + element.bounds.maxlat) / 2, lon: (element.bounds.minlon + element.bounds.maxlon) / 2 }
  : element.geometry?.find(point)
const polygonOf = element => element.type === 'way' && element.nodes?.length >= 4 &&
  element.nodes[0] === element.nodes.at(-1) && element.geometry?.every(point) ? element.geometry : null

function contains(ring, p) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.lat > p.lat) !== (b.lat > p.lat) &&
        p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

function containsPath(ring, path) {
  if (!path.every(p => contains(ring, p))) return false
  const cross = (a, b, p) => (b.lon - a.lon) * (p.lat - a.lat) - (b.lat - a.lat) * (p.lon - a.lon)
  for (let i = 1; i < path.length; i++) {
    for (let j = 1; j < ring.length; j++) {
      const a = path[i - 1], b = path[i], c = ring[j - 1], d = ring[j]
      // Reject a crossing even when both endpoints lie inside a concave boundary.
      if (Math.max(a.lat, b.lat) >= Math.min(c.lat, d.lat) && Math.max(c.lat, d.lat) >= Math.min(a.lat, b.lat) &&
          Math.max(a.lon, b.lon) >= Math.min(c.lon, d.lon) && Math.max(c.lon, d.lon) >= Math.min(a.lon, b.lon) &&
          cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return false
    }
  }
  return true
}

export async function fetchNorwaySnapshot(fetcher = fetch) {
  const failures = []
  for (const endpoint of endpoints) {
    try {
      const response = await fetcher(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(115_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Griplock-CourseSync/1.0 (+https://github.com/pelsebubben/proispro)' },
        body: new URLSearchParams({ data: norwayQuery }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('Empty response')
      const chunks = []
      let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new Error('OSM response exceeds 32 MiB')
        chunks.push(chunk)
      }
      const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (snapshot.remark || !Array.isArray(snapshot.elements) || !snapshot.elements.length) throw new Error('OSM returned an incomplete snapshot')
      return snapshot
    } catch (error) {
      failures.push(`${new URL(endpoint).host}: ${error.message}`)
    }
  }
  throw new Error(`Norway OSM fetch failed; existing catalogue unchanged. ${failures.join('; ')}`)
}

export function normalizeNorway(snapshot, now = Date.now()) {
  const timestamp = snapshot?.osm3s?.timestamp_osm_base
  const sourceTime = Date.parse(timestamp)
  if (snapshot?.remark || !Array.isArray(snapshot?.elements) || snapshot.elements.length > 100_000 ||
      !Number.isFinite(sourceTime) || sourceTime > now + 300_000 || now - sourceTime > 7 * 86400_000) {
    throw new Error('Invalid, partial, or stale Norway OSM snapshot')
  }
  const elements = new Map()
  for (const element of snapshot.elements) {
    if (!['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0 ||
        !Number.isSafeInteger(element.version) || element.version <= 0 || !Number.isFinite(Date.parse(element.timestamp))) {
      throw new Error('Invalid OSM element metadata')
    }
    if (elements.has(key(element))) throw new Error('Duplicate OSM element')
    elements.set(key(element), element)
  }
  const candidates = [...elements.values()].filter(e => e.tags?.leisure === 'disc_golf_course' ||
    (e.type === 'relation' && e.tags?.type === 'disc_golf_course'))
  const courses = []
  const sourceCourses = new Map()
  let skippedCourses = 0
  for (const e of candidates) {
    const p = position(e)
    const name = text(e.tags.name, 300)
    if (!point(p) || !name) { skippedCourses++; continue }
    // Fail closed if a country query is accidentally replaced with a world snapshot.
    if (p.lat < 57 || p.lat > 82 || p.lon < -10 || p.lon > 36) throw new Error('Course outside Norway safety bounds')
    const row = { id: key(e), name, city: text(e.tags['addr:city'], 200), latitude: p.lat, longitude: p.lon,
      expected_holes: positive(e.tags.holes, 200, true) ?? positive(e.tags['disc_golf:course']?.replace(/_hole$/, ''), 200, true),
      source_version: e.version, source_updated_at: e.timestamp }
    courses.push(row)
    sourceCourses.set(row.id, e)
  }
  const rawHoles = [...elements.values()].filter(e => e.type === 'way' && e.tags?.disc_golf === 'hole')
  const holes = []
  let unassociated = 0, ambiguous = 0, invalid = 0
  for (const e of rawHoles) {
    const geometry = e.geometry
    const ref = text(e.tags.ref, 40)
    if (!ref || !Array.isArray(geometry) || geometry.length < 2 || geometry.length > 2000 || !geometry.every(point)) { invalid++; continue }
    const relations = courses.filter(c => sourceCourses.get(c.id).type === 'relation' &&
      sourceCourses.get(c.id).members?.some(m => m.type === 'way' && m.ref === e.id && ['hole', ''].includes(m.role)))
    const matches = relations.length ? relations : courses.filter(c => {
      const polygon = polygonOf(sourceCourses.get(c.id))
      return polygon && containsPath(polygon, geometry)
    })
    if (!matches.length) { unassociated++; continue }
    if (matches.length !== 1) { ambiguous++; continue }
    holes.push({ course_id: matches[0].id, id: key(e), ref, name: text(e.tags.name, 300),
      par: positive(e.tags.par, 20, true) ?? positive(e.tags['disc_golf:par'], 20, true),
      length_m: positive(e.tags.dist, 5000) ?? positive(e.tags['disc_golf:length'], 5000),
      geometry: geometry.map(p => [p.lon, p.lat]), association: relations.length ? 'relation' : 'boundary',
      source_version: e.version, source_updated_at: e.timestamp })
  }
  // Duplicate numbers may represent alternative tees/layouts. Do not invent a layout.
  const counts = new Map()
  for (const hole of holes) {
    const k = `${hole.course_id}/${hole.ref}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const accepted = holes.filter(h => counts.get(`${h.course_id}/${h.ref}`) === 1)
  const mapped = new Map()
  for (const h of accepted) mapped.set(h.course_id, (mapped.get(h.course_id) ?? 0) + 1)
  const report = { country: 'NO', courseObjects: candidates.length, importedCourses: courses.length, skippedCourses,
    holeWays: rawHoles.length, importedHoles: accepted.length, unassociatedHoles: unassociated,
    ambiguousHoles: ambiguous + holes.length - accepted.length, invalidHoles: invalid,
    coursesWithHoles: mapped.size,
    coursesWithExpectedHoleCount: courses.filter(c => c.expected_holes !== null).length,
    coursesMatchingExpectedCount: courses.filter(c => c.expected_holes !== null && mapped.get(c.id) === c.expected_holes).length }
  return { timestamp, courses, holes: accepted, report }
}
