import { pdgaAttribution } from './pdga-client.mjs'
import { latestEventLayouts } from './pdga-layouts.mjs'

export async function courseRequest({ req, url, json, pdga = null }) {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' })
  const match = url.pathname.match(/^\/api\/v1\/courses\/(pdga:[1-9][0-9]{0,15})\/(holes|layouts|maps)$/)
  const search = url.pathname === '/api/v1/courses'
  if (!match && !search) return json(404, { error: 'course_not_found' })
  if ([...url.searchParams.keys()].some(k => !search || k !== 'q')) return json(400, { error: 'invalid_query' })
  const query = url.searchParams.get('q')?.trim() ?? ''
  if (query.length > 100) return json(400, { error: 'invalid_query' })
  if (!pdga) return json(503, { error: 'pdga_not_configured' })
  try {
    if (search) {
      if (query.length < 2) return json(200, { courses: [], attribution: pdgaAttribution })
      const { value, expiresAt } = await pdga.search(query)
      return json(200, { courses: value.map(c => ({ ...c, expiresAt })), attribution: pdgaAttribution })
    }
    if (match[2] === 'maps') {
      const { value, expiresAt } = await pdga.maps(match[1])
      return json(200, { maps: value, expiresAt, attribution: pdgaAttribution })
    }
    if (match[2] === 'layouts') {
      const { value, expiresAt } = await pdga.layouts(match[1])
      return json(200, { layouts: latestEventLayouts(value), expiresAt, attribution: pdgaAttribution })
    }
    const { value: course, expiresAt } = await pdga.course(match[1])
    if (!course) return json(404, { error: 'course_not_found' })
    return json(200, { course, holes: [], expiresAt, attribution: pdgaAttribution,
      coverage: { note: 'Choose a historical PDGA event layout in the planner to view its hole details. Event layouts may differ from the current course.' } })
  } catch (error) {
    const allowed = ['pdga_busy', 'pdga_rate_limited', 'pdga_unavailable', 'pdga_layouts_not_configured', 'course_not_found']
    return json(error.code === 'course_not_found' ? 404 : error.code === 'pdga_rate_limited' ? 429 : 503,
      { error: allowed.includes(error.code) ? error.code : 'pdga_unavailable',
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) })
  }
}
