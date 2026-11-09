import assert from 'node:assert/strict'
import test from 'node:test'
import { courseMapUrl, readCourseMaps } from '../../server/pdga-maps.mjs'
import { courseRequest } from '../../server/courses.mjs'

const course = { source_url: 'https://www.pdga.com/node/27415' }
const page = content => new Response(`<div class="views-field-field-course-map-revision-id">${content}</div>
  <div class="views-field-field-course-photo-revision-id"><img src="/files/course_maps/not-a-map.jpg"></div>`,
{ headers: { 'content-type': 'text/html' } })

test('maps accept only PDGA course map files, never arbitrary embeds or scripts', async () => {
  for (const url of ['javascript:alert(1)', 'https://evil.invalid/files/course_maps/a.pdf',
    'http://www.pdga.com/files/course_maps/a.pdf', '//evil.invalid/files/course_maps/a.pdf',
    'https://user@www.pdga.com/files/course_maps/a.pdf', '/files/course_maps/a.html',
    '/files/course_maps/a.pdf?script=1', '/files/course_maps/%2e%2e/a.pdf']) {
    assert.equal(courseMapUrl(url), null, url)
  }
  const maps = await readCourseMaps(course, async (url, options) => {
    assert.equal(url, `${course.source_url}?qt-course_node=1`)
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.Authorization, undefined)
    return page(`<iframe src="/sites/viewer.html?file=ignored" data-src="https://www.pdga.com/files/course_maps/layout.pdf"></iframe>
      <a href="/files/course_maps/layout.pdf">same</a><img src="/files/course_maps/map.jpg">
      <iframe src="https://evil.invalid/map.pdf"></iframe>`)
  })
  assert.deepEqual(maps, [
    { url: 'https://www.pdga.com/files/course_maps/layout.pdf', kind: 'pdf', label: 'Course map 1' },
    { url: 'https://www.pdga.com/files/course_maps/map.jpg', kind: 'image', label: 'Course map 2' },
  ])
  assert.deepEqual(await readCourseMaps(course, async () => page('This course has no maps.')), [])
  await assert.rejects(readCourseMaps(course, async () => page('<iframe src="https://evil.invalid/embed"></iframe>')),
    /not supported/)
  await assert.rejects(readCourseMaps(course, async () => new Response('changed', { headers: { 'content-type': 'text/html' } })),
    /structure changed/)
  await assert.rejects(readCourseMaps(course, async () => page('x'.repeat(2 * 1024 * 1024))), /too large/)
  await assert.rejects(readCourseMaps({ source_url: 'https://evil.invalid' }), /identity/)
})

test('public media redirects are bounded and cannot leave PDGA, HTTP failures stay explicit', async () => {
  let calls = 0
  const maps = await readCourseMaps(course, async url => {
    calls++
    if (calls === 1) return new Response(null, { status: 301, headers: { location: '/course-directory/course/fixture?qt-course_node=1' } })
    assert.equal(url, 'https://www.pdga.com/course-directory/course/fixture?qt-course_node=1')
    return page('This course has no maps.')
  })
  assert.deepEqual(maps, [])
  assert.equal(calls, 2)
  for (const location of ['https://evil.invalid/map', 'http://www.pdga.com/map']) {
    let redirects = 0
    await assert.rejects(readCourseMaps(course, async () => {
      redirects++
      return new Response(null, { status: 302, headers: { location } })
    }), /redirect/)
    assert.equal(redirects, 1)
  }
  await assert.rejects(readCourseMaps(course, async () => new Response(null, { status: 302, headers: { location: '/loop' } })), /redirect/)
  await assert.rejects(readCourseMaps(course, async () => new Response(null, { status: 429 })), { pdgaHttpStatus: 429 })
  await assert.rejects(readCourseMaps(course, async () => Response.json({})), /response/)
})

test('course maps endpoint exposes only normalized maps and expiry for the requested identity', async () => {
  const response = await courseRequest({
    req: { method: 'GET' }, url: new URL('http://localhost/api/v1/courses/pdga:4550/maps'),
    pdga: { maps: async id => { assert.equal(id, 'pdga:4550'); return { value: [], expiresAt: 123 } } },
    json: (status, body) => ({ status, body }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.maps, [])
  assert.equal(response.body.expiresAt, 123)
})
