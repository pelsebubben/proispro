type Row = Record<string, unknown>

const bagId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const travelBagId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const pinId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const layoutId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const discIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000009',
]
const collectionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const now = new Date().toISOString()

const disc = (index: number, name: string, manufacturer: string, type: string, plastic: string,
  weight: number, color: string, flight: [number, number, number, number], quantity = 1): Row => ({
  id: discIds[index], name, edition: '', manufacturer, disc_type: type, plastic, weight, color,
  condition: index === 0 ? 'new' : index < 4 ? 'good' : 'used',
  speed: flight[0], glide: flight[1], turn: flight[2], fade: flight[3],
  notes: '', tags: index === 2 ? ['forehand'] : [], user_photo_url: null, added_at: now, quantity,
})

const tables: Record<string, Row[]> = {
  discs: [
    disc(0, 'Aviar', 'Innova', 'putter', 'DX', 173, 'White', [2, 3, 0, 1]),
    disc(1, 'Envy', 'Axiom', 'putter', 'Neutron', 172, 'Blue', [3, 3, 0, 2]),
    disc(2, 'Hex', 'Axiom', 'midrange', 'Neutron', 177, 'Purple', [5, 5, -1, 1]),
    disc(3, 'Buzzz', 'Discraft', 'midrange', 'ESP', 175, 'Pink', [5, 4, -1, 1]),
    disc(4, 'Crave', 'Axiom', 'fairway', 'Plasma', 170, 'Green', [6, 5, -1, 1]),
    disc(5, 'Leopard3', 'Innova', 'fairway', 'Star', 168, 'Yellow', [7, 5, -2, 1]),
    disc(6, 'Thunderbird', 'Innova', 'fairway', 'Champion', 173, 'Red', [9, 5, 0, 2]),
    disc(7, 'Destroyer', 'Innova', 'distance', 'Star', 172, 'Orange', [12, 5, -1, 3]),
    disc(8, 'Firebird', 'Innova', 'utility', 'Champion', 175, 'Blue', [9, 3, 0, 4], 2),
  ],
  bags: [
    { id: bagId, name: 'Everyday Bag', disc_ids: discIds.slice(0, 7) },
    { id: travelBagId, name: 'Travel Light', disc_ids: discIds.slice(0, 4) },
  ],
  bag_history: [
    { id: '20000000-0000-4000-8000-000000000001', bag_id: bagId, disc_id: discIds[4], disc_name: 'Crave', action: 'added', changed_at: now },
    { id: '20000000-0000-4000-8000-000000000002', bag_id: bagId, disc_id: discIds[5], disc_name: 'Leopard3', action: 'added', changed_at: now },
  ],
  collections: [
    { id: collectionId, name: 'Go-to discs', description: 'Reliable picks for league nights' },
  ],
  collection_discs: [
    { id: '30000000-0000-4000-8000-000000000001', collection_id: collectionId, disc_id: discIds[1] },
    { id: '30000000-0000-4000-8000-000000000002', collection_id: collectionId, disc_id: discIds[2] },
    { id: '30000000-0000-4000-8000-000000000003', collection_id: collectionId, disc_id: discIds[4] },
  ],
  wishlist_items: [
    { id: '40000000-0000-4000-8000-000000000001', disc_name: 'River', manufacturer: 'Latitude 64°', plastic_pref: 'Opto', weight_min: 168, weight_max: 175, priority: 2, notes: 'Try one in the fairway slot', acquired: false, created_at: now },
    { id: '40000000-0000-4000-8000-000000000002', disc_name: 'Pure', manufacturer: 'Latitude 64°', plastic_pref: 'Zero Medium', weight_min: null, weight_max: null, priority: 1, notes: '', acquired: true, created_at: now },
  ],
  course_pins: [
    { id: pinId, course_name: 'Ekeberg Disc Golf Park', course_id: null, bag_id: bagId, created_at: now },
  ],
  hole_assignments: [
    { id: '70000000-0000-4000-8000-000000000001', course_pin_id: pinId, hole_ref: '1', disc_id: discIds[4], disc_name: 'Crave' },
    { id: '70000000-0000-4000-8000-000000000002', course_pin_id: pinId, hole_ref: '2', disc_id: discIds[2], disc_name: 'Hex' },
    { id: '70000000-0000-4000-8000-000000000003', course_pin_id: pinId, hole_ref: '3', disc_id: discIds[4], disc_name: 'Crave' },
    { id: '70000000-0000-4000-8000-000000000004', course_pin_id: pinId, hole_ref: '4', disc_id: discIds[4], disc_name: 'Crave' },
  ],
}

interface MockHole {
  id: string
  label: string
  par: number | null
  distance_m: number | null
  notes: string
}

interface MockLayout {
  id: string
  name: string
  tee: string
  basket: string
  description: string
  checked_on: string | null
  holes: MockHole[]
  version: number
  private_name?: string | null
}

const layouts: MockLayout[] = [{
  id: layoutId,
  name: 'Local practice loop',
  tee: 'Blue tees',
  basket: 'Main baskets',
  description: 'Example private layout for trying the planner.',
  checked_on: now.slice(0, 10),
  holes: [
    { id: '80000000-0000-4000-8000-000000000001', label: '1', par: 3, distance_m: 82, notes: 'Keep right of the large tree.' },
    { id: '80000000-0000-4000-8000-000000000002', label: '2', par: 3, distance_m: 105, notes: '' },
    { id: '80000000-0000-4000-8000-000000000003', label: '3', par: 4, distance_m: 148, notes: 'Placement over distance.' },
  ],
  version: 1,
}]

const plans: Record<string, { layout_id: string; selections: Record<string, { disc_ids: string[]; notes: string }>; version: number }> = {
  [pinId]: {
    layout_id: layoutId,
    selections: {
      [layouts[0].holes[0].id]: { disc_ids: [discIds[4]], notes: 'Smooth standstill through the gap.' },
      [layouts[0].holes[1].id]: { disc_ids: [discIds[2], discIds[3]], notes: '' },
    },
    version: 1,
  },
}

const copy = <T>(value: T): T => structuredClone(value)
const id = () => crypto.randomUUID()

function plannerRequest(path: string, method: string, body: Row) {
  const [route, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  const pin = params.get('pin_id') ?? (typeof body.course_pin_id === 'string' ? body.course_pin_id : '')
  const layoutMatch = route.match(/^planner\/layouts\/([0-9a-f-]+)$/i)
  const pinMatch = route.match(/^planner\/pins\/([0-9a-f-]+)$/i)

  if (route === 'planner' && method === 'GET') {
    if (!pin) {
      return { summaries: Object.entries(plans).map(([course_pin_id, plan]) => ({
        course_pin_id,
        layout_name: layouts.find(layout => layout.id === plan.layout_id)?.name ?? 'Private layout',
        planned_count: Object.values(plan.selections).filter(selection => selection.disc_ids.length).length,
        required_disc_count: new Set(Object.values(plan.selections).flatMap(selection => selection.disc_ids)).size,
        missing_disc_count: 0,
      })) }
    }
    const plan = plans[pin] ?? null
    const selected = params.get('layout_id')
    return {
      layouts: copy(layouts),
      plan: selected ? (plan?.layout_id === selected ? copy(plan) : null) : copy(plan),
      ...(selected ? { selected_plan: plan?.layout_id === selected ? copy(plan) : null } : {}),
    }
  }
  if (route === 'planner' && method === 'POST') {
    const layout: MockLayout = { id: id(), name: String(body.name ?? 'New private layout'),
      tee: String(body.tee ?? ''), basket: String(body.basket ?? ''), description: String(body.description ?? ''),
      checked_on: typeof body.checked_on === 'string' ? body.checked_on : null,
      holes: Array.isArray(body.holes) ? copy(body.holes as MockHole[]) : [], version: 1 }
    layouts.push(layout)
    return { layout: copy(layout) }
  }
  if (route === 'planner/event-layout' && method === 'POST') {
    const layout: MockLayout = { id: id(), name: 'Mock event layout', tee: '', basket: '', description: '',
      checked_on: null, holes: [], version: 1, private_name: null }
    layouts.push(layout)
    return { layout: copy(layout) }
  }
  if (route === 'planner/duplicate' && method === 'POST') {
    const source = layouts.find(layout => layout.id === body.layout_id)
    const layout: MockLayout = { ...copy(source ?? layouts[0]), id: id(), private_name: String(body.name ?? 'Mock plan') }
    layouts.push(layout)
    return { layout: copy(layout) }
  }
  if (layoutMatch && method === 'PUT') {
    const layout = layouts.find(row => row.id === layoutMatch[1])
    if (!layout) throw new Error('Mock layout not found')
    Object.assign(layout, body, { version: layout.version + 1 })
    return { layout: copy(layout) }
  }
  if (layoutMatch && method === 'DELETE') {
    const index = layouts.findIndex(row => row.id === layoutMatch[1])
    if (index >= 0) layouts.splice(index, 1)
    return {}
  }
  if (pinMatch && method === 'PUT') {
    const chosen = body.selections && typeof body.selections === 'object'
      ? body.selections as Record<string, { disc_ids: string[]; notes: string }>
      : {}
    plans[pinMatch[1]] = { layout_id: String(body.layout_id ?? ''), selections: copy(chosen),
      version: (plans[pinMatch[1]]?.version ?? 0) + 1 }
    return {}
  }
  if (pinMatch && method === 'DELETE') {
    delete plans[pinMatch[1]]
    return {}
  }
  return {}
}

function catalogueRequest(path: string) {
  if (path.startsWith('courses?q=')) {
    const query = decodeURIComponent(path.slice('courses?q='.length)).toLocaleLowerCase()
    const courses = query && 'ekeberg disc golf park'.includes(query)
      ? [{ id: 'pdga:4551', source: 'pdga', source_url: null, name: 'Ekeberg Disc Golf Park',
          expected_holes: 18, mapped_holes: 18, city: 'Oslo', lat: 59.89, lon: 10.77 }]
      : []
    return { courses }
  }
  if (/^courses\/pdga:\d+\/holes$/.test(path)) {
    return { course: { name: 'Ekeberg Disc Golf Park', source_url: null } }
  }
  if (/^courses\/pdga:\d+\/(layouts|maps)$/.test(path)) {
    return path.endsWith('/layouts') ? { layouts: [], expiresAt: Date.now() + 60_000 }
      : { maps: [], expiresAt: Date.now() + 60_000 }
  }
  throw new Error(`Unsupported mock catalogue request: ${path}`)
}

export async function mockRequest<T>(path: string, method = 'GET', body: object = {}): Promise<T> {
  const payload = body as Row
  let result: unknown

  if (path.startsWith('courses')) {
    result = catalogueRequest(path)
  } else if (path === 'planner' || path.startsWith('planner?') || path.startsWith('planner/')) {
    result = plannerRequest(path, method, payload)
  } else {
    const [route, query = ''] = path.split('?')
    const match = route.match(/^([a-z_]+)(?:\/([0-9a-f-]+))?$/i)
    if (!match) throw new Error(`Unsupported mock data resource: ${route}`)
    const [, resource, rowId] = match
    const rows = tables[resource]
    if (!rows) throw new Error(`Unsupported mock data resource: ${resource}`)
    const params = new URLSearchParams(query)

    if (method === 'GET') {
      const filtered = rows.filter(row => [...params].every(([field, value]) => String(row[field] ?? '') === value))
      result = { [resource]: copy(filtered) }
    } else if (method === 'POST') {
      const row = { ...copy(payload), id: typeof payload.id === 'string' ? payload.id : id() }
      if (resource === 'course_pins') Object.assign(row, { created_at: now })
      if (resource === 'wishlist_items') Object.assign(row, { created_at: now, acquired: false })
      rows.unshift(row)
      result = copy(row)
    } else if (method === 'PATCH' || method === 'PUT') {
      const target = rows.find(row => row.id === rowId)
      if (!target) throw new Error(`Mock ${resource} row not found`)
      Object.assign(target, copy(payload))
      result = copy(target)
    } else if (method === 'DELETE') {
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index]
        const matchesId = rowId ? row.id === rowId
          : [...params].every(([field, value]) => String(row[field] ?? '') === value)
        if (matchesId) rows.splice(index, 1)
      }
      result = {}
    } else {
      throw new Error(`Unsupported mock ${resource} method: ${method}`)
    }
  }

  return copy(result) as T
}
