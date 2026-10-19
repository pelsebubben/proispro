// collections — mirrors ClientCollection { id, name, description }.
import { FastifyInstance } from 'fastify'
import { registerCrud, Row } from './crud'

function fromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
  }
}

function toRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    name: String(body.name ?? ''),
    description: body.description ? String(body.description) : null,
  }
}

export function registerCollectionRoutes(app: FastifyInstance): void {
  registerCrud(app, {
    route: 'collections',
    table: 'collections',
    orderBy: 'created_at DESC',
    immutable: ['created_at'],
    fromRow,
    toRow,
  })
}
