import { randomUUID } from 'node:crypto'
import { finished } from 'node:stream'
import { asUser } from './database.mjs'
import { normalizePhoto } from './photo.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (max = 200) => value => typeof value === 'string' && value.length <= max
const requiredText = value => text()(value) && value.trim().length > 0
const nullable = rule => value => value === null || rule(value)
const number = (min, max) => value => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const integer = (min, max) => value => Number.isInteger(value) && number(min, max)(value)
const id = value => typeof value === 'string' && uuid.test(value)
const boolean = value => typeof value === 'boolean'
const oneOf = (...values) => value => values.includes(value)
const bodyLimit = 16_384
// Room for a base64 JPEG of up to 512 KiB (~683 KiB encoded) plus ordinary disc metadata.
const photoBodyLimit = 737_280
const resources = {
  discs: { table: 'owned_discs', required: ['name'], order: 'added_at DESC', fields: {
    name: requiredText, manufacturer: text(), disc_type: nullable(text()), plastic: nullable(text()),
    weight: nullable(number(0, 300)), color: nullable(text()), condition: nullable(text()),
    speed: nullable(number(0, 20)), glide: nullable(number(0, 10)), turn: nullable(number(-10, 10)),
    fade: nullable(number(-10, 10)), notes: nullable(text(5000)), quantity: integer(1, 10000),
    tags: value => Array.isArray(value) && value.length <= 50 && value.every(text(100)),
    user_photo_url: nullable(value => text(2048)(value) && /^https:\/\//.test(value)),
    edition: text(200), photo: nullable(text(photoBodyLimit)),
  } },
  bags: { required: ['name'], fields: { name: requiredText,
    disc_ids: value => Array.isArray(value) && value.length <= 500 && value.every(id) && new Set(value).size === value.length } },
  bag_history: { readonly: true, order: 'changed_at DESC', filters: ['bag_id'], fields: {} },
  collections: { required: ['name'], order: 'created_at DESC', fields: { name: requiredText, description: text(5000) } },
  collection_discs: { required: ['collection_id', 'disc_id'], filters: ['collection_id', 'disc_id'],
    fields: { collection_id: id, disc_id: id } },
  wishlist_items: { required: ['disc_name'], order: 'priority DESC, created_at DESC', fields: {
    disc_name: requiredText, manufacturer: text(), plastic_pref: text(), weight_min: nullable(number(0, 300)),
    weight_max: nullable(number(0, 300)), priority: integer(0, 3), notes: text(5000), acquired: boolean,
  } },
  forsale_listings: { required: ['disc_id', 'disc_name'], order: 'listed_at DESC', fields: {
    disc_id: id, disc_name: requiredText, disc_manufacturer: text(), disc_type: text(), disc_plastic: text(),
    disc_color: text(), disc_weight: text(20), disc_condition: text(), status: oneOf('available', 'sold'),
  } },
  sale_tokens: { fields: { is_public: boolean } },
  course_pins: { required: ['course_name', 'bag_id'], order: 'created_at DESC',
    fields: { course_name: requiredText, course_id: nullable(text()), bag_id: id } },
  hole_assignments: { required: ['course_pin_id', 'hole_ref', 'disc_id', 'disc_name'],
    filters: ['course_pin_id', 'hole_ref'], fields: { course_pin_id: id, hole_ref: requiredText, disc_id: id, disc_name: requiredText } },
}

const tooLarge = () => Object.assign(new Error('body_too_large'), { status: 413 })
// How long the rest of a rejected upload is still read and thrown away before its connection is cut.
const discardWindowMs = 1_000

// The 413 must not wait for the sender to finish. A fast sender completes inside the window and keeps its
// connection; one that stalls or never stops is disconnected once the window closes.
function discardRemainder(req) {
  const cutOff = setTimeout(() => req.destroy(), discardWindowMs).unref()
  finished(req, error => {
    clearTimeout(cutOff)
    // Hanging up mid-upload is the client's choice; any other failure is worth a log line.
    if (error && !['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)) {
      console.error(JSON.stringify({ event: 'request_body_discard_failed', code: error.code ?? error.name }))
    }
  })
  req.resume()
}

// Bodies are capped at 16 KiB. Disc writes may read more, but only a body that carries a photo string keeps it.
export async function readBody(req, { allowPhoto = false, maxBytes = bodyLimit } = {}) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('json_required'), { status: 415 })
  const limit = allowPhoto ? photoBodyLimit : maxBytes
  const chunks = []
  let size = 0
  let overflow = false
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) { overflow = true; break }
    chunks.push(chunk)
  }
  if (overflow) {
    discardRemainder(req)
    throw tooLarge()
  }
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw size > bodyLimit ? tooLarge() : Object.assign(new Error('invalid_json'), { status: 400 }) }
  if (allowPhoto && size > bodyLimit && typeof body?.photo !== 'string') throw tooLarge()
  return body
}

export async function publicSale(pool, token, json) {
  if (!id(token)) return json(400, { error: 'invalid_token' })
  const result = await asUser(pool, '', async client => {
    await client.query("SELECT set_config('app.sale_token', $1, true)", [token])
    const found = await client.query('SELECT token FROM sale_tokens WHERE token=$1 AND is_public', [token])
    if (!found.rowCount) return null
    return (await client.query(`SELECT id, disc_name, disc_manufacturer, disc_type, disc_plastic,
      disc_color, disc_weight, disc_condition, status, listed_at FROM forsale_listings
      WHERE status='available' ORDER BY listed_at DESC`)).rows
  })
  return result === null ? json(404, { error: 'not_found' }) : json(200, { listings: result })
}

export async function featureRequest({ req, url, pool, userId, json, image }) {
  // Photo bytes are private: they only leave through this owner-scoped route, never through the inventory list.
  const photoRoute = url.pathname.match(/^\/api\/v1\/discs\/([^/]+)\/photo$/)
  if (photoRoute) {
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' })
    if (!id(photoRoute[1])) return json(400, { error: 'invalid_id' })
    const photo = await asUser(pool, userId, async client => (await client.query(
      'SELECT image FROM disc_photos WHERE user_id=$1 AND disc_id=$2', [userId, photoRoute[1]])).rows[0])
    return photo ? image(photo.image) : json(404, { error: 'not_found' })
  }
  const match = url.pathname.match(/^\/api\/v1\/([a-z_]+)(?:\/([^/]+))?$/)
  const resource = match?.[1]
  const spec = Object.hasOwn(resources, resource ?? '') ? resources[resource] : null
  if (!spec) return json(404, { error: 'not_found' })
  const rowId = match[2]
  if (rowId && !id(rowId)) return json(400, { error: 'invalid_id' })
  const table = spec.table ?? resource
  const filters = []
  for (const [key, value] of url.searchParams) {
    if (!spec.filters?.includes(key) || !(spec.fields[key] ?? id)(value)) return json(400, { error: 'invalid_filter' })
    filters.push([key, value])
  }
  if (req.method === 'GET' && !rowId) {
    const result = await asUser(pool, userId, client => client.query(
      `SELECT * FROM ${table} WHERE user_id=$1${filters.map(([key], i) => ` AND ${key}=$${i + 2}`).join('')}
       ORDER BY ${spec.order ?? 'id'}${resource === 'bag_history' ? ' LIMIT 20' : ''}`, [userId, ...filters.map(([, value]) => value)]))
    return json(200, { [resource]: result.rows })
  }
  if (spec.readonly) return json(405, { error: 'method_not_allowed' })
  if (req.method === 'DELETE' && (rowId || filters.length)) {
    const result = await asUser(pool, userId, async client => {
      if (resource === 'discs') await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,72491926))',[userId])
      const deleted = await client.query(
        `DELETE FROM ${table} WHERE user_id=$1${rowId ? ' AND id=$2' : filters.map(([key], i) => ` AND ${key}=$${i + 2}`).join('')}`,
        [userId, ...(rowId ? [rowId] : filters.map(([, value]) => value))])
      if (resource === 'discs' && deleted.rowCount) {
        await client.query('UPDATE bags SET disc_ids=disc_ids - $1::text WHERE user_id=$2 AND disc_ids ? $1', [rowId, userId])
        await client.query(`UPDATE private_plans p SET selections=(
          SELECT COALESCE(jsonb_object_agg(key,jsonb_set(value,'{disc_ids}',(value->'disc_ids')-$1::text)),'{}')
          FROM jsonb_each(p.selections)),version=version+1,updated_at=now() WHERE user_id=$2
          AND EXISTS(SELECT 1 FROM jsonb_each(p.selections) e WHERE (e.value->'disc_ids') ? $1)`, [rowId,userId])
      }
      return deleted
    })
    return json(result.rowCount ? 200 : 404, result.rowCount ? { deleted: true } : { error: 'not_found' })
  }
  if (!((req.method === 'POST' && !rowId) || (req.method === 'PATCH' && rowId))) {
    return json(405, { error: 'method_not_allowed' })
  }
  let body
  try { body = await readBody(req, { allowPhoto: resource === 'discs' }) } catch (error) { return json(error.status, { error: error.message }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.entries(body).some(([key, value]) => key === 'id' ? req.method !== 'POST' || !id(value) :
        !Object.hasOwn(spec.fields, key) || !spec.fields[key](value)) ||
      (req.method === 'POST' && spec.required?.some(key => body[key] === undefined)) ||
      (resource === 'sale_tokens' && req.method === 'POST' && Object.keys(body).length) ||
      (req.method === 'PATCH' && !Object.keys(body).length)) return json(400, { error: 'invalid_input' })
  // A photo write replaces or removes the stored image and always supersedes the legacy photo link.
  const photoWrite = resource === 'discs' && Object.hasOwn(body, 'photo')
  try {
    const photo = photoWrite && body.photo !== null ? await normalizePhoto(body.photo) : null
    const result = await asUser(pool, userId, async client => {
      if (resource === 'sale_tokens' && req.method === 'POST') {
        return client.query(`INSERT INTO sale_tokens(user_id) VALUES ($1)
          ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`, [userId])
      }
      // Snapshot references must belong to this user, even when no FK is retained.
      if (resource === 'forsale_listings' && body.disc_id) {
        const disc = await client.query('SELECT id FROM owned_discs WHERE id=$1 AND user_id=$2', [body.disc_id, userId])
        if (!disc.rowCount) throw Object.assign(new Error('invalid_reference'), { status: 400 })
      }
      let previous
      if (resource === 'bags' && rowId && body.disc_ids) {
        previous = (await client.query('SELECT disc_ids FROM bags WHERE id=$1 AND user_id=$2 FOR UPDATE', [rowId, userId])).rows[0]
      }
      if (resource === 'bags' && body.disc_ids?.length) {
        const owned = await client.query('SELECT id FROM owned_discs WHERE user_id=$1 AND id=ANY($2::uuid[])', [userId, body.disc_ids])
        if (owned.rowCount !== body.disc_ids.length) throw Object.assign(new Error('invalid_reference'), { status: 400 })
      }
      if (resource === 'course_pins') {
        if (!rowId) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,72491926))',[userId])
          const existing=await client.query(`SELECT * FROM course_pins WHERE user_id=$1 AND bag_id=$2
            AND (course_id IS NOT DISTINCT FROM $3 AND ($3::text IS NOT NULL OR lower(btrim(course_name))=lower(btrim($4)))
              OR $3::text='custom:'||id::text)
            ORDER BY created_at,id LIMIT 1`,[userId,body.bag_id,body.course_id??null,body.course_name])
          if(existing.rowCount)return existing
        }
        const previousPin = rowId ? (await client.query(
          'SELECT course_id FROM course_pins WHERE id=$1 AND user_id=$2 FOR UPDATE', [rowId, userId])).rows[0] : null
        const sourceId = Object.hasOwn(body, 'course_id') ? body.course_id : previousPin?.course_id
        if (sourceId?.startsWith('pdga:')) {
          if (!/^pdga:[1-9][0-9]{0,15}$/.test(sourceId)) throw Object.assign(new Error('invalid_input'), { status: 400 })
          body.course_name = 'PDGA course'
        }
        if (previousPin && Object.hasOwn(body,'course_id') && body.course_id !== previousPin.course_id &&
            (await client.query('SELECT id FROM private_plans WHERE course_pin_id=$1',[rowId])).rowCount) {
          throw Object.assign(new Error('unlink_plan_before_changing_course'),{status:400})
        }
      }
      const entries = Object.entries(body).filter(([key]) => !(photoWrite && ['photo', 'user_photo_url'].includes(key)))
      if (photoWrite) entries.push(['photo_version', photo ? randomUUID() : null], ['user_photo_url', null])
      const values = entries.map(([, value]) => Array.isArray(value) ? JSON.stringify(value) : value)
      const result = rowId
        ? await client.query(`UPDATE ${table} SET ${entries.map(([key], i) => `${key}=$${i + 1}`).join(',')}
            WHERE user_id=$${values.length + 1} AND id=$${values.length + 2} RETURNING *`, [...values, userId, rowId])
        : await client.query(`INSERT INTO ${table} (${[...entries.map(([key]) => key), 'user_id'].join(',')})
            VALUES (${[...values, userId].map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, [...values, userId])
      if (photoWrite && result.rowCount) {
        const discId = result.rows[0].id
        if (photo) {
          await client.query(`INSERT INTO disc_photos (disc_id, user_id, image) VALUES ($1,$2,$3)
            ON CONFLICT (disc_id) DO UPDATE SET image=EXCLUDED.image`, [discId, userId, photo])
        } else await client.query('DELETE FROM disc_photos WHERE disc_id=$1 AND user_id=$2', [discId, userId])
      }
      if (previous && result.rowCount) {
        for (const discId of new Set([...previous.disc_ids, ...body.disc_ids])) {
          const added = body.disc_ids.includes(discId)
          if (added === previous.disc_ids.includes(discId)) continue
          await client.query(`INSERT INTO bag_history(user_id,bag_id,disc_id,disc_name,action)
            VALUES ($1,$2,$3,COALESCE((SELECT name FROM owned_discs WHERE id=$3), 'Deleted disc'),$4)`,
          [userId, rowId, discId, added ? 'added' : 'removed'])
        }
      }
      return result
    })
    return result.rowCount ? json(rowId ? 200 : 201, result.rows[0]) : json(404, { error: 'not_found' })
  } catch (error) {
    if (error.status === 400 || error.status === 413 || ['23503', '23505', '23514', '23502'].includes(error.code)) {
      return json(error.status ?? 400, { error: error.status ? error.message : 'invalid_input' })
    }
    throw error
  }
}
