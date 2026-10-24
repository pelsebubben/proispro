const base = 'https://api.pdga.com/services/json/'
const maxBytes = 2 * 1024 * 1024
const failure = (message, phase, code, status) => Object.assign(new Error(message), { pdgaPhase: phase, pdgaFailure: code, pdgaHttpStatus: status })
const validSession = session => session &&
  typeof session.session_name === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(session.session_name) &&
  typeof session.sessid === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(session.sessid) &&
  typeof session.token === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(session.token)

async function request(fetcher, endpoint, options = {}) {
  let response
  try {
    response = await fetcher(base + endpoint, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', ...options.headers },
    })
  } catch {
    throw failure('PDGA request failed (network, timeout, or redirect). Response details suppressed.',endpoint.split('?')[0],'network')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw failure(`PDGA request rejected (HTTP ${response.status}). Check API access and credentials; response body suppressed.`,endpoint.split('?')[0],'http',response.status)
  }
  try {
    const chunks = []
    let bytes = 0
    if (!response.body) throw new Error()
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new Error()
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw failure('PDGA returned an invalid or oversized response. Response details suppressed.',endpoint.split('?')[0],'invalid_response')
  }
}

// Only documented, non-personal course fields leave the API session.
function courseSummary(value) {
  if (!value || typeof value !== 'object' || typeof value.course_name !== 'string' ||
      !/^\d+$/.test(String(value.course_id))) throw new Error('PDGA returned an unexpected course record.')
  const text = key => typeof value[key] === 'string' ? value[key].slice(0, 300) : null
  const number = key => value[key] !== null && value[key] !== undefined && value[key] !== '' &&
    Number.isFinite(Number(value[key])) ? Number(value[key]) : null
  const nodeId = String(value.course_node_nid ?? '')
  return { id: String(value.course_id), name: text('course_name'), city: text('city'),
    source_url: /^[1-9][0-9]{0,15}$/.test(nodeId) ? `https://www.pdga.com/node/${nodeId}` : null,
    country: text('country'), holes: number('holes'), latitude: number('latitude'), longitude: number('longitude') }
}

async function withSession({ username, password }, operation, fetcher) {
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    throw new Error('PDGA username and password are required through secure server configuration or the hidden-prompt launcher.')
  }
  let session
  try {
    session = await request(fetcher, 'user/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    if (!validSession(session)) {
      throw new Error('PDGA login did not return a valid documented API session. No response details printed.')
    }
    const headers = { Cookie: `${session.session_name}=${session.sessid}` }
    const search = async query => {
      const data = await request(fetcher, `course?${new URLSearchParams(query)}`, { headers })
      if (!Array.isArray(data?.courses) || data.courses.length > Number(query.limit)) {
        throw new Error('PDGA returned an unexpected course-search response.')
      }
      return data.courses.map(courseSummary)
    }
    return await operation(search)
  } finally {
    if (validSession(session)) {
      const loggedOut = await request(fetcher, 'user/logout', { method: 'POST',
        headers: { Cookie: `${session.session_name}=${session.sessid}`, 'X-CSRF-Token': session.token } })
      if (loggedOut !== true && !(Array.isArray(loggedOut) && loggedOut.length === 1 && loggedOut[0] === true)) {
        throw new Error('PDGA did not confirm API logout. Session tokens were not persisted; check your PDGA sessions.')
      }
    }
  }
}

export const pdgaAttribution = {
  text: 'Player, event, and course data provided by PDGA.', url: 'https://www.pdga.com/', license: 'PDGA API agreement',
}

export function testPdga(credentials, fetcher = fetch) {
  return withSession(credentials, async search => ({
    source: 'Course data provided by PDGA: https://www.pdga.com/',
    scope: 'Read-only test; no data imported or credentials saved. Norway sample is not a total count.',
    ekeberg: await search({ country: 'NO', course_name: 'Ekeberg', limit: '10' }),
    norwaySample: await search({ country: 'NO', limit: '10' }),
  }), fetcher)
}

export function searchPdga(credentials, query, fetcher = fetch) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) throw new Error('Invalid PDGA search.')
  return withSession(credentials, async search => {
    return validateCourses(await search({ country: 'NO', course_name: query.trim(), limit: '30' }))
  }, fetcher)
}

function validateCourses(courses) {
  const ids = new Set()
  for (const course of courses) {
    if (!/^[1-9][0-9]{0,15}$/.test(course.id) || ids.has(course.id) || !course.name?.trim() ||
        !['Norway', 'NO'].includes(course.country) || !course.source_url ||
        (course.holes !== null && (!Number.isInteger(course.holes) || course.holes < 1 || course.holes > 200)) ||
        (course.latitude !== null && (course.latitude < 57 || course.latitude > 82)) ||
        (course.longitude !== null && (course.longitude < -10 || course.longitude > 36))) {
      throw new Error('PDGA returned an unexpected course record.')
    }
    ids.add(course.id)
  }
  return courses.map(c => ({ id: `pdga:${c.id}`, source: 'pdga', source_url: c.source_url,
    name: c.name, city: c.city ?? '', country: 'NO', lat: c.latitude, lon: c.longitude,
    expected_holes: c.holes, mapped_holes: 0, active: true }))
}

export function readPdgaCourse(credentials, id, fetcher = fetch) {
  if (!/^pdga:[1-9][0-9]{0,15}$/.test(id)) throw new Error('Invalid PDGA course ID.')
  return withSession(credentials, async search => {
    const courses = validateCourses(await search({ country: 'NO', course_id: id.slice(5), limit: '1' }))
    if (courses.length && courses[0].id !== id) throw new Error('PDGA returned a different course.')
    return courses[0] ?? null
  }, fetcher)
}
