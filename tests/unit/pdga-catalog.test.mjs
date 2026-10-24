import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPdgaNorway } from '../../server/pdga-client.mjs'

const credentials = { username: 'fixture', password: 'synthetic-test-only' }
const session = { session_name: 'SSESS_fixture', sessid: 'fixture', token: 'fixture' }
const record = n => ({ course_id: String(n), course_node_nid: String(n + 1000), course_name: `Course ${n}`,
  country: 'Norway', city: 'Oslo', holes: '18', latitude: '59.9', longitude: '10.7', contact_email: 'PRIVATE' })

function api(page) {
  const calls = []
  return {
    calls,
    fetch: async (url, options) => {
      calls.push(new URL(url))
      assert.equal(new URL(url).origin, 'https://api.pdga.com')
      assert.equal(options.redirect, 'error')
      if (url.endsWith('/login')) return Response.json(session)
      if (url.endsWith('/logout')) return Response.json(true)
      const params = new URL(url).searchParams
      assert.equal(params.get('country'), 'NO')
      assert.equal(params.get('limit'), '200')
      return page(Number(params.get('offset')))
    },
  }
}

test('Norway fetch paginates completely, keeps provenance, excludes PII, and confirms logout', async () => {
  const fixture = api(offset => Response.json({ courses: Array.from({ length: offset === 0 ? 200 : 17 }, (_, i) => record(offset + i + 1)) }))
  const snapshot = await fetchPdgaNorway(credentials, fixture.fetch)
  assert.equal(snapshot.courses.length, 217)
  assert.equal(snapshot.courses[200].id, '201')
  assert.equal(snapshot.courses[0].source_url, 'https://www.pdga.com/node/1001')
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'))
  assert.ok(Date.parse(snapshot.fetchedAt) <= Date.now())
  assert.equal(fixture.calls.at(-1).pathname, '/services/json/user/logout')
})

test('duplicate pages, failed pages, wrong countries and small snapshots fail closed with logout', async () => {
  const full = Array.from({ length: 200 }, (_, i) => record(i + 1))
  for (const [page, message] of [
    [() => Response.json({ courses: full }), /duplicate/],
    [offset => offset ? new Response('PRIVATE', { status: 502 }) : Response.json({ courses: full }), /HTTP 502/],
    [() => Response.json({ courses: [{ ...record(1), country: 'Sweden' }] }), /outside Norway/],
    [() => Response.json({ courses: [record(1)] }), /small/],
    [() => Response.json({ courses: 'PRIVATE' }), /unexpected/],
  ]) {
    const fixture = api(page)
    await assert.rejects(fetchPdgaNorway(credentials, fixture.fetch), message)
    assert.equal(fixture.calls.at(-1).pathname, '/services/json/user/logout')
  }
})

test('exact page multiples require a final empty page; unbounded distinct pages are rejected', async () => {
  const exact = api(offset => Response.json({ courses: offset === 0 ? Array.from({ length: 200 }, (_, i) => record(i + 1)) : [] }))
  assert.equal((await fetchPdgaNorway(credentials, exact.fetch)).courses.length, 200)
  assert.equal(exact.calls[2].searchParams.get('offset'), '200')
  const endless = api(offset => Response.json({ courses: Array.from({ length: 200 }, (_, i) => record(offset + i + 1)) }))
  await assert.rejects(fetchPdgaNorway(credentials, endless.fetch), /safety limit/)
  assert.equal(endless.calls.length, 27)
  assert.equal(endless.calls.at(-1).pathname, '/services/json/user/logout')
})
