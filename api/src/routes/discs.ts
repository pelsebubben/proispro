// discs — mirrors ClientDisc (utils/disc.ts). list() ordered by added_at desc.
import { FastifyInstance } from 'fastify'
import { registerCrud, Row, toNumberOrNull, numStringOrEmpty, dateToMs } from './crud'

function fromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    manufacturer: String(r.manufacturer ?? ''),
    type: String(r.disc_type ?? ''),
    plastic: String(r.plastic ?? ''),
    weight: numStringOrEmpty(r.weight),
    color: String(r.color ?? ''),
    condition: String(r.condition ?? 'good'),
    speed: r.speed == null ? '' : Number(r.speed),
    glide: r.glide == null ? '' : Number(r.glide),
    turn: r.turn == null ? '' : Number(r.turn),
    fade: r.fade == null ? '' : Number(r.fade),
    notes: String(r.notes ?? ''),
    tags: parseTags(r.tags),
    photo_url: r.user_photo_url ? String(r.user_photo_url) : null,
    added: dateToMs(r.added_at),
    quantity: r.quantity == null ? 1 : Math.max(1, Number(r.quantity)),
  }
}

function parseTags(v: unknown): string[] {
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

function toRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    name: String(body.name ?? ''),
    manufacturer: body.manufacturer ? String(body.manufacturer) : null,
    disc_type: body.type ? String(body.type) : null,
    plastic: body.plastic ? String(body.plastic) : null,
    weight: toNumberOrNull(body.weight),
    color: body.color ? String(body.color) : null,
    condition: body.condition ? String(body.condition) : null,
    speed: toNumberOrNull(body.speed),
    glide: toNumberOrNull(body.glide),
    turn: toNumberOrNull(body.turn),
    fade: toNumberOrNull(body.fade),
    notes: body.notes ? String(body.notes) : null,
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
    user_photo_url: body.photo_url ? String(body.photo_url) : null,
    quantity: body.quantity == null ? 1 : Math.max(1, Number(body.quantity)),
  }
}

export function registerDiscRoutes(app: FastifyInstance): void {
  registerCrud(app, {
    route: 'discs',
    table: 'discs',
    orderBy: 'added_at DESC',
    immutable: ['added_at'],
    fromRow,
    toRow,
  })
}
