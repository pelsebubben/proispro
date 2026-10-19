// bags — mirrors ClientBag { id, name, disc_ids[] }. disc_ids stored as JSON text.
import { FastifyInstance } from 'fastify'
import { registerCrud, Row } from './crud'

function parseIds(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string' && v.length > 0) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function fromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    disc_ids: parseIds(r.disc_ids),
  }
}

function toRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    name: String(body.name ?? ''),
    disc_ids: JSON.stringify(Array.isArray(body.disc_ids) ? body.disc_ids : []),
  }
}

export function registerBagRoutes(app: FastifyInstance): void {
  registerCrud(app, {
    route: 'bags',
    table: 'bags',
    orderBy: 'created_at DESC',
    immutable: ['created_at'],
    fromRow,
    toRow,
  })
}
