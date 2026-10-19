// Backup JSON shape produced by export.ts and consumed by import.ts / verify.ts.
//
// Design choice (Basher): the backup stores RAW Supabase rows (snake_case,
// including the source `user_id`). This preserves source fidelity for a clean
// round-trip and keeps ownership intact. The Postgres -> T-SQL column/type
// translation happens at IMPORT time (see mapping.ts), not at export time, so
// the backup is a faithful dump you can re-import or audit independently.
//
// Top-level keys follow the StorageExport shape from src/lib/storage/types.ts
// (discs, bags, coursePins, holeAssignments, collections, collectionDiscs,
// wishlist, forSale) and additionally carry `bagHistory`, which the task
// requires but StorageExport omits.

export type SourceRow = Record<string, unknown>

export const BACKUP_VERSION = 2 as const

// Logical entity -> which Supabase table it came from. Single source of truth
// for both export and verify so the two never drift.
export const SOURCE_TABLES: Record<EntityKey, string> = {
  discs: 'discs',
  bags: 'bags',
  coursePins: 'course_pins',
  holeAssignments: 'hole_assignments',
  collections: 'collections',
  collectionDiscs: 'collection_discs',
  wishlist: 'wishlist_items',
  forSale: 'forsale_listings',
  bagHistory: 'bag_history',
}

export type EntityKey =
  | 'discs'
  | 'bags'
  | 'coursePins'
  | 'holeAssignments'
  | 'collections'
  | 'collectionDiscs'
  | 'wishlist'
  | 'forSale'
  | 'bagHistory'

export const ENTITY_KEYS: EntityKey[] = [
  'discs',
  'bags',
  'coursePins',
  'holeAssignments',
  'collections',
  'collectionDiscs',
  'wishlist',
  'forSale',
  'bagHistory',
]

export interface Backup {
  version: typeof BACKUP_VERSION
  source: 'supabase'
  exportedAt: number
  // Distinct source user_ids seen across all tables (for operator reference
  // when building an owner-map).
  userIds: string[]
  tables: Record<EntityKey, SourceRow[]>
}

export function emptyBackup(): Backup {
  return {
    version: BACKUP_VERSION,
    source: 'supabase',
    exportedAt: Date.now(),
    userIds: [],
    tables: {
      discs: [],
      bags: [],
      coursePins: [],
      holeAssignments: [],
      collections: [],
      collectionDiscs: [],
      wishlist: [],
      forSale: [],
      bagHistory: [],
    },
  }
}
