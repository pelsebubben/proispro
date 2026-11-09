import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApplication } from '../../server/app.mjs'
import { featureRequest } from '../../server/features.mjs'

test('retired sale pages and APIs return 404 without touching the database', async t => {
  const pool = {
    query() { assert.fail('Retired sale endpoints must not query or change stored data') },
    connect() { assert.fail('Retired sale endpoints must not open a database transaction') },
  }
  const server = createApplication({ pool }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const id = '11111111-1111-4111-8111-111111111111'
  for (const path of ['/sale.html', '/sale.html?token=legacy', '/for-sale', '/for-sale/',
    '/api/v1/public/sales', `/api/v1/public/sales/${id}`,
    '/api/v1/forsale_listings', `/api/v1/forsale_listings/${id}`,
    '/api/v1/sale_tokens', `/api/v1/sale_tokens/${id}`]) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}${path}`, { method })
      assert.equal(response.status, 404, `${method} ${path}`)
      assert.deepEqual(await response.json(), { error: 'not_found' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  }
  for (const resource of ['forsale_listings', 'sale_tokens']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      let result
      await featureRequest({
        req: { method }, url: new URL(`/api/v1/${resource}/${id}`, base), pool, userId: id,
        json: (status, body) => { result = { status, body } },
      })
      assert.deepEqual(result, { status: 404, body: { error: 'not_found' } })
    }
  }
})
