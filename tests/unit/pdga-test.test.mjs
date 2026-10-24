import assert from 'node:assert/strict'
import test from 'node:test'
import { testPdga } from '../../scripts/pdga-test.mjs'

const credentials = { username: 'synthetic-user', password: 'synthetic-password-not-a-real-secret' }
const session = { session_name: 'SSESS_fixture', sessid: 'synthetic-session', token: 'synthetic-csrf' }
const course = { course_id: '123', course_node_nid: '999', course_name: 'Ekeberg fixture', holes: '18', latitude: '59.9', longitude: '10.7',
  city: 'Oslo', country: 'Norway', contact_name: 'PRIVATE', contact_home_phone: 'PRIVATE', token: 'PRIVATE' }

test('PDGA test uses fixed HTTPS API, bounded read-only searches, in-memory auth, and verified logout', async () => {
  const calls = []
  const result = await testPdga(credentials, async (url, options) => {
    calls.push({ url, options })
    assert.equal(new URL(url).origin, 'https://api.pdga.com')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal)
    if (url.endsWith('/login')) {
      assert.deepEqual(JSON.parse(options.body), credentials)
      return Response.json({ ...session, user: { mail: 'PRIVATE' } })
    }
    assert.equal(options.headers.Cookie, 'SSESS_fixture=synthetic-session')
    if (url.endsWith('/logout')) {
      assert.equal(options.method, 'POST')
      assert.equal(options.headers['X-CSRF-Token'], session.token)
      return Response.json([true])
    }
    assert.equal(options.method, undefined)
    assert.equal(new URL(url).searchParams.get('country'), 'NO')
    assert.equal(new URL(url).searchParams.get('limit'), '10')
    return Response.json({ courses: [course], sessid: session.sessid, token: session.token })
  })
  assert.equal(calls.length, 4)
  assert.equal(new URL(calls[1].url).searchParams.get('course_name'), 'Ekeberg')
  assert.equal(result.ekeberg[0].holes, 18)
  assert.deepEqual(Object.keys(result.ekeberg[0]).sort(), ['city', 'country', 'holes', 'id', 'latitude', 'longitude', 'name', 'source_url'])
  for (const value of [...Object.values(credentials), ...Object.values(session), 'PRIVATE']) {
    assert.ok(!JSON.stringify(result).includes(value))
  }
})

test('PDGA logs out after search failure and suppresses secret-bearing server errors', async () => {
  let logout = false
  await assert.rejects(testPdga(credentials, async url => {
    if (url.endsWith('/login')) return Response.json(session)
    if (url.endsWith('/logout')) { logout = true; return Response.json(true) }
    return new Response('SECRET password and cookie body', { status: 403 })
  }), error => /HTTP 403/.test(error.message) && !/SECRET/.test(error.message))
  assert.ok(logout)
  await assert.rejects(testPdga(credentials, async () => { throw new Error(credentials.password) }),
    error => /network/.test(error.message) && !error.message.includes(credentials.password))
})

test('PDGA refuses unsafe session headers and malformed responses without exposing them', async () => {
  let calls = 0
  await assert.rejects(testPdga(credentials, async () => {
    calls++
    return Response.json({ ...session, sessid: 'bad\r\ninjected: value' })
  }), /valid documented API session/)
  assert.equal(calls, 1)
  await assert.rejects(testPdga(credentials, async () => Response.json({})), /valid documented API session/)
  await assert.rejects(testPdga(credentials, async () => new Response('PRIVATE invalid json')), /invalid or oversized/)
  await assert.rejects(testPdga({ username: '', password: '' }), /required/)
})

test('PDGA validates response shape and reports failed logout rather than claiming success', async () => {
  await assert.rejects(testPdga(credentials, async url => {
    if (url.endsWith('/login')) return Response.json(session)
    if (url.endsWith('/logout')) return Response.json(true)
    return Response.json({ user: 'PRIVATE' })
  }), /unexpected course-search/)
  await assert.rejects(testPdga(credentials, async url => {
    if (url.endsWith('/login')) return Response.json(session)
    if (url.endsWith('/logout')) return Response.json([false])
    return Response.json({ courses: [] })
  }), /did not confirm API logout/)
})
