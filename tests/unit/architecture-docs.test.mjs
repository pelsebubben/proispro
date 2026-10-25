import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { architectureSource, buildArchitecture, checkArchitecture, refreshArchitecture } from '../../scripts/architecture-docs.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const specPath = 'docs/architecture/runtime.architecture.json'
const ledgerPath = 'docs/architecture/evidence.json'
const read = (root, path) => readFile(join(root, path), 'utf8')
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'griplock-architecture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of ['src', 'server', 'infra', 'scripts', '.github/workflows', 'docs/architecture',
    'package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'vite.config.ts']) {
    await cp(join(repository, path), join(root, path), { recursive: true })
  }
  await refreshArchitecture(root)
  return root
}

function commit(root) {
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.invalid',
    'commit', '--quiet', '-m', 'Architecture contract fixture\n\nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>')
  return git(root, 'rev-parse', 'HEAD')
}

test('the committed architecture ledger covers actual sources and all three views', async () => {
  const { snapshot, specs } = await checkArchitecture(repository)
  assert.deepEqual(specs.map(spec => spec.type), ['architecture', 'sequence', 'workflow'])
  for (const path of ['src/App.tsx', 'server/database.mjs', 'server/migrations/008_named_gameplans.sql',
    'infra/app.bicep', 'scripts/architecture-docs.mjs', '.github/workflows/architecture.yml',
    '.github/workflows/prod.yml', 'Dockerfile', 'package-lock.json']) {
    assert.match(snapshot.sources[path], /^[a-f0-9]{64}$/)
  }
  assert.ok(Object.keys(snapshot.sources).length > 50)
  assert.ok(Object.keys(snapshot.documents).length >= 2)
  for (const path of ['.env', 'server/.env', '../server/app.mjs', 'architecture-report/runtime.html',
    'node_modules/x.mjs', '.architecture-tools/archify/archify/bin/archify.mjs']) {
    assert.equal(architectureSource(path), false, path)
  }
})

test('reviewed hashes reject real edits, new sources, deletions, prose and diagram drift', async t => {
  const root = await fixture(t)
  for (const path of ['src/App.tsx', 'server/app.mjs', 'infra/app.bicep', 'scripts/architecture-docs.mjs',
    '.github/workflows/prod.yml', 'package.json', 'docs/architecture/README.md', specPath]) {
    const before = await read(root, path)
    await writeFile(join(root, path), `${before}\n `)
    await assert.rejects(checkArchitecture(root), /Architecture review is stale/)
    await writeFile(join(root, path), before)
  }
  const added = join(root, 'src/architecture-new.ts')
  await writeFile(added, 'export const newBoundary = true\n')
  await assert.rejects(checkArchitecture(root), /src\/architecture-new\.ts/)
  await refreshArchitecture(root)
  await checkArchitecture(root)
  await rm(added)
  await assert.rejects(checkArchitecture(root), /src\/architecture-new\.ts/)
})

test('CRLF conversion does not falsely invalidate reviewed evidence', async t => {
  const root = await fixture(t)
  const path = 'src/App.tsx'
  await writeFile(join(root, path), (await read(root, path)).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'))
  await checkArchitecture(root)
})

test('refresh cannot bless missing, unsafe or invalid diagram citations and endpoints', async t => {
  const root = await fixture(t)
  const original = JSON.parse(await read(root, specPath))
  for (const mutate of [
    spec => { spec.components[0].sources = [] },
    spec => { spec.components[0].sources[0].line = 0 },
    spec => { spec.components[0].sources[0].end_line = 1_000_000 },
    spec => { spec.components[0].sources[0].path = '../server/app.mjs' },
    spec => { spec.components[0].sources[0].path = 'server/../server/app.mjs' },
    spec => { spec.components[0].sources[0].path = 'server\\app.mjs' },
    spec => { spec.components[0].sources[0].path = '.env' },
    spec => { spec.components[0].sources[0].path = 'server/missing.mjs' },
    spec => { spec.components[0].id = spec.components[1].id },
    spec => { spec.connections[0].to = 'missing' },
    spec => { spec.meta.output = '../outside.html' },
  ]) {
    const spec = structuredClone(original)
    mutate(spec)
    await writeFile(join(root, specPath), JSON.stringify(spec))
    await assert.rejects(refreshArchitecture(root))
  }
})

test('source changes need a Markdown impact assessment, not only a refreshed ledger', async t => {
  const root = await fixture(t)
  git(root, 'init', '--quiet')
  const base = commit(root)
  await writeFile(join(root, 'src/architecture-new.ts'), 'export const newBoundary = true\n')
  await refreshArchitecture(root)
  commit(root)
  await assert.rejects(checkArchitecture(root, base), /without a docs\/architecture Markdown review/)
  await writeFile(join(root, 'docs/architecture/reviews.md'), `${await read(root, 'docs/architecture/reviews.md')}\nReviewed new source: no runtime boundary change.\n`)
  await refreshArchitecture(root)
  commit(root)
  await checkArchitecture(root, base)
  await checkArchitecture(root, '0'.repeat(40))
  await assert.rejects(checkArchitecture(root, '--output=unexpected'), /Invalid base reference/)
  await assert.rejects(checkArchitecture(root, 'not-a-commit'))
})

test('missing or unsupported review evidence fails closed', async t => {
  const root = await fixture(t)
  await writeFile(join(root, ledgerPath), '{"formatVersion":999}')
  await assert.rejects(checkArchitecture(root), /Unknown architecture evidence format/)
  await rm(join(root, ledgerPath))
  await assert.rejects(checkArchitecture(root), /ENOENT/)
})

test('generation requires an explicitly pinned renderer rather than falling back to local skills', async t => {
  const root = await fixture(t)
  await assert.rejects(buildArchitecture(root), /Set ARCHIFY_CLI/)
})
