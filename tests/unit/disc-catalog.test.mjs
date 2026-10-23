import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const snapshot = await readFile(new URL('../../src/data/disc-catalog.ts', import.meta.url), 'utf8')
const source = await readFile(new URL('../../src/hooks/useDiscCatalog.ts', import.meta.url), 'utf8')
const snapshotUrl = `data:text/javascript;base64,${Buffer.from(compile(snapshot)).toString('base64')}`
const moduleSource = compile(source).replace("'../data/disc-catalog'", JSON.stringify(snapshotUrl))
const { searchCatalog } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)

test('bundled catalogue is deduplicated and searches manufacturer plus mold', () => {
  const origin = searchCatalog('Discmania Origin')
  assert.equal(origin.filter(disc => !disc.edition).length, 1)
  assert.equal(origin.length, 4)
  assert.equal(searchCatalog('Innova Destroyer')[0].name, 'Destroyer')
  assert.deepEqual(searchCatalog('nonexistent-private-mold'), [])
  assert.deepEqual(searchCatalog('  '), [])
  assert.ok(searchCatalog('a').length <= 10)
})

test('edition queries match Roman or Arabic versions and preserve mold facts', () => {
  for (const [query, edition] of [['midnight prowl 1', 'Midnight Prowl'], ['midnight prowl 2', 'Midnight Prowl II'],
    ['midnight prowl II', 'Midnight Prowl II'], ['midnight prowl III', 'Midnight Prowl 3']]) {
    const [disc] = searchCatalog(query)
    assert.equal(disc.edition, edition)
    assert.equal(disc.name, 'Origin')
    assert.equal(disc.brand, 'Discmania')
    assert.deepEqual([disc.speed, disc.glide, disc.turn, disc.fade], [5, 5, -1, 1])
  }
})

test('catalogue search stays within a 50ms local interaction budget', () => {
  const queries = ['origin', 'innova', 'midnight 2', 'discmania origin', 'buzzz', 'not-real']
  const durations = []
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    searchCatalog(queries[i % queries.length])
    durations.push(performance.now() - start)
  }
  durations.sort((a, b) => a - b)
  assert.ok(durations[94] < 50, `95th percentile was ${durations[94]}ms`)
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|setTimeout/)
})
