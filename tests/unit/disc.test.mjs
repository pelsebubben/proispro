import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Node 22.16 cannot load TypeScript directly; compile the actual pure module.
const source = await readFile(new URL('../../src/utils/disc.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { fromDbDisc, toDbDisc, filterAndSort, getBagsForDisc } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const filters = {
  search: '', filterType: '', filterBrand: '', filterBag: '', filterCondition: '',
  filterWeightMin: null, filterWeightMax: null, activeTagFilter: '',
  sortBy: 'name-asc', groupBy: 'none',
}
const buz = fromDbDisc({ id: 'buz', name: 'Buzzz', manufacturer: 'Discraft',
  disc_type: 'midrange', speed: 5, glide: 4, turn: -1, fade: 1,
  weight: 175, quantity: 2, added_at: '2026-01-01T00:00:00Z' })
const destroyer = fromDbDisc({ id: 'destroyer', name: 'Destroyer', manufacturer: 'Innova',
  disc_type: 'distance', speed: 12, weight: 172, added_at: '2026-01-02T00:00:00Z' })
const bags = [
  { id: 'wooded', name: 'Wooded', disc_ids: ['buz'] },
  { id: 'open', name: 'Open', disc_ids: ['buz', 'destroyer'] },
]

test('database conversion preserves numerical flight values and nullable fields', () => {
  assert.equal(buz.weight, '175')
  assert.equal(buz.turn, -1)
  assert.equal(buz.type, 'midrange')
  const row = toDbDisc(buz)
  assert.equal(row.weight, 175)
  assert.equal(row.disc_type, 'midrange')
  assert.equal(row.quantity, 2)
  assert.equal(row.plastic, null)
  assert.equal(toDbDisc(fromDbDisc({ id: 'empty', name: 'Empty' })).speed, null)
})

test('a physical disc can appear in multiple configurations without modifying ownership', () => {
  assert.deepEqual(getBagsForDisc('buz', bags).map(bag => bag.id), ['wooded', 'open'])
  const groups = filterAndSort([buz, destroyer], bags, { ...filters, groupBy: 'bag' })
  assert.deepEqual(groups.map(group => [group.label, group.discs.map(disc => disc.id)]), [
    ['Open', ['buz', 'destroyer']], ['Wooded', ['buz']],
  ])
  assert.equal(buz.quantity, 2)
})

test('search, bag and weight filters combine without mutating the source collection', () => {
  const discs = [destroyer, buz]
  const result = filterAndSort(discs, bags, {
    ...filters, search: 'DISCRAFT', filterBag: 'wooded', filterWeightMin: 174,
  })
  assert.deepEqual(result[0].discs.map(disc => disc.id), ['buz'])
  assert.deepEqual(discs.map(disc => disc.id), ['destroyer', 'buz'])
  assert.equal(filterAndSort(discs, bags, { ...filters, search: 'absent' })[0].count, 0)
})

test('editions and Utility survive conversion, filtering and sorting', () => {
  const utility = fromDbDisc({ id: 'u', name: 'Origin', edition: 'Midnight Prowl II', disc_type: 'utility' })
  assert.equal(toDbDisc(utility).edition, 'Midnight Prowl II')
  assert.equal(toDbDisc(utility).disc_type, 'utility')
  assert.deepEqual(filterAndSort([buz, utility], [], { ...filters, search: 'midnight', filterType: 'utility' })[0].discs, [utility])
  assert.deepEqual(filterAndSort([utility, buz], [], { ...filters, sortBy: 'type-asc' })[0].discs, [buz, utility])
})

test('private photo references use versioned URLs, never image bytes in disc fields', () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', name: 'Photo disc', photo_version: '22222222-2222-4222-8222-222222222222' }
  const disc = fromDbDisc(row)
  assert.equal(disc.photo_url, `/api/v1/discs/${row.id}/photo?v=${row.photo_version}`)
  assert.equal(toDbDisc(disc).user_photo_url, null)
  assert.equal(fromDbDisc({ ...row, photo_version: null }).photo_url, null)
})
