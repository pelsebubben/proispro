import { asUser } from './database.mjs'
import { readBody } from './features.mjs'

const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const text = (value,max) => typeof value === 'string' && value.length <= max
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (status,error) => { throw Object.assign(new Error(error),{status}) }
const keyFor = pin => pin.course_id ?? `custom:${pin.id}`
const exact = (body,keys) => object(body) && Object.keys(body).every(k=>keys.includes(k))

export function validateLayout(body) {
  if (!exact(body,['course_pin_id','version','name','tee','basket','description','checked_on','holes']) ||
      !id(body.course_pin_id) || !text(body.name,100) || !body.name.trim() ||
      !text(body.tee,100) || !text(body.basket,100) || !text(body.description,1000) ||
      !(body.checked_on === null || (typeof body.checked_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.checked_on) &&
        Number.isFinite(Date.parse(body.checked_on)) && new Date(body.checked_on).toISOString().slice(0,10) === body.checked_on)) ||
      !Array.isArray(body.holes) || body.holes.length>72 ||
      body.holes.some(h=>!exact(h,['id','label','par','distance_m','notes']) || !id(h.id) ||
        !text(h.label,40) || !h.label.trim() || !text(h.notes,500) ||
        !(h.par===null || Number.isInteger(h.par) && h.par>=1 && h.par<=15) ||
        !(h.distance_m===null || typeof h.distance_m==='number' && Number.isFinite(h.distance_m) && h.distance_m>0 && h.distance_m<=3000)) ||
      new Set(body.holes.map(h=>h.id)).size !== body.holes.length) fail(400,'invalid_layout')
}

export async function plannerRequest({req,url,pool,userId,json}) {
  const match = url.pathname.match(/^\/api\/v1\/planner\/(layouts|pins)\/([0-9a-f-]+)$/i)
  const overview = url.pathname === '/api/v1/planner'
  if ((!match && !overview) || (match && !id(match[2]))) return json(400,{error:'invalid_planner_request'})
  try {
    let body
    if (req.method === 'PUT' || req.method === 'POST') body = await readBody(req,{maxBytes:262144})
    const result = await asUser(pool,userId,async client=>{
      if (req.method!=='GET') await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,72491926))',[userId])
      if (overview && req.method === 'GET') {
        if (!url.search) {
          const summaries=(await client.query(`SELECT p.course_pin_id,l.name AS layout_name,
            jsonb_array_length(l.holes) AS hole_count,
            (SELECT count(*)::int FROM jsonb_each(p.selections) s WHERE jsonb_array_length(s.value->'disc_ids')>0) AS planned_count
            FROM private_plans p JOIN private_layouts l ON l.id=p.layout_id`)).rows
          return {status:200,body:{summaries}}
        }
        if ([...url.searchParams.keys()].some(k=>k!=='pin_id') || !id(url.searchParams.get('pin_id'))) fail(400,'invalid_pin')
        const pin = (await client.query('SELECT * FROM course_pins WHERE id=$1',[url.searchParams.get('pin_id')])).rows[0]
        if (!pin) fail(404,'pin_not_found')
        const layouts = (await client.query('SELECT * FROM private_layouts WHERE course_key=$1 ORDER BY lower(name),id',[keyFor(pin)])).rows
        const plan = (await client.query('SELECT * FROM private_plans WHERE course_pin_id=$1',[pin.id])).rows[0] ?? null
        return {status:200,body:{layouts,plan}}
      }
      if (overview && req.method === 'POST' || match?.[1]==='layouts' && req.method==='PUT') {
        if (url.search) fail(400,'invalid_query')
        validateLayout(body)
        const pin = (await client.query('SELECT * FROM course_pins WHERE id=$1 FOR UPDATE',[body.course_pin_id])).rows[0]
        if (!pin) fail(404,'pin_not_found')
        if (!match) {
          const count = (await client.query('SELECT count(*)::int AS n FROM private_layouts WHERE user_id=$1',[userId])).rows[0].n
          if (count>=200) fail(400,'layout_limit_reached')
          const layout = (await client.query(`INSERT INTO private_layouts(user_id,course_key,name,tee,basket,description,checked_on,holes)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[userId,keyFor(pin),body.name.trim(),body.tee,body.basket,
            body.description,body.checked_on,JSON.stringify(body.holes)])).rows[0]
          return {status:201,body:{layout}}
        }
        const previous = (await client.query('SELECT * FROM private_layouts WHERE id=$1 FOR UPDATE',[match[2]])).rows[0]
        if (!previous || previous.course_key !== keyFor(pin)) fail(404,'layout_not_found')
        if (body.version !== previous.version) fail(409,'layout_changed_reload')
        const layout = (await client.query(`UPDATE private_layouts SET name=$2,tee=$3,basket=$4,description=$5,
          checked_on=$6,holes=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[previous.id,
          body.name.trim(),body.tee,body.basket,body.description,body.checked_on,JSON.stringify(body.holes)])).rows[0]
        // Hole IDs, not displayed numbers, retain choices through reorder; removed holes lose only their own choices.
        await client.query(`UPDATE private_plans p SET selections=(
          SELECT COALESCE(jsonb_object_agg(key,value),'{}') FROM jsonb_each(p.selections)
          WHERE key=ANY($2::text[])),version=version+1,updated_at=now() WHERE layout_id=$1`,[layout.id,body.holes.map(h=>h.id)])
        return {status:200,body:{layout}}
      }
      if (match?.[1]==='pins' && req.method==='PUT') {
        if (url.search || !exact(body,['layout_id','version','selections']) || !id(body.layout_id) || !object(body.selections)) fail(400,'invalid_plan')
        const pin = (await client.query('SELECT * FROM course_pins WHERE id=$1 FOR UPDATE',[match[2]])).rows[0]
        if (!pin) fail(404,'pin_not_found')
        const layout = (await client.query('SELECT * FROM private_layouts WHERE id=$1 FOR UPDATE',[body.layout_id])).rows[0]
        if (!layout || layout.course_key !== keyFor(pin)) fail(400,'invalid_layout_reference')
        const previous = (await client.query('SELECT * FROM private_plans WHERE course_pin_id=$1 FOR UPDATE',[pin.id])).rows[0]
        if (body.version !== (previous?.version ?? 0)) fail(409,'plan_changed_reload')
        const holeIds = new Set(layout.holes.map(h=>h.id))
        const discIds = new Set()
        for (const [holeId,value] of Object.entries(body.selections)) {
          if (!holeIds.has(holeId) || !exact(value,['disc_ids','notes']) || !text(value.notes,1000) ||
              !Array.isArray(value.disc_ids) || value.disc_ids.length>12 || !value.disc_ids.every(id) ||
              new Set(value.disc_ids).size!==value.disc_ids.length) fail(400,'invalid_hole_plan')
          value.disc_ids.forEach(d=>discIds.add(d))
        }
        if (discIds.size && (await client.query('SELECT id FROM owned_discs WHERE id=ANY($1::uuid[]) FOR SHARE',[Array.from(discIds)])).rowCount !== discIds.size) fail(400,'disc_not_owned')
        const plan = (await client.query(`INSERT INTO private_plans(user_id,course_pin_id,layout_id,selections)
          VALUES($1,$2,$3,$4) ON CONFLICT(course_pin_id) DO UPDATE SET layout_id=EXCLUDED.layout_id,
          selections=EXCLUDED.selections,version=private_plans.version+1,updated_at=now() RETURNING *`,
        [userId,pin.id,layout.id,JSON.stringify(body.selections)])).rows[0]
        return {status:200,body:{plan}}
      }
      if (match?.[1]==='pins' && req.method==='DELETE' && !url.search) {
        const result = await client.query('DELETE FROM private_plans WHERE course_pin_id=$1',[match[2]])
        return {status:result.rowCount?200:404,body:result.rowCount?{deleted:true}:{error:'plan_not_found'}}
      }
      if (match?.[1]==='layouts' && req.method==='DELETE' && !url.search) {
        const found=await client.query('SELECT id FROM private_layouts WHERE id=$1 FOR UPDATE',[match[2]])
        if(!found.rowCount)fail(404,'layout_not_found')
        if((await client.query('SELECT id FROM private_plans WHERE layout_id=$1',[match[2]])).rowCount)fail(409,'layout_in_use_unlink_game_plans_first')
        await client.query('DELETE FROM private_layouts WHERE id=$1',[match[2]])
        return {status:200,body:{deleted:true}}
      }
      fail(405,'method_not_allowed')
    })
    return json(result.status,result.body)
  } catch(error) {
    if ([400,404,405,409,413,415].includes(error.status)) return json(error.status,{error:error.message})
    throw error
  }
}
