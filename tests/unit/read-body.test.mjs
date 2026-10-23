import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Agent, createServer, request } from 'node:http'
import { Readable } from 'node:stream'
import test from 'node:test'
import { readBody } from '../../server/features.mjs'

// A bare server around readBody that answers the way featureRequest does.
async function start(t) {
  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req, { allowPhoto: req.url === '/photo' })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ keys: Object.keys(body) }))
    } catch (error) {
      res.writeHead(error.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return server.address().port
}

// Only a hung server ever reaches this limit: a healthy run answers in milliseconds and is cut off after about a
// second. It is generous because a starved machine can pause the whole process (client and server) for seconds.
const patienceMs = 30_000

// The message may be a function so it can describe state that only exists once the time is up.
const within = (ms, promise, message) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(typeof message === 'function' ? message() : message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Writes the given chunks and then deliberately never ends the request body.
function stalledUpload(port, path, chunks) {
  const agent = new Agent({ keepAlive: true })
  const outgoing = request({ agent, host: '127.0.0.1', port, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } })
  let socketError = 'none'
  outgoing.on('error', error => { socketError = error.code ?? error.message })
  const answered = new Promise(resolve => outgoing.on('response', response => {
    const parts = []
    const closed = new Promise(done => response.socket.once('close', done))
    response.on('data', part => parts.push(part))
    response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts)), closed }))
  }))
  for (const chunk of chunks) outgoing.write(chunk)
  return {
    answered: within(patienceMs, answered, () => `no answer while the upload was still open (socket error: ${socketError})`),
    close: () => { outgoing.destroy(); agent.destroy() },
  }
}

test('a sender that exceeds the cap and never finishes gets a 413 at once and is then disconnected', async t => {
  const port = await start(t)
  const cases = [
    ['ordinary JSON body above 16 KiB', '/plain', [Buffer.from('{"name":"'), Buffer.alloc(20_000, 0x78)]],
    ['photo-capable body above 720 KiB', '/photo', [Buffer.from('{"photo":"data:image/jpeg;base64,'),
      ...Array.from({ length: 8 }, () => Buffer.alloc(100_000, 0x41))]],
  ]
  for (const [label, path, chunks] of cases) {
    const upload = stalledUpload(port, path, chunks)
    try {
      const response = await upload.answered
      assert.equal(response.status, 413, label)
      assert.deepEqual(response.body, { error: 'body_too_large' }, label)
      await within(patienceMs, response.closed, `${label}: the server kept the unfinished upload connected`)
    } finally {
      upload.close()
    }
  }
})

test('a client that finishes an oversized upload still reads the 413 and keeps its connection', async t => {
  // The cut-off window is wall-clock time, so it is frozen here: this is about an upload that completes inside it.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const port = await start(t)
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  t.after(() => agent.destroy())
  const post = (path, payload, type = 'application/json') => new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const outgoing = request({ agent, host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } }, response => {
      const parts = []
      response.on('data', part => parts.push(part))
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts)),
        reused: outgoing.reusedSocket }))
    })
    outgoing.on('error', reject)
    outgoing.end(body)
  })
  const oversized = await post('/plain', { notes: 'x'.repeat(2_000_000) })
  assert.equal(oversized.status, 413)
  assert.deepEqual(oversized.body, { error: 'body_too_large' })
  const next = await post('/plain', { name: 'next' })
  assert.deepEqual([next.status, next.body, next.reused], [200, { keys: ['name'] }, true])
})

test('a failure while discarding a rejected upload is logged, a client hang-up is not', async t => {
  const logged = []
  t.mock.method(console, 'error', line => logged.push(JSON.parse(line)))
  // A request whose sender is still connected when the 413 is decided.
  const rejectedUpload = async () => {
    const req = new Readable({ read() {} })
    req.headers = { 'content-type': 'application/json' }
    req.push(Buffer.alloc(20_000, 0x78))
    await assert.rejects(readBody(req), { message: 'body_too_large', status: 413 })
    return req
  }
  const destroyed = async (req, error) => {
    const closed = new Promise(resolve => req.once('close', resolve))
    req.destroy(error)
    await closed
  }
  await destroyed(await rejectedUpload(), Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }))
  await destroyed(await rejectedUpload())
  assert.deepEqual(logged, [], 'the sender hanging up is not a server fault')
  await destroyed(await rejectedUpload(), Object.assign(new Error('read failed'), { code: 'EIO' }))
  assert.deepEqual(logged, [{ event: 'request_body_discard_failed', code: 'EIO' }], 'any other stream failure must be reported')
})

test('only disc writes that carry a photo string may exceed 16 KiB, and never beyond 720 KiB', async () => {
  // Streams the body into readBody in 64 KiB pieces and reports what the server would answer.
  const post = async (path, payload, type = 'application/json') => {
    const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))
    const pieces = Array.from({ length: Math.ceil(bytes.length / 65_536) },
      (_, index) => bytes.subarray(index * 65_536, (index + 1) * 65_536))
    const req = Readable.from(pieces, { objectMode: false })
    req.headers = { 'content-type': type }
    try { return [200, { keys: Object.keys(await readBody(req, { allowPhoto: path === '/photo' })) }] }
    catch (error) { return [error.status, { error: error.message }] }
  }
  const filler = size => 'x'.repeat(size)
  assert.deepEqual(await post('/plain', { name: 'small' }), [200, { keys: ['name'] }])
  assert.deepEqual(await post('/photo', { photo: filler(600_000), name: 'photo' }), [200, { keys: ['photo', 'name'] }])
  assert.deepEqual(await post('/photo', { photo: filler(700_000) }), [200, { keys: ['photo'] }])
  const tooLarge = [413, { error: 'body_too_large' }]
  assert.deepEqual(await post('/photo', { photo: filler(800_000) }), tooLarge)
  assert.deepEqual(await post('/photo', { photo: filler(5_000_000) }), tooLarge)
  assert.deepEqual(await post('/photo', { photo: null, notes: filler(600_000) }), tooLarge)
  assert.deepEqual(await post('/photo', { notes: filler(20_000) }), tooLarge)
  assert.deepEqual(await post('/plain', { photo: filler(20_000) }), tooLarge)
  assert.deepEqual(await post('/plain', { notes: filler(20_000) }), tooLarge)
  assert.deepEqual(await post('/plain', '{"name":'), [400, { error: 'invalid_json' }])
  assert.deepEqual(await post('/photo', '{"name":'), [400, { error: 'invalid_json' }])
  assert.deepEqual(await post('/photo', `{"name":"${filler(20_000)}`), tooLarge)
  assert.deepEqual(await post('/plain', '{"name":"x"}', 'text/plain'), [415, { error: 'json_required' }])
})
