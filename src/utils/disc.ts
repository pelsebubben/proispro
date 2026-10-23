// Disc utilities: type conversions, filtering, sorting, grouping, helpers

export type SortOption =
  | 'name-asc' | 'name-desc'
  | 'type-asc' | 'type-desc'
  | 'speed-asc' | 'speed-desc'
  | 'glide-asc' | 'glide-desc'
  | 'turn-asc' | 'turn-desc'
  | 'fade-asc' | 'fade-desc'
  | 'weight-asc' | 'weight-desc'
  | 'condition-asc' | 'condition-desc'
  | 'added-asc' | 'added-desc'

export interface ClientDisc {
  id: string
  name: string
  manufacturer: string
  type: string // 'putter' | 'midrange' | 'fairway' | 'distance' | ''
  plastic: string
  weight: string // stored as string for form handling, '' if not set
  color: string
  condition: string
  speed: number | string // '' if not set
  glide: number | string
  turn: number | string
  fade: number | string
  notes: string
  tags: string[]
  photo_url: string | null
  added: number // timestamp ms
  quantity: number
}

export interface ClientBag {
  id: string
  name: string
  disc_ids: string[]
}

export interface DiscFilters {
  search: string
  filterType: string
  filterBrand: string
  filterBag: string
  filterCondition: string
  filterWeightMin: number | null
  filterWeightMax: number | null
  activeTagFilter: string
  sortBy: SortOption
  groupBy: 'none' | 'type' | 'brand' | 'bag'
}

export interface DiscGroup {
  label: string | null
  count: number
  discs: ClientDisc[]
}

export interface DbDiscInsert {
  id: string
  name: string
  manufacturer: string | null
  disc_type: string | null
  plastic: string | null
  weight: number | null
  color: string | null
  condition: string | null
  speed: number | null
  glide: number | null
  turn: number | null
  fade: number | null
  notes: string | null
  quantity: number
  tags: string[]
  user_photo_url: string | null
  user_id?: string
}

// DB → Client conversion
export function fromDbDisc(d: Record<string, unknown>): ClientDisc {
  const speed = d.speed != null ? Number(d.speed) : null
  const glide = d.glide != null ? Number(d.glide) : null
  const turn = d.turn != null ? Number(d.turn) : null
  const fade = d.fade != null ? Number(d.fade) : null

  return {
    id: String(d.id || ''),
    name: String(d.name || ''),
    manufacturer: String(d.manufacturer || ''),
    type: String(d.disc_type || ''), // disc_type → type
    plastic: String(d.plastic || ''),
    weight: d.weight != null ? String(d.weight) : '',
    color: String(d.color || ''),
    condition: String(d.condition || 'good'),
    speed: speed != null ? speed : '',
    glide: glide != null ? glide : '',
    turn: turn != null ? turn : '',
    fade: fade != null ? fade : '',
    notes: String(d.notes || ''),
    tags: Array.isArray(d.tags) ? d.tags : [],
    photo_url: d.user_photo_url ? String(d.user_photo_url) : null,
    added: d.added_at ? new Date(String(d.added_at)).getTime() : Date.now(),
    quantity: d.quantity != null ? Math.max(1, Number(d.quantity)) : 1,
  }
}

// Client → DB conversion
export function toDbDisc(disc: ClientDisc): DbDiscInsert {
  return {
    id: disc.id,
    name: disc.name,
    manufacturer: disc.manufacturer || '',
    disc_type: disc.type || null, // type → disc_type
    plastic: disc.plastic || null,
    weight: disc.weight !== '' && disc.weight != null ? parseFloat(disc.weight) : null,
    color: disc.color || null,
    condition: disc.condition || null,
    speed: disc.speed !== '' && disc.speed != null ? Number(disc.speed) : null,
    glide: disc.glide !== '' && disc.glide != null ? Number(disc.glide) : null,
    turn: disc.turn !== '' && disc.turn != null ? Number(disc.turn) : null,
    fade: disc.fade !== '' && disc.fade != null ? Number(disc.fade) : null,
    notes: disc.notes || null,
    quantity: disc.quantity != null ? Math.max(1, Number(disc.quantity)) : 1,
    tags: disc.tags,
    user_photo_url: disc.photo_url,
  }
}

// Display helpers
export function colorSlug(name: string): string {
  return name ? name.toLowerCase().replace(/\s+/g, '-') : ''
}

export function condLabel(cond: string): string {
  const labels: Record<string, string> = {
    new: 'Mint',
    good: 'Good',
    used: 'Used',
    beat: 'Beat-in',
  }
  return labels[cond] || cond || ''
}

export function safeCond(cond: string): string {
  return ['new', 'good', 'used', 'beat'].includes(cond) ? cond : 'good'
}

export function stabilityLabel(
  turn: number | string | null,
  fade: number | string | null
): string {
  const t = Number(turn) || 0
  const f = Number(fade) || 0
  const s = t + f
  if (s >= 4) return 'Very Overstable'
  if (s >= 2) return 'Overstable'
  if (s >= 0) return 'Stable'
  if (s >= -2) return 'Understable'
  return 'Very Understable'
}

export function formatTurn(n: number | string | null): string {
  const num = Number(n)
  if (isNaN(num)) return String(n || '')
  return num > 0 ? '+' + num : String(num)
}

export function hasFlightNumbers(disc: ClientDisc): boolean {
  return disc.speed !== '' && disc.speed != null
}

export function tagColor(tag: string): string {
  const hash = tag.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const colors = [
    'putter',
    'midrange',
    'fairway',
    'distance',
    'clr-accent',
    'clr-accent2',
    'disc-emerald',
    'disc-iris',
  ]
  return colors[hash % 8]
}

export function getBagsForDisc(discId: string, bags: ClientBag[]): ClientBag[] {
  return bags.filter(b => b.disc_ids.includes(discId))
}

export function isDiscInBag(
  bagId: string,
  discId: string,
  bags: ClientBag[]
): boolean {
  const bag = bags.find(b => b.id === bagId)
  return bag ? bag.disc_ids.includes(discId) : false
}

// Filter and sort logic
export function filterAndSort(
  discs: ClientDisc[],
  bags: ClientBag[],
  filters: DiscFilters
): DiscGroup[] {
  // 1. Filter
  let filtered = discs.slice()

  // Search
  if (filters.search) {
    const search = filters.search.toLowerCase()
    filtered = filtered.filter(
      d =>
        d.name.toLowerCase().includes(search) ||
        d.manufacturer.toLowerCase().includes(search) ||
        d.plastic.toLowerCase().includes(search) ||
        d.notes.toLowerCase().includes(search) ||
        d.tags.some(t => t.toLowerCase().includes(search))
    )
  }

  // Type filter
  if (filters.filterType) {
    filtered = filtered.filter(d => d.type === filters.filterType)
  }

  // Brand filter
  if (filters.filterBrand) {
    filtered = filtered.filter(d => d.manufacturer === filters.filterBrand)
  }

  // Bag filter
  if (filters.filterBag) {
    const bag = bags.find(b => b.id === filters.filterBag)
    if (bag) {
      filtered = filtered.filter(d => bag.disc_ids.includes(d.id))
    }
  }

  // Condition filter
  if (filters.filterCondition) {
    filtered = filtered.filter(d => d.condition === filters.filterCondition)
  }

  // Weight range
  if (filters.filterWeightMin != null) {
    filtered = filtered.filter(d => {
      const w = parseFloat(d.weight)
      return !isNaN(w) && w >= filters.filterWeightMin!
    })
  }
  if (filters.filterWeightMax != null) {
    filtered = filtered.filter(d => {
      const w = parseFloat(d.weight)
      return !isNaN(w) && w <= filters.filterWeightMax!
    })
  }

  // Tag filter
  if (filters.activeTagFilter) {
    filtered = filtered.filter(d => d.tags.includes(filters.activeTagFilter))
  }

  // 2. Sort
  const typeOrder: Record<string, number> = {
    putter: 0,
    midrange: 1,
    fairway: 2,
    distance: 3,
  }
  const conditionOrder: Record<string, number> = {
    new: 0,
    good: 1,
    used: 2,
    beat: 3,
  }

  filtered.sort((a, b) => {
    const [field, dir] = filters.sortBy.split('-')
    let result = 0

    switch (field) {
      case 'name':
        result = a.name.localeCompare(b.name)
        break
      case 'type':
        result = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99)
        break
      case 'speed':
        result = (Number(a.speed) || 0) - (Number(b.speed) || 0)
        break
      case 'glide':
        result = (Number(a.glide) || 0) - (Number(b.glide) || 0)
        break
      case 'turn':
        result = (Number(a.turn) || 0) - (Number(b.turn) || 0)
        break
      case 'fade':
        result = (Number(a.fade) || 0) - (Number(b.fade) || 0)
        break
      case 'weight':
        result = (parseFloat(a.weight) || 0) - (parseFloat(b.weight) || 0)
        break
      case 'condition':
        result = (conditionOrder[a.condition] ?? 99) - (conditionOrder[b.condition] ?? 99)
        break
      case 'added':
        result = a.added - b.added
        break
      default:
        result = 0
    }

    return dir === 'desc' ? -result : result
  })

  // 3. Group
  if (filters.groupBy === 'none') {
    return [{ label: null, count: filtered.length, discs: filtered }]
  }

  const groups: Record<string, ClientDisc[]> = {}

  filtered.forEach(disc => {
    let key = ''
    switch (filters.groupBy) {
      case 'type':
        key = disc.type || 'Unknown'
        break
      case 'brand':
        key = disc.manufacturer || 'Unknown'
        break
      case 'bag':
        const discBags = getBagsForDisc(disc.id, bags)
        if (discBags.length === 0) {
          key = 'No Bag'
        } else {
          discBags.forEach(bag => {
            if (!groups[bag.name]) groups[bag.name] = []
            groups[bag.name].push(disc)
          })
          return
        }
        break
    }
    if (!groups[key]) groups[key] = []
    groups[key].push(disc)
  })

  return Object.entries(groups)
    .map(([label, discs]) => ({
      label,
      count: discs.length,
      discs,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
