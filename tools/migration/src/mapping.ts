import * as sql from 'mssql'
import { SourceRow, EntityKey } from './types'
import { OwnerResolver } from './ownerMap'

// =============================================================================
// Postgres (Supabase) -> Azure SQL (T-SQL) translation.
//
// For each logical entity we declare:
//   target   : the dbo.<table> in api/db/schema.sql
//   pk       : primary-key column(s) used for idempotent MERGE
//   columns  : target column -> mssql type (so NULLs and decimals are explicit)
//   toRow    : maps a raw Supabase source row + resolved ownerId -> target values
//
// Column names/types below were reconciled directly against api/db/schema.sql.
// =============================================================================

export interface ColumnDef {
  name: string
  type: sql.ISqlType
}

export interface TableMapping {
  entity: EntityKey
  target: string
  pk: string[]
  columns: ColumnDef[]
  toRow: (src: SourceRow, ownerId: string) => Record<string, unknown>
}

// --- value coercion helpers --------------------------------------------------

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s
}

function strDefault(v: unknown, dflt: string): string {
  if (v == null) return dflt
  const s = String(v)
  return s === '' ? dflt : s
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v)
  return n == null ? null : Math.trunc(n)
}

function quantity(v: unknown): number {
  const n = numOrNull(v)
  return n == null ? 1 : Math.max(1, Math.trunc(n))
}

function boolToBit(v: unknown): number {
  if (v === true || v === 1 || v === '1') return 1
  if (typeof v === 'string') return /^(true|t|yes|1)$/i.test(v) ? 1 : 0
  return v ? 1 : 0
}

function dateOrNull(v: unknown): Date | null {
  if (v == null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function dateOrNow(v: unknown): Date {
  return dateOrNull(v) ?? new Date()
}

// JSON array/object -> NVARCHAR(MAX) JSON text. Accepts already-stringified JSON.
function jsonText(v: unknown, dflt: string | null): string | null {
  if (v == null) return dflt
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? dflt : t
  }
  try {
    return JSON.stringify(v)
  } catch {
    return dflt
  }
}

function oneOf(v: unknown, allowed: string[], dflt: string): string {
  const s = v == null ? '' : String(v)
  return allowed.includes(s) ? s : dflt
}

// --- mssql type shorthands ---------------------------------------------------

const NV = (len: number): sql.ISqlType => sql.NVarChar(len) as unknown as sql.ISqlType
const NVMAX = (): sql.ISqlType => sql.NVarChar(sql.MAX) as unknown as sql.ISqlType
const INT = (): sql.ISqlType => sql.Int() as unknown as sql.ISqlType
const BIT = (): sql.ISqlType => sql.Bit() as unknown as sql.ISqlType
const DT2 = (): sql.ISqlType => sql.DateTime2(3) as unknown as sql.ISqlType
const DEC = (p: number, s: number): sql.ISqlType =>
  sql.Decimal(p, s) as unknown as sql.ISqlType

// =============================================================================
// Table mappings (ordered for human readability; import order is independent
// because the Azure SQL target has no foreign keys).
// =============================================================================

export const TABLE_MAPPINGS: TableMapping[] = [
  {
    entity: 'discs',
    target: 'dbo.discs',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'name', type: NV(200) },
      { name: 'manufacturer', type: NV(200) },
      { name: 'disc_type', type: NV(50) },
      { name: 'plastic', type: NV(100) },
      { name: 'weight', type: DEC(5, 1) },
      { name: 'color', type: NV(100) },
      { name: 'condition', type: NV(50) },
      { name: 'speed', type: DEC(4, 1) },
      { name: 'glide', type: DEC(4, 1) },
      { name: 'turn', type: DEC(4, 1) },
      { name: 'fade', type: DEC(4, 1) },
      { name: 'notes', type: NVMAX() },
      { name: 'tags', type: NVMAX() },
      { name: 'user_photo_url', type: NV(400) },
      { name: 'quantity', type: INT() },
      { name: 'added_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      name: strDefault(s.name, ''),
      manufacturer: str(s.manufacturer),
      disc_type: str(s.disc_type),
      plastic: str(s.plastic),
      weight: numOrNull(s.weight),
      color: str(s.color),
      condition: str(s.condition),
      speed: numOrNull(s.speed),
      glide: numOrNull(s.glide),
      turn: numOrNull(s.turn),
      fade: numOrNull(s.fade),
      notes: str(s.notes),
      tags: jsonText(s.tags, null),
      user_photo_url: str(s.user_photo_url),
      quantity: quantity(s.quantity),
      added_at: dateOrNow(s.added_at),
    }),
  },
  {
    entity: 'bags',
    target: 'dbo.bags',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'name', type: NV(200) },
      { name: 'disc_ids', type: NVMAX() },
      { name: 'created_at', type: DT2() },
      { name: 'updated_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      name: strDefault(s.name, ''),
      disc_ids: jsonText(s.disc_ids, '[]'),
      created_at: dateOrNow(s.created_at),
      updated_at: dateOrNow(s.updated_at),
    }),
  },
  {
    entity: 'coursePins',
    target: 'dbo.course_pins',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'course_name', type: NV(200) },
      { name: 'course_id', type: NV(64) },
      { name: 'bag_id', type: NV(64) },
      { name: 'created_at', type: DT2() },
    ],
    // Source `holes_data` JSONB has no target column in api/db/schema.sql and is
    // intentionally dropped (hole data lives in hole_assignments).
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      course_name: strDefault(s.course_name, ''),
      course_id: str(s.course_id),
      bag_id: strDefault(s.bag_id, ''),
      created_at: dateOrNow(s.created_at),
    }),
  },
  {
    entity: 'holeAssignments',
    target: 'dbo.hole_assignments',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'course_pin_id', type: NV(64) },
      { name: 'hole_ref', type: NV(50) },
      { name: 'disc_id', type: NV(64) },
      { name: 'disc_name', type: NV(200) },
      { name: 'created_at', type: DT2() },
      { name: 'updated_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      course_pin_id: strDefault(s.course_pin_id, ''),
      hole_ref: strDefault(s.hole_ref, ''),
      disc_id: str(s.disc_id),
      disc_name: strDefault(s.disc_name, ''),
      created_at: dateOrNow(s.created_at),
      updated_at: dateOrNow(s.updated_at),
    }),
  },
  {
    entity: 'collections',
    target: 'dbo.collections',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'name', type: NV(200) },
      { name: 'description', type: NVMAX() },
      { name: 'created_at', type: DT2() },
      { name: 'updated_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      name: strDefault(s.name, ''),
      description: str(s.description),
      created_at: dateOrNow(s.created_at),
      updated_at: dateOrNow(s.updated_at),
    }),
  },
  {
    entity: 'collectionDiscs',
    target: 'dbo.collection_discs',
    pk: ['collection_id', 'disc_id'],
    columns: [
      { name: 'collection_id', type: NV(64) },
      { name: 'disc_id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'sort_order', type: INT() },
      { name: 'added_at', type: DT2() },
    ],
    // Source collection_discs has NO user_id column. export.ts stamps each row
    // with `user_id` resolved from its parent collection so ownership survives.
    toRow: (s, ownerId) => ({
      collection_id: strDefault(s.collection_id, ''),
      disc_id: strDefault(s.disc_id, ''),
      ownerId,
      sort_order: intOrNull(s.sort_order) ?? 0,
      added_at: dateOrNow(s.added_at),
    }),
  },
  {
    entity: 'wishlist',
    target: 'dbo.wishlist_items',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'disc_name', type: NV(200) },
      { name: 'manufacturer', type: NV(200) },
      { name: 'plastic_pref', type: NV(100) },
      { name: 'weight_min', type: INT() },
      { name: 'weight_max', type: INT() },
      { name: 'priority', type: INT() },
      { name: 'notes', type: NVMAX() },
      { name: 'acquired', type: BIT() },
      { name: 'created_at', type: DT2() },
      { name: 'updated_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      disc_name: strDefault(s.disc_name, ''),
      manufacturer: str(s.manufacturer),
      plastic_pref: str(s.plastic_pref),
      weight_min: intOrNull(s.weight_min),
      weight_max: intOrNull(s.weight_max),
      priority: intOrNull(s.priority) ?? 0,
      notes: str(s.notes),
      acquired: boolToBit(s.acquired),
      created_at: dateOrNow(s.created_at),
      updated_at: dateOrNow(s.updated_at),
    }),
  },
  {
    entity: 'forSale',
    target: 'dbo.forsale_listings',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'disc_id', type: NV(64) },
      { name: 'disc_name', type: NV(200) },
      { name: 'disc_manufacturer', type: NV(200) },
      { name: 'disc_type', type: NV(50) },
      { name: 'disc_plastic', type: NV(100) },
      { name: 'disc_color', type: NV(100) },
      { name: 'disc_weight', type: DEC(6, 1) },
      { name: 'disc_condition', type: NV(50) },
      { name: 'status', type: NV(20) },
      { name: 'visibility', type: NV(20) },
      { name: 'seller_name', type: NV(200) },
      { name: 'listed_at', type: DT2() },
    ],
    // `visibility` and `seller_name` are NEW in the Azure schema (friends
    // marketplace); they do not exist in Supabase. Default visibility -> 'private'
    // (owner opts in later); seller_name -> source value if present else null.
    // Legacy source columns price/currency/contact_* have no target and drop.
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      disc_id: str(s.disc_id),
      disc_name: str(s.disc_name),
      disc_manufacturer: str(s.disc_manufacturer),
      disc_type: str(s.disc_type),
      disc_plastic: str(s.disc_plastic),
      disc_color: str(s.disc_color),
      disc_weight: numOrNull(s.disc_weight),
      disc_condition: str(s.disc_condition),
      status: oneOf(s.status, ['available', 'sold'], 'available'),
      visibility: oneOf(s.visibility, ['private', 'shared'], 'private'),
      seller_name: str(s.seller_name),
      listed_at: dateOrNow(s.listed_at),
    }),
  },
  {
    entity: 'bagHistory',
    target: 'dbo.bag_history',
    pk: ['id'],
    columns: [
      { name: 'id', type: NV(64) },
      { name: 'ownerId', type: NV(100) },
      { name: 'bag_id', type: NV(64) },
      { name: 'disc_id', type: NV(64) },
      { name: 'disc_name', type: NV(200) },
      { name: 'action', type: NV(20) },
      { name: 'changed_at', type: DT2() },
    ],
    toRow: (s, ownerId) => ({
      id: str(s.id),
      ownerId,
      bag_id: strDefault(s.bag_id, ''),
      disc_id: str(s.disc_id),
      disc_name: strDefault(s.disc_name, ''),
      action: oneOf(s.action, ['added', 'removed'], 'added'),
      changed_at: dateOrNow(s.changed_at),
    }),
  },
]

export function mappingFor(entity: EntityKey): TableMapping {
  const m = TABLE_MAPPINGS.find((x) => x.entity === entity)
  if (!m) throw new Error(`No table mapping for entity ${entity}`)
  return m
}

// The resolver is passed through for a single call site in import.ts; kept here
// so the owner-stamping decision lives beside the rest of the translation.
export function stampOwner(resolver: OwnerResolver, src: SourceRow): string {
  return resolver.resolve(src.user_id)
}
