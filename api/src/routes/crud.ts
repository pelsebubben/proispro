// Generic, parameterized CRUD route factory.
//
// Every entity exposes the same thin REST surface that mirrors the client-side
// Collection<T> contract (list / get / put / remove):
//
//   GET    /api/{route}         -> list   (WHERE ownerId = @ownerId, ORDER BY ...)
//   GET    /api/{route}/:id     -> get    (scoped)
//   PUT    /api/{route}/:id     -> upsert (ownerId from principal, id from the URL)
//   POST   /api/{route}         -> upsert (ownerId from principal, id from the body)
//   DELETE /api/{route}/:id     -> remove (scoped)
//
// SECURITY: ownerId is ALWAYS taken from request.ownerId (the verified principal),
// never from the request body. Every statement is parameterized — column names
// come from EntityConfig (our own code), values are bound via request.input().

import { FastifyInstance, FastifyRequest } from 'fastify'
import { getPool, sql } from '../db'

type Row = Record<string, unknown>

export interface EntityConfig {
  /** URL segment, e.g. 'discs' -> /api/discs */
  route: string
  /** SQL table name (trusted, from our code — never user input). */
  table: string
  /** ORDER BY clause used by list(), e.g. 'added_at DESC'. */
  orderBy: string
  /**
   * Columns written on INSERT but NOT on UPDATE (e.g. created/added timestamps
   * with DB defaults). `id` and `ownerId` are always immutable and handled
   * separately — do not list them here.
   */
  immutable?: string[]
  /** DB row -> client-shaped DTO returned to callers. */
  fromRow(row: Row): unknown
  /**
   * Client-shaped body -> DB column map. MUST set `id` and `ownerId`
   * (ownerId is passed in from the verified principal). Values only; never SQL.
   */
  toRow(body: Row, ownerId: string): Row
}

function bindInputs(request: sql.Request, row: Row): void {
  for (const [key, value] of Object.entries(row)) {
    request.input(key, value === undefined ? null : value)
  }
}

async function listRows(config: EntityConfig, ownerId: string): Promise<unknown[]> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ownerId', sql.NVarChar, ownerId)
    .query(`SELECT * FROM ${config.table} WHERE ownerId = @ownerId ORDER BY ${config.orderBy}`)
  return result.recordset.map((r) => config.fromRow(r as Row))
}

async function getRow(
  config: EntityConfig,
  ownerId: string,
  id: string
): Promise<unknown | undefined> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ownerId', sql.NVarChar, ownerId)
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM ${config.table} WHERE id = @id AND ownerId = @ownerId`)
  const found = result.recordset[0] as Row | undefined
  return found ? config.fromRow(found) : undefined
}

async function upsertRow(
  config: EntityConfig,
  ownerId: string,
  body: Row
): Promise<unknown | undefined> {
  const row = config.toRow(body, ownerId)
  // Force the scoping key to the principal regardless of what toRow/body produced.
  row.ownerId = ownerId

  const immutable = new Set(config.immutable ?? [])
  const allCols = Object.keys(row)
  const setCols = allCols.filter(
    (c) => c !== 'id' && c !== 'ownerId' && !immutable.has(c)
  )

  const pool = await getPool()
  const request = pool.request()
  bindInputs(request, row)

  const setClause = setCols.map((c) => `${c} = @${c}`).join(', ')
  const insertCols = allCols.join(', ')
  const insertVals = allCols.map((c) => `@${c}`).join(', ')

  // UPDATE-then-INSERT upsert, both scoped by ownerId. @@ROWCOUNT guards the
  // insert so an existing row owned by someone else is never overwritten.
  const updateStmt = setClause
    ? `UPDATE ${config.table} SET ${setClause} WHERE id = @id AND ownerId = @ownerId;`
    : `UPDATE ${config.table} SET id = id WHERE id = @id AND ownerId = @ownerId;`

  await request.query(
    `${updateStmt}
     IF @@ROWCOUNT = 0
       INSERT INTO ${config.table} (${insertCols}) VALUES (${insertVals});`
  )

  return getRow(config, ownerId, String(row.id))
}

async function deleteRow(config: EntityConfig, ownerId: string, id: string): Promise<number> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ownerId', sql.NVarChar, ownerId)
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM ${config.table} WHERE id = @id AND ownerId = @ownerId`)
  return result.rowsAffected[0] ?? 0
}

/** Registers the uniform CRUD routes for one entity on the given (already /api-scoped) app. */
export function registerCrud(app: FastifyInstance, config: EntityConfig): void {
  const base = `/${config.route}`

  app.get(base, async (request) => {
    return listRows(config, request.ownerId)
  })

  app.get(`${base}/:id`, async (request, reply) => {
    const { id } = request.params as { id: string }
    const item = await getRow(config, request.ownerId, id)
    if (item === undefined) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return item
  })

  app.post(base, async (request, reply) => {
    const body = (request.body ?? {}) as Row
    if (!body.id) {
      return reply.code(400).send({ error: 'missing_id', message: 'Body must include an id.' })
    }
    const saved = await upsertRow(config, request.ownerId, body)
    return reply.code(200).send(saved)
  })

  app.put(`${base}/:id`, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = { ...((request.body ?? {}) as Row), id }
    const saved = await upsertRow(config, request.ownerId, body)
    return reply.code(200).send(saved)
  })

  app.delete(`${base}/:id`, async (request, reply) => {
    const { id } = request.params as { id: string }
    const affected = await deleteRow(config, request.ownerId, id)
    if (affected === 0) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return reply.code(204).send()
  })
}

/** Small helpers shared by entity mappers. */
export function toNumberOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export function numStringOrEmpty(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

export function msToDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isNaN(n) && n > 0) return new Date(n)
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

export function dateToMs(v: unknown): number {
  if (v instanceof Date) return v.getTime()
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? Date.now() : d.getTime()
}

export type { Row, FastifyRequest }
