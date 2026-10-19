// wishlist — mirrors WishlistItem. Ordered by priority desc, created_at desc.
import { FastifyInstance } from 'fastify'
import { registerCrud, Row, toNumberOrNull } from './crud'

function fromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    disc_name: String(r.disc_name ?? ''),
    manufacturer: String(r.manufacturer ?? ''),
    plastic_pref: String(r.plastic_pref ?? ''),
    weight_min: r.weight_min == null ? null : Number(r.weight_min),
    weight_max: r.weight_max == null ? null : Number(r.weight_max),
    priority: r.priority == null ? 0 : Number(r.priority),
    notes: String(r.notes ?? ''),
    acquired: Boolean(r.acquired),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
  }
}

function toRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    disc_name: String(body.disc_name ?? ''),
    manufacturer: body.manufacturer ? String(body.manufacturer) : null,
    plastic_pref: body.plastic_pref ? String(body.plastic_pref) : null,
    weight_min: toNumberOrNull(body.weight_min),
    weight_max: toNumberOrNull(body.weight_max),
    priority: body.priority == null ? 0 : Number(body.priority),
    notes: body.notes ? String(body.notes) : null,
    acquired: body.acquired ? 1 : 0,
  }
}

export function registerWishlistRoutes(app: FastifyInstance): void {
  registerCrud(app, {
    route: 'wishlist',
    table: 'wishlist_items',
    orderBy: 'priority DESC, created_at DESC',
    immutable: ['created_at'],
    fromRow,
    toRow,
  })
}
