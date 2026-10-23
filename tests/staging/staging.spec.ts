import { expect, test } from '@playwright/test'

test('deployed release is healthy, private by default and isolated from production data', async ({ page, request }) => {
  const ready = await request.get('/health/ready')
  expect(ready.status()).toBe(200)
  expect(await ready.json()).toEqual({ status: 'ready', sourceSha: process.env.SOURCE_SHA, schemaVersion: 1 })
  expect((await request.get('/api/v1/discs')).status()).toBe(401)
  const external: string[] = []
  page.on('request', req => {
    if (new URL(req.url()).origin !== new URL(process.env.STAGING_URL!).origin) external.push(req.url())
  })
  await page.goto('/')
  const configuration = await (await request.get('/auth/config')).json()
  expect(configuration.dataBackend).toBe('api')
  if (configuration.identityReady) {
    await expect(page.getByRole('button', { name: 'Sign in to Griplock' })).toBeEnabled()
    await expect(page.getByRole('button', { name: /Sign in with GitHub/ })).toHaveCount(0)
  } else {
    await expect(page.getByRole('status')).toContainText('Supabase data is not connected')
    await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Sign in with GitHub/ })).toBeDisabled()
  }
  expect(external).toEqual([])
  const again = await request.get('/health/ready')
  expect((await again.json()).sourceSha).toBe(process.env.SOURCE_SHA)
})
