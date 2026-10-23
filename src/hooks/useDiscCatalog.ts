import snapshot from '../data/disc-catalog'

export interface CatalogDisc {
  id: string
  name: string
  brand: string
  type: string
  edition?: string
  plastic?: string
  speed: number
  glide: number
  turn: number
  fade: number
}

const origin = snapshot.find(disc => disc.name === 'Origin' && disc.brand === 'Discmania')
if (!origin) throw new Error('Catalogue snapshot is missing the Origin mold')

const catalog: CatalogDisc[] = [
  ...snapshot,
  ...[
    { edition: 'Midnight Prowl', plastic: 'Meta' },
    { edition: 'Midnight Prowl II', plastic: 'Meta' },
    { edition: 'Midnight Prowl 3', plastic: 'Glow Metal Flake C-Line' },
  ].map((edition, index) => ({ ...origin, ...edition, id: `discmania:midnight-prowl-${index + 1}` })),
]

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\bi\b/g, '1')
  .replace(/[^a-z0-9]+/g, ' ').trim()
const indexed = catalog.map(disc => ({
  disc,
  name: normalize(disc.name),
  edition: normalize(disc.edition ?? ''),
  searchable: normalize(`${disc.name} ${disc.brand} ${disc.edition ?? ''} ${disc.plastic ?? ''} ${
    disc.edition === 'Midnight Prowl' ? 'Midnight Prowl 1' : ''}`),
}))

export function searchCatalog(query: string, limit = 10): CatalogDisc[] {
  const normalized = normalize(query)
  if (!normalized) return []
  const terms = normalized.split(/\s+/)
  return indexed
    .filter(item => terms.every(term => item.searchable.includes(term)))
    .map(item => ({ ...item, rank: item.name === normalized || item.edition === normalized ? 0
      : item.name.startsWith(normalized) || item.edition.startsWith(normalized) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.disc.name.localeCompare(b.disc.name) ||
      a.disc.brand.localeCompare(b.disc.brand) || a.edition.localeCompare(b.edition, 'en', { numeric: true }))
    .slice(0, limit)
    .map(item => item.disc)
}
