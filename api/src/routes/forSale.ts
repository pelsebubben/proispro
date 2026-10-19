// forSale — mirrors ForSaleListing plus `visibility` + a seller snapshot.
//
// Owner-scoped CRUD is identical to every other entity. On top of that:
//   GET /api/forsale/shared -> the friends marketplace: every listing with
//   visibility = 'shared', across ALL owners, read-only. Authenticated but not
//   owner-scoped (any signed-in friend can browse what others chose to share).
import { FastifyInstance } from 'fastify'
import { registerCrud, Row, toNumberOrNull, numStringOrEmpty } from './crud'
import { getPool, sql } from '../db'

function fromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    disc_id: String(r.disc_id ?? ''),
    disc_name: String(r.disc_name ?? ''),
    disc_manufacturer: String(r.disc_manufacturer ?? ''),
    disc_type: String(r.disc_type ?? ''),
    disc_plastic: String(r.disc_plastic ?? ''),
    disc_color: String(r.disc_color ?? ''),
    disc_weight: numStringOrEmpty(r.disc_weight),
    disc_condition: String(r.disc_condition ?? ''),
    status: (r.status === 'sold' ? 'sold' : 'available') as 'available' | 'sold',
    visibility: (r.visibility === 'shared' ? 'shared' : 'private') as 'shared' | 'private',
    seller_name: r.seller_name == null ? null : String(r.seller_name),
    listed_at: r.listed_at instanceof Date ? r.listed_at.toISOString() : String(r.listed_at ?? ''),
  }
}

function toRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    disc_id: body.disc_id ? String(body.disc_id) : null,
    disc_name: body.disc_name ? String(body.disc_name) : null,
    disc_manufacturer: body.disc_manufacturer ? String(body.disc_manufacturer) : null,
    disc_type: body.disc_type ? String(body.disc_type) : null,
    disc_plastic: body.disc_plastic ? String(body.disc_plastic) : null,
    disc_color: body.disc_color ? String(body.disc_color) : null,
    disc_weight: toNumberOrNull(body.disc_weight),
    disc_condition: body.disc_condition ? String(body.disc_condition) : null,
    status: body.status === 'sold' ? 'sold' : 'available',
    visibility: body.visibility === 'shared' ? 'shared' : 'private',
    seller_name: body.seller_name ? String(body.seller_name) : null,
  }
}

export function registerForSaleRoutes(app: FastifyInstance): void {
  // Friends marketplace — must be registered as a sibling of the CRUD routes.
  // Fastify prefers the static /forsale/shared over the parametric /forsale/:id.
  app.get('/forsale/shared', async () => {
    const pool = await getPool()
    const result = await pool
      .request()
      .input('visibility', sql.NVarChar, 'shared')
      .query(
        `SELECT * FROM forsale_listings WHERE visibility = @visibility ORDER BY listed_at DESC`
      )
    return result.recordset.map((r) => fromRow(r as Row))
  })

  registerCrud(app, {
    route: 'forsale',
    table: 'forsale_listings',
    orderBy: 'listed_at DESC',
    immutable: ['listed_at'],
    fromRow,
    toRow,
  })
}
