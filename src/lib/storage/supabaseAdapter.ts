// SupabaseAdapter — Phase 0 implementation of the StorageAdapter seam.
//
// Every method below is a verbatim move of the `supabase.from(...)` logic that
// used to live inside the hooks. Behaviour (ordering, optimistic-update
// contracts, toDbDisc/fromDbDisc mapping, and the fact that Supabase surfaces
// DB errors in `{ error }` rather than by rejecting) is preserved exactly.
//
// Note on error handling: the Supabase JS client does NOT reject on a database
// error — it resolves with `{ data, error }`. The original hooks therefore only
// `throw` in the few spots that explicitly inspected `error` (all in useDiscs).
// Those spots throw here too; everywhere else the error is ignored exactly as
// before.

import { supabase } from '../supabase'
import { ClientDisc, ClientBag, fromDbDisc, toDbDisc } from '../../utils/disc'
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

// --- Row → client mappers (shared by list()/get()) ---------------------------

function mapBag(b: any): ClientBag {
  return {
    id: b.id,
    name: b.name || '',
    disc_ids: Array.isArray(b.disc_ids) ? b.disc_ids : [],
  }
}

function mapPin(p: any): ClientPin {
  return {
    id: p.id,
    courseName: p.course_name || '',
    courseId: p.course_id || null,
    bagId: p.bag_id || '',
    createdAt: new Date(p.created_at).getTime(),
  }
}

function mapHole(h: any): HoleAssignment {
  return {
    id: h.id,
    course_pin_id: h.course_pin_id,
    hole_ref: h.hole_ref || '',
    disc_id: h.disc_id || '',
    disc_name: h.disc_name || '',
  }
}

function mapCollection(c: any): ClientCollection {
  return {
    id: c.id,
    name: c.name || '',
    description: c.description || '',
  }
}

function mapCollectionDisc(cd: any): CollectionDisc {
  return {
    collection_id: cd.collection_id,
    disc_id: cd.disc_id,
  }
}

function mapWishlist(w: any): WishlistItem {
  return {
    id: w.id,
    disc_name: w.disc_name || '',
    manufacturer: w.manufacturer || '',
    plastic_pref: w.plastic_pref || '',
    weight_min: w.weight_min,
    weight_max: w.weight_max,
    priority: w.priority ?? 0,
    notes: w.notes || '',
    acquired: w.acquired ?? false,
    created_at: w.created_at,
  }
}

function mapListing(l: any): ForSaleListing {
  return {
    id: l.id,
    disc_id: l.disc_id || '',
    disc_name: l.disc_name || '',
    disc_manufacturer: l.disc_manufacturer || '',
    disc_type: l.disc_type || '',
    disc_plastic: l.disc_plastic || '',
    disc_color: l.disc_color || '',
    disc_weight: l.disc_weight || '',
    disc_condition: l.disc_condition || 'good',
    status: l.status === 'sold' ? 'sold' : 'available',
    listed_at: l.listed_at,
  }
}

// --- discs --------------------------------------------------------------------

const discs: DiscsCollection = {
  async list() {
    const { data, error } = await supabase
      .from('discs')
      .select('*')
      .order('added_at', { ascending: false })
    if (error) throw error
    return (data || []).map(fromDbDisc)
  },
  async get(id) {
    const { data } = await supabase.from('discs').select('*').eq('id', id).single()
    return data ? fromDbDisc(data) : undefined
  },
  async put(item) {
    const { data, error } = await supabase
      .from('discs')
      .upsert(toDbDisc(item))
      .select()
      .single()
    if (error) throw error
    return fromDbDisc(data)
  },
  async remove(id) {
    const { error } = await supabase.from('discs').delete().eq('id', id)
    if (error) throw error
  },
  async create(disc, userId) {
    const { data, error } = await supabase
      .from('discs')
      .insert([{ ...toDbDisc(disc), user_id: userId }])
      .select()
      .single()
    if (error) throw new Error(error.message)
    return fromDbDisc(data)
  },
  async update(disc) {
    const { error } = await supabase.from('discs').update(toDbDisc(disc)).eq('id', disc.id)
    if (error) throw error
  },
  async setQuantity(id, quantity) {
    const { error } = await supabase.from('discs').update({ quantity }).eq('id', id)
    if (error) throw error
  },
}

// --- bags ---------------------------------------------------------------------

const bags: BagsCollection = {
  async list() {
    const { data } = await supabase.from('bags').select('id, name, disc_ids')
    return (data || []).map(mapBag)
  },
  async get(id) {
    const { data } = await supabase.from('bags').select('id, name, disc_ids').eq('id', id).single()
    return data ? mapBag(data) : undefined
  },
  async put(item) {
    await supabase
      .from('bags')
      .upsert({ id: item.id, name: item.name, disc_ids: item.disc_ids })
    return item
  },
  async remove(id) {
    await supabase.from('bags').delete().eq('id', id)
  },
  async create(bag, userId) {
    await supabase.from('bags').insert({
      id: bag.id,
      name: bag.name,
      disc_ids: bag.disc_ids,
      user_id: userId,
    })
  },
  async update(id, patch) {
    await supabase.from('bags').update(patch).eq('id', id)
  },
}

// --- bag history --------------------------------------------------------------

const bagHistory: BagHistoryCollection = {
  async add(entry) {
    try {
      await supabase.from('bag_history').insert({
        bag_id: entry.bagId,
        disc_id: entry.discId,
        disc_name: entry.discName,
        action: entry.action,
        user_id: entry.userId,
      })
    } catch {
      // Non-critical, swallow errors
    }
  },
  async listForBag(bagId) {
    const { data } = await supabase
      .from('bag_history')
      .select('*')
      .eq('bag_id', bagId)
      .order('changed_at', { ascending: false })
      .limit(20)
    return (data || []) as BagHistoryEntry[]
  },
}

// --- course pins --------------------------------------------------------------

const coursePins: CoursePinsCollection = {
  async list() {
    const { data } = await supabase
      .from('course_pins')
      .select('*')
      .order('created_at', { ascending: false })
    return (data || []).map(mapPin)
  },
  async get(id) {
    const { data } = await supabase.from('course_pins').select('*').eq('id', id).single()
    return data ? mapPin(data) : undefined
  },
  async put(item) {
    await supabase.from('course_pins').upsert({
      id: item.id,
      course_name: item.courseName,
      course_id: item.courseId,
      bag_id: item.bagId,
    })
    return item
  },
  async remove(id) {
    await supabase.from('course_pins').delete().eq('id', id)
  },
  async create(input) {
    const { data, error } = await supabase
      .from('course_pins')
      .insert({ course_name: input.courseName, course_id: input.courseId, bag_id: input.bagId })
      .select()
      .single()
    return !error && !!data
  },
  async update(id, patch) {
    const dbUpdates: Record<string, any> = {}
    if (patch.courseName !== undefined) dbUpdates.course_name = patch.courseName
    if (patch.courseId !== undefined) dbUpdates.course_id = patch.courseId
    if (patch.bagId !== undefined) dbUpdates.bag_id = patch.bagId
    await supabase.from('course_pins').update(dbUpdates).eq('id', id)
  },
}

// --- hole assignments ---------------------------------------------------------

const holeAssignments: HoleAssignmentsCollection = {
  async list() {
    const { data } = await supabase.from('hole_assignments').select('*')
    return (data || []).map(mapHole)
  },
  async get(id) {
    const { data } = await supabase.from('hole_assignments').select('*').eq('id', id).single()
    return data ? mapHole(data) : undefined
  },
  async put(item) {
    await supabase.from('hole_assignments').upsert({
      id: item.id,
      course_pin_id: item.course_pin_id,
      hole_ref: item.hole_ref,
      disc_id: item.disc_id,
      disc_name: item.disc_name,
    })
    return item
  },
  async remove(id) {
    await supabase.from('hole_assignments').delete().eq('id', id)
  },
  async create(input) {
    await supabase.from('hole_assignments').insert({
      course_pin_id: input.pinId,
      hole_ref: input.holeRef,
      disc_id: input.discId,
      disc_name: input.discName,
      user_id: input.userId,
    })
  },
  async update(id, patch) {
    await supabase.from('hole_assignments').update(patch).eq('id', id)
  },
  async removeByPin(pinId) {
    await supabase.from('hole_assignments').delete().eq('course_pin_id', pinId)
  },
}

// --- collections --------------------------------------------------------------

const collections: CollectionsCollection = {
  async list() {
    const { data } = await supabase
      .from('collections')
      .select('*')
      .order('created_at', { ascending: false })
    return (data || []).map(mapCollection)
  },
  async get(id) {
    const { data } = await supabase.from('collections').select('*').eq('id', id).single()
    return data ? mapCollection(data) : undefined
  },
  async put(item) {
    await supabase
      .from('collections')
      .upsert({ id: item.id, name: item.name, description: item.description })
    return item
  },
  async remove(id) {
    await supabase.from('collections').delete().eq('id', id)
  },
  async create(input) {
    await supabase.from('collections').insert({ name: input.name, description: input.description })
  },
  async update(id, patch) {
    await supabase.from('collections').update({ name: patch.name, description: patch.description }).eq('id', id)
  },
}

// --- collection ↔ disc join ---------------------------------------------------

const collectionDiscs: CollectionDiscsCollection = {
  async list() {
    const { data } = await supabase.from('collection_discs').select('collection_id, disc_id')
    return (data || []).map(mapCollectionDisc)
  },
  async add(collectionId, discId) {
    await supabase.from('collection_discs').insert({ collection_id: collectionId, disc_id: discId })
  },
  async remove(collectionId, discId) {
    await supabase
      .from('collection_discs')
      .delete()
      .eq('collection_id', collectionId)
      .eq('disc_id', discId)
  },
  async removeByCollection(collectionId) {
    await supabase.from('collection_discs').delete().eq('collection_id', collectionId)
  },
}

// --- wishlist -----------------------------------------------------------------

const wishlist: WishlistCollection = {
  async list() {
    const { data } = await supabase
      .from('wishlist_items')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
    return (data || []).map(mapWishlist)
  },
  async get(id) {
    const { data } = await supabase.from('wishlist_items').select('*').eq('id', id).single()
    return data ? mapWishlist(data) : undefined
  },
  async put(item) {
    await supabase.from('wishlist_items').upsert({
      id: item.id,
      disc_name: item.disc_name,
      manufacturer: item.manufacturer,
      plastic_pref: item.plastic_pref,
      weight_min: item.weight_min,
      weight_max: item.weight_max,
      priority: item.priority,
      notes: item.notes,
      acquired: item.acquired,
      created_at: item.created_at,
    })
    return item
  },
  async remove(id) {
    await supabase.from('wishlist_items').delete().eq('id', id)
  },
  async create(input) {
    await supabase.from('wishlist_items').insert({
      disc_name: input.disc_name,
      manufacturer: input.manufacturer,
      plastic_pref: input.plastic_pref,
      weight_min: input.weight_min,
      weight_max: input.weight_max,
      priority: input.priority,
      notes: input.notes,
      acquired: false,
    })
  },
  async update(id, patch) {
    await supabase.from('wishlist_items').update(patch).eq('id', id)
  },
}

// --- for sale -----------------------------------------------------------------

const forSale: ForSaleCollection = {
  async list() {
    const { data } = await supabase
      .from('forsale_listings')
      .select('*')
      .order('listed_at', { ascending: false })
    return (data || []).map(mapListing)
  },
  async get(id) {
    const { data } = await supabase.from('forsale_listings').select('*').eq('id', id).single()
    return data ? mapListing(data) : undefined
  },
  async put(item) {
    await supabase.from('forsale_listings').upsert({
      id: item.id,
      disc_id: item.disc_id,
      disc_name: item.disc_name,
      disc_manufacturer: item.disc_manufacturer,
      disc_type: item.disc_type,
      disc_plastic: item.disc_plastic,
      disc_color: item.disc_color,
      disc_weight: item.disc_weight,
      disc_condition: item.disc_condition,
      status: item.status,
      listed_at: item.listed_at,
    })
    return item
  },
  async remove(id) {
    await supabase.from('forsale_listings').delete().eq('id', id)
  },
  async create(disc: ClientDisc) {
    await supabase.from('forsale_listings').insert({
      disc_id: disc.id,
      disc_name: disc.name,
      disc_manufacturer: disc.manufacturer,
      disc_type: disc.type,
      disc_plastic: disc.plastic,
      disc_color: disc.color,
      disc_weight: disc.weight,
      disc_condition: disc.condition,
      status: 'available',
    })
  },
  async updateStatus(id, status) {
    await supabase.from('forsale_listings').update({ status }).eq('id', id)
  },
}

// --- sale tokens --------------------------------------------------------------

const saleTokens: SaleTokensCollection = {
  async getForUser(userId): Promise<SaleTokenRecord | undefined> {
    const { data } = await supabase.from('sale_tokens').select('*').eq('user_id', userId).single()
    if (!data) return undefined
    return { token: data.token || '', is_public: data.is_public ?? false }
  },
  async upsert(userId, token, isPublic) {
    await supabase.from('sale_tokens').upsert(
      { user_id: userId, token, is_public: isPublic },
      { onConflict: 'user_id' }
    )
  },
  async setPublic(userId, isPublic) {
    await supabase.from('sale_tokens').update({ is_public: isPublic }).eq('user_id', userId)
  },
}

// --- the adapter --------------------------------------------------------------

export const supabaseAdapter: StorageAdapter = {
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

  async importAll(_data: StorageExport): Promise<void> {
    // Intentionally unimplemented in Phase 0. Bulk import/restore is a
    // migration-phase concern (see docs/adr-azure-entra-rebuild.md). The future
    // AzureAdapter will own this path; wiring it into Supabase now would add an
    // untested write path for zero current benefit.
    throw new Error('importAll is not implemented for the SupabaseAdapter (Phase 0)')
  },
}
