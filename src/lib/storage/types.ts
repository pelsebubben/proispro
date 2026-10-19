// Storage-adapter seam (Phase 0).
//
// This module defines the backend-agnostic persistence contract the hooks
// depend on. Today the only implementation is the SupabaseAdapter (which wraps
// the current `supabase.from(...)` calls verbatim). A future AzureAdapter can
// implement this same interface without any hook change — that is the whole
// point of the seam: hooks no longer know what the backend is.
//
// Entity types are the EXISTING client-side shapes. ClientDisc / ClientBag live
// in utils/disc.ts and are imported here; the remaining client shapes used to
// live inline in the hooks and are centralised here (re-exported from the hooks
// so existing page imports keep working).

import { ClientDisc, ClientBag } from '../../utils/disc'

export type { ClientDisc, ClientBag }

// --- Centralised client entity types (previously declared inside the hooks) ---

export interface ClientPin {
  id: string
  courseName: string
  courseId: string | null
  bagId: string
  createdAt: number
}

export interface HoleAssignment {
  id: string
  course_pin_id: string
  hole_ref: string
  disc_id: string
  disc_name: string
}

export interface ClientCollection {
  id: string
  name: string
  description: string
}

export interface CollectionDisc {
  collection_id: string
  disc_id: string
}

export interface WishlistItem {
  id: string
  disc_name: string
  manufacturer: string
  plastic_pref: string
  weight_min: number | null
  weight_max: number | null
  priority: number
  notes: string
  acquired: boolean
  created_at: string
}

export interface ForSaleListing {
  id: string
  disc_id: string
  disc_name: string
  disc_manufacturer: string
  disc_type: string
  disc_plastic: string
  disc_color: string
  disc_weight: string
  disc_condition: string
  status: 'available' | 'sold'
  listed_at: string
}

export interface BagHistoryEntry {
  id: string
  bag_id: string
  disc_id: string
  disc_name: string
  action: 'added' | 'removed'
  changed_at: string
}

export interface SaleTokenRecord {
  token: string
  is_public: boolean
}

// --- The generic collection contract -----------------------------------------

export interface Collection<T> {
  list(): Promise<T[]>
  get(id: string): Promise<T | undefined>
  put(item: T): Promise<T>
  remove(id: string): Promise<void>
}

// --- Per-entity collections (base contract + the extra methods each hook
//     genuinely uses today; nothing speculative) --------------------------------

export interface DiscsCollection extends Collection<ClientDisc> {
  // list() returns discs ordered by added_at desc.
  create(disc: ClientDisc, userId: string): Promise<ClientDisc>
  update(disc: ClientDisc): Promise<void>
  setQuantity(id: string, quantity: number): Promise<void>
}

export interface BagsCollection extends Collection<ClientBag> {
  create(bag: ClientBag, userId: string): Promise<void>
  update(id: string, patch: Partial<Pick<ClientBag, 'name' | 'disc_ids'>>): Promise<void>
}

export interface BagHistoryCollection {
  add(entry: {
    bagId: string
    discId: string
    discName: string
    action: 'added' | 'removed'
    userId?: string
  }): Promise<void>
  listForBag(bagId: string): Promise<BagHistoryEntry[]>
}

export interface CoursePinsCollection extends Collection<ClientPin> {
  // list() returns pins ordered by created_at desc.
  // Returns true when the insert succeeded (mirrors the hook's success gate).
  create(input: { courseName: string; courseId: string | null; bagId: string }): Promise<boolean>
  update(
    id: string,
    patch: Partial<Pick<ClientPin, 'courseName' | 'courseId' | 'bagId'>>
  ): Promise<void>
}

export interface HoleAssignmentsCollection extends Collection<HoleAssignment> {
  create(input: {
    pinId: string
    holeRef: string
    discId: string
    discName: string
    userId: string
  }): Promise<void>
  update(id: string, patch: { disc_id: string; disc_name: string }): Promise<void>
  removeByPin(pinId: string): Promise<void>
}

export interface CollectionsCollection extends Collection<ClientCollection> {
  // list() returns collections ordered by created_at desc.
  create(input: { name: string; description: string }): Promise<void>
  update(id: string, patch: { name: string; description: string }): Promise<void>
}

export interface CollectionDiscsCollection {
  list(): Promise<CollectionDisc[]>
  add(collectionId: string, discId: string): Promise<void>
  remove(collectionId: string, discId: string): Promise<void>
  removeByCollection(collectionId: string): Promise<void>
}

export interface WishlistCollection extends Collection<WishlistItem> {
  // list() returns items ordered by priority desc, then created_at desc.
  create(input: Omit<WishlistItem, 'id' | 'created_at' | 'acquired'>): Promise<void>
  update(id: string, patch: Partial<WishlistItem>): Promise<void>
}

export interface ForSaleCollection extends Collection<ForSaleListing> {
  // list() returns listings ordered by listed_at desc.
  create(disc: ClientDisc): Promise<void>
  updateStatus(id: string, status: 'available' | 'sold'): Promise<void>
}

export interface SaleTokensCollection {
  getForUser(userId: string): Promise<SaleTokenRecord | undefined>
  upsert(userId: string, token: string, isPublic: boolean): Promise<void>
  setPublic(userId: string, isPublic: boolean): Promise<void>
}

// --- Backup / portability shape (used by exportAll/importAll) -----------------

export interface StorageExport {
  discs: ClientDisc[]
  bags: ClientBag[]
  coursePins: ClientPin[]
  holeAssignments: HoleAssignment[]
  collections: ClientCollection[]
  collectionDiscs: CollectionDisc[]
  wishlist: WishlistItem[]
  forSale: ForSaleListing[]
}

// --- The adapter the hooks talk to --------------------------------------------

export interface StorageAdapter {
  discs: DiscsCollection
  bags: BagsCollection
  bagHistory: BagHistoryCollection
  coursePins: CoursePinsCollection
  holeAssignments: HoleAssignmentsCollection
  collections: CollectionsCollection
  collectionDiscs: CollectionDiscsCollection
  wishlist: WishlistCollection
  forSale: ForSaleCollection
  saleTokens: SaleTokensCollection
  exportAll(): Promise<StorageExport>
  importAll(data: StorageExport): Promise<void>
}
