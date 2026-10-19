// AzureAdapter — Phase 3 implementation of the StorageAdapter seam.
//
// A dumb transport: every method is a `fetch('/api/...')` against the REST surface
// Danny built (api/README.md). Same-origin by default — under Static Web Apps the
// SPA is linked to the API backend, so `/api/*` is proxied to the ACA container
// and the Entra session cookie / `x-ms-client-principal` header rides along
// automatically. `credentials: 'include'` keeps that cookie on every request.
//
// SECURITY: the server stamps `ownerId` from the verified principal and ignores
// any owner field in the body. This adapter therefore NEVER sends an owner/userId
// in the body (unlike the Supabase path, which needs user_id). `userId` params on
// create() are accepted to keep the Collection<T> contract identical, but dropped.
//
// Ordering is owned by the server (see api/README.md). The upsert endpoints are
// full-document (POST/PUT run toRow over the whole body), so partial updates are
// read-modify-write: fetch the current row, merge the patch, re-upsert.

import { ClientDisc, ClientBag } from '../../utils/disc'
import {
  StorageAdapter,
  DiscsCollection,
  BagsCollection,
  BagHistoryCollection,
  CoursePinsCollection,
  HoleAssignmentsCollection,
  CollectionsCollection,
  CollectionDiscsCollection,
  WishlistCollection,
  ForSaleCollection,
  SaleTokensCollection,
  ClientPin,
  HoleAssignment,
  ClientCollection,
  CollectionDisc,
  WishlistItem,
  ForSaleListing,
  BagHistoryEntry,
  SaleTokenRecord,
  StorageExport,
} from './types'

// --- transport ----------------------------------------------------------------

// Same origin by default (SWA linked backend). VITE_API_BASE lets local dev point
// the SPA at a standalone API (e.g. http://localhost:3000/api).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

interface ApiError {
  error?: string
  message?: string
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiError
    return body?.message || body?.error || res.statusText || `HTTP ${res.status}`
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function getJson<T>(path: string): Promise<T> {
  const res = await request(path)
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()) as T
}

// GET that treats 404 as "not found" (undefined) rather than an error, mirroring
// the Supabase get()/single() contract the hooks expect.
async function getMaybe<T>(path: string): Promise<T | undefined> {
  const res = await request(path)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()) as T
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()) as T
}

async function del(path: string): Promise<void> {
  const res = await request(path, { method: 'DELETE' })
  // 404 on delete means the row is already gone — treat as success (idempotent).
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

const seg = (id: string) => encodeURIComponent(id)

// --- generic Collection<T> over one REST route --------------------------------

function restCollection<T extends { id: string }>(route: string) {
  return {
    list(): Promise<T[]> {
      return getJson<T[]>(`/${route}`)
    },
    get(id: string): Promise<T | undefined> {
      return getMaybe<T>(`/${route}/${seg(id)}`)
    },
    put(item: T): Promise<T> {
      return postJson<T>(`/${route}`, item)
    },
    async remove(id: string): Promise<void> {
      await del(`/${route}/${seg(id)}`)
    },
  }
}

// Read-modify-write partial update: the upsert endpoints replace the whole row,
// so merge the patch onto the current server document before re-upserting.
async function patchRoute<T extends { id: string }>(
  route: string,
  id: string,
  patch: Partial<T>
): Promise<void> {
  const current = await getMaybe<T>(`/${route}/${seg(id)}`)
  if (!current) return
  await postJson<T>(`/${route}`, { ...current, ...patch })
}

// --- discs --------------------------------------------------------------------

const discsBase = restCollection<ClientDisc>('discs')
const discs: DiscsCollection = {
  ...discsBase,
  // The server stamps ownerId; userId is intentionally dropped from the body.
  async create(disc) {
    return postJson<ClientDisc>('/discs', disc)
  },
  async update(disc) {
    await postJson('/discs', disc)
  },
  async setQuantity(id, quantity) {
    await patchRoute<ClientDisc>('discs', id, { quantity })
  },
}

// --- bags ---------------------------------------------------------------------

const bagsBase = restCollection<ClientBag>('bags')
const bags: BagsCollection = {
  ...bagsBase,
  async create(bag) {
    await postJson('/bags', { id: bag.id, name: bag.name, disc_ids: bag.disc_ids })
  },
  async update(id, patch) {
    await patchRoute<ClientBag>('bags', id, patch)
  },
}

// --- bag history --------------------------------------------------------------
//
// Not part of the Azure REST surface. The audit log was a Supabase-era nicety;
// the Azure data model (docs/adr-azure-entra-rebuild.md §3.2) does not carry it.
// Kept as a no-op so the contract holds and the (best-effort, already swallowed)
// callers keep working. If a history surface is ever wanted, add /api/bagHistory
// and back these two methods onto it — nothing else changes.
const bagHistory: BagHistoryCollection = {
  async add() {
    // no-op (non-critical; Supabase path also swallows failures)
  },
  async listForBag(): Promise<BagHistoryEntry[]> {
    return []
  },
}

// --- course pins --------------------------------------------------------------

const coursePinsBase = restCollection<ClientPin>('coursePins')
const coursePins: CoursePinsCollection = {
  ...coursePinsBase,
  // Supabase let the DB mint the id; the Azure upsert requires one in the body,
  // so mint it client-side. Returns true on success (mirrors the hook's gate).
  async create(input) {
    const pin: ClientPin = {
      id: crypto.randomUUID(),
      courseName: input.courseName,
      courseId: input.courseId,
      bagId: input.bagId,
      createdAt: Date.now(),
    }
    try {
      await postJson('/coursePins', pin)
      return true
    } catch {
      return false
    }
  },
  async update(id, patch) {
    await patchRoute<ClientPin>('coursePins', id, patch)
  },
}

// --- hole assignments ---------------------------------------------------------

const holeAssignmentsBase = restCollection<HoleAssignment>('holeAssignments')
const holeAssignments: HoleAssignmentsCollection = {
  ...holeAssignmentsBase,
  async create(input) {
    const assignment: HoleAssignment = {
      id: crypto.randomUUID(),
      course_pin_id: input.pinId,
      hole_ref: input.holeRef,
      disc_id: input.discId,
      disc_name: input.discName,
    }
    await postJson('/holeAssignments', assignment)
  },
  async update(id, patch) {
    await patchRoute<HoleAssignment>('holeAssignments', id, patch)
  },
  // No bulk-by-pin endpoint; list, filter client-side, delete each.
  async removeByPin(pinId) {
    const all = await holeAssignmentsBase.list()
    await Promise.all(
      all.filter((h) => h.course_pin_id === pinId).map((h) => holeAssignmentsBase.remove(h.id))
    )
  },
}

// --- collections --------------------------------------------------------------

const collectionsBase = restCollection<ClientCollection>('collections')
const collections: CollectionsCollection = {
  ...collectionsBase,
  async create(input) {
    const collection: ClientCollection = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
    }
    await postJson('/collections', collection)
  },
  async update(id, patch) {
    await patchRoute<ClientCollection>('collections', id, patch)
  },
}

// --- collection ↔ disc join ---------------------------------------------------
//
// Not part of the Azure REST surface. The ADR models collection membership as an
// embedded `discIds: string[]` on the collection, not a separate join table
// (docs/adr-azure-entra-rebuild.md §3.2), so there is no /api/collectionDiscs.
// Kept as no-ops/empties so the contract holds; wiring membership into the
// collections entity is a follow-up that stays behind this seam.
const collectionDiscs: CollectionDiscsCollection = {
  async list(): Promise<CollectionDisc[]> {
    return []
  },
  async add() {
    // no-op until membership is modeled on the Azure collections entity
  },
  async remove() {
    // no-op
  },
  async removeByCollection() {
    // no-op
  },
}

// --- wishlist -----------------------------------------------------------------

const wishlistBase = restCollection<WishlistItem>('wishlist')
const wishlist: WishlistCollection = {
  ...wishlistBase,
  async create(input) {
    const item: WishlistItem = {
      id: crypto.randomUUID(),
      disc_name: input.disc_name,
      manufacturer: input.manufacturer,
      plastic_pref: input.plastic_pref,
      weight_min: input.weight_min,
      weight_max: input.weight_max,
      priority: input.priority,
      notes: input.notes,
      acquired: false,
      created_at: new Date().toISOString(),
    }
    await postJson('/wishlist', item)
  },
  async update(id, patch) {
    await patchRoute<WishlistItem>('wishlist', id, patch)
  },
}

// --- for sale -----------------------------------------------------------------

const forSaleBase = restCollection<ForSaleListing>('forsale')
const forSale: ForSaleCollection & {
  listShared(): Promise<ForSaleListing[]>
} = {
  ...forSaleBase,
  async create(disc: ClientDisc) {
    const listing: ForSaleListing = {
      id: crypto.randomUUID(),
      disc_id: disc.id,
      disc_name: disc.name,
      disc_manufacturer: disc.manufacturer,
      disc_type: disc.type,
      disc_plastic: disc.plastic,
      disc_color: disc.color,
      disc_weight: disc.weight,
      disc_condition: disc.condition,
      status: 'available',
      listed_at: new Date().toISOString(),
    }
    await postJson('/forsale', listing)
  },
  async updateStatus(id, status) {
    await patchRoute<ForSaleListing>('forsale', id, { status })
  },
  // Friends marketplace: every owner's shared listings (read-only).
  listShared(): Promise<ForSaleListing[]> {
    return getJson<ForSaleListing[]>('/forsale/shared')
  },
}

// --- sale tokens --------------------------------------------------------------
//
// Not part of the Azure REST surface. The anonymous `sale.html?token=...` link is
// replaced by the authenticated friends marketplace (/api/forsale/shared, see
// docs/adr-azure-entra-rebuild.md §3.3), so there are no per-user sale tokens on
// Azure. Kept as no-ops/undefined so the ForSale hook keeps working (it simply
// never surfaces a public token under the Azure backend).
const saleTokens: SaleTokensCollection = {
  async getForUser(): Promise<SaleTokenRecord | undefined> {
    return undefined
  },
  async upsert() {
    // no-op (token flow superseded by the shared marketplace)
  },
  async setPublic() {
    // no-op
  },
}

// --- the adapter --------------------------------------------------------------

export const azureAdapter: StorageAdapter = {
  discs,
  bags,
  bagHistory,
  coursePins,
  holeAssignments,
  collections,
  collectionDiscs,
  wishlist,
  forSale,
  saleTokens,

  async exportAll(): Promise<StorageExport> {
    const [
      discsData,
      bagsData,
      coursePinsData,
      holeAssignmentsData,
      collectionsData,
      collectionDiscsData,
      wishlistData,
      forSaleData,
    ] = await Promise.all([
      discs.list(),
      bags.list(),
      coursePins.list(),
      holeAssignments.list(),
      collections.list(),
      collectionDiscs.list(),
      wishlist.list(),
      forSale.list(),
    ])
    return {
      discs: discsData,
      bags: bagsData,
      coursePins: coursePinsData,
      holeAssignments: holeAssignmentsData,
      collections: collectionsData,
      collectionDiscs: collectionDiscsData,
      wishlist: wishlistData,
      forSale: forSaleData,
    }
  },

  // Unlike the Supabase Phase-0 path, Azure can restore: re-upsert every item
  // per entity (the server stamps ownerId on each write). No bulk endpoint, so
  // this is straightforward per-entity iteration.
  async importAll(data: StorageExport): Promise<void> {
    await Promise.all([
      ...data.discs.map((d) => discs.put(d)),
      ...data.bags.map((b) => bags.put(b)),
      ...data.coursePins.map((p) => coursePins.put(p)),
      ...data.holeAssignments.map((h) => holeAssignments.put(h)),
      ...data.collections.map((c) => collections.put(c)),
      ...data.wishlist.map((w) => wishlist.put(w)),
      ...data.forSale.map((f) => forSale.put(f)),
    ])
  },
}
