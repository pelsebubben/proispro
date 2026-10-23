import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('release recorder emits exact provenance and rejects mutable or unidentified releases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'griplock-release-'))
  t.after(() => rm(root, { recursive: true }))
  const script = fileURLToPath(new URL('../../scripts/record-staging-release.mjs', import.meta.url))
  const env = { ...process.env, SOURCE_SHA: 'a'.repeat(40),
    IMAGE: `registry.example/griplock@sha256:${'b'.repeat(64)}`, STAGING_URL: 'https://staging.example',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'example/griplock',
    GITHUB_RUN_ID: '123', GITHUB_STEP_SUMMARY: join(root, 'summary.md'), IDENTITY_READY: 'false' }
  const run = overrides => spawnSync(process.execPath, [script], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' })
  const result = run({})
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'staging-release.json'), 'utf8')), {
    sourceSha: env.SOURCE_SHA, image: env.IMAGE, url: env.STAGING_URL,
    run: 'https://github.com/example/griplock/actions/runs/123', schemaVersion: 1,
    environment: 'live', identityReady: false,
  })
  assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /Customer identity configured: false/)
  assert.equal(run({ IDENTITY_READY: 'true' }).status, 0)
  assert.equal(JSON.parse(await readFile(join(root, 'staging-release.json'), 'utf8')).identityReady, true)
  for (const override of [{ SOURCE_SHA: 'main' }, { IMAGE: 'registry.example/griplock:latest' },
    { STAGING_URL: 'http://staging.example' }, { GITHUB_RUN_ID: '' }, { IDENTITY_READY: '' }]) {
    assert.notEqual(run(override).status, 0, JSON.stringify(override))
  }
})
