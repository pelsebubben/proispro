import { pathToFileURL } from 'node:url'

const base = 'https://api.pdga.com/services/json/'
const maxBytes = 2 * 1024 * 1024
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
    throw new Error('PDGA request failed (network, timeout, or redirect). Response details suppressed.')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`PDGA request rejected (HTTP ${response.status}). Check API access and credentials; response body suppressed.`)
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
    throw new Error('PDGA returned an invalid or oversized response. Response details suppressed.')
  }
}

// Only documented, non-personal course fields leave the API session.
function courseSummary(value) {
  if (!value || typeof value !== 'object' || typeof value.course_name !== 'string' ||
      !/^\d+$/.test(String(value.course_id))) throw new Error('PDGA returned an unexpected course record.')
  const text = key => typeof value[key] === 'string' ? value[key].slice(0, 300) : null
  const number = key => value[key] !== null && value[key] !== undefined && value[key] !== '' &&
    Number.isFinite(Number(value[key])) ? Number(value[key]) : null
  return { id: String(value.course_id), name: text('course_name'), city: text('city'),
    country: text('country'), holes: number('holes'), latitude: number('latitude'), longitude: number('longitude') }
}

export async function testPdga({ username, password }, fetcher = fetch) {
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    throw new Error('PDGA username and password are required through the hidden-prompt launcher.')
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
      if (!Array.isArray(data?.courses) || data.courses.length > 10) {
        throw new Error('PDGA returned an unexpected course-search response.')
      }
      return data.courses.map(courseSummary)
    }
    const ekeberg = await search({ country: 'NO', course_name: 'Ekeberg', limit: '10' })
    const norwaySample = await search({ country: 'NO', limit: '10' })
    return { source: 'Course data provided by PDGA: https://www.pdga.com/',
      scope: 'Read-only test; no data imported or credentials saved. Norway sample is not a total count.',
      ekeberg, norwaySample }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''
  try {
    if (process.argv.length !== 2 || process.stdin.isTTY) throw new Error('Use scripts\\test-pdga.ps1; do not pass credentials as arguments.')
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8')
      if (input.length > 16_384) throw new Error('Credential input exceeds limit.')
    }
    let credentials
    try { credentials = JSON.parse(input) } catch { throw new Error('Invalid credential input; contents suppressed.') }
    input = ''
    const result = await testPdga(credentials)
    credentials.password = ''
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    // Only errors created by this module are surfaced, never API bodies or credentials.
    console.error(error instanceof Error ? error.message : 'PDGA test failed; details suppressed.')
    process.exitCode = 1
  } finally { input = '' }
}
