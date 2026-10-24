import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createPool,asUser } from '../../server/database.mjs'
import { migrate } from '../../server/migrate.mjs'
import { plannerRequest } from '../../server/planner.mjs'
import { featureRequest } from '../../server/features.mjs'

test('private planner preserves stable holes and multiple choices, rejects cross-owner and stale writes, and cascades safely',async t=>{
  const admin=createPool();t.after(()=>admin.end())
  await migrate(admin,process.env.PGAPP_PASSWORD,'griplock_planner_test_app')
  const pool=createPool({...process.env,PGUSER:'griplock_planner_test_app',PGPASSWORD:process.env.PGAPP_PASSWORD})
  t.after(()=>pool.end())
  const alice=randomUUID(),bob=randomUUID()
  await admin.query(`INSERT INTO app_users(id,issuer,subject) VALUES($1::uuid,'planner','alice-'||$1::text),($2::uuid,'planner','bob-'||$2::text)`,[alice,bob])
  const bag=(await asUser(pool,alice,c=>c.query("INSERT INTO bags(user_id,name) VALUES($1,'Planner bag') RETURNING *",[alice]))).rows[0]
  const otherBag=(await asUser(pool,bob,c=>c.query("INSERT INTO bags(user_id,name) VALUES($1,'Other bag') RETURNING *",[bob]))).rows[0]
  const pin=(await asUser(pool,alice,c=>c.query("INSERT INTO course_pins(user_id,course_name,course_id,bag_id) VALUES($1,'PDGA course','pdga:4551',$2) RETURNING *",[alice,bag.id]))).rows[0]
  const secondPin=(await asUser(pool,alice,c=>c.query("INSERT INTO course_pins(user_id,course_name,course_id,bag_id) VALUES($1,'PDGA course','pdga:4551',$2) RETURNING *",[alice,bag.id]))).rows[0]
  const otherPin=(await asUser(pool,bob,c=>c.query("INSERT INTO course_pins(user_id,course_name,course_id,bag_id) VALUES($1,'PDGA course','pdga:4551',$2) RETURNING *",[bob,otherBag.id]))).rows[0]
  const discs=(await asUser(pool,alice,c=>c.query("INSERT INTO owned_discs(user_id,name) VALUES($1,'Primary'),($1,'Alternative') RETURNING *",[alice]))).rows
  const otherDisc=(await asUser(pool,bob,c=>c.query("INSERT INTO owned_discs(user_id,name) VALUES($1,'Other disc') RETURNING *",[bob]))).rows[0]
  const request=async(path,method='GET',body,userId=alice,handler=plannerRequest)=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.headers={'content-type':'application/json'}
    let result
    await handler({req,url:new URL(`/api/v1/${path}`,'http://localhost'),pool,userId,json:(status,body)=>{result={status,body}}})
    return result
  }
  const hole1={id:randomUUID(),label:'1',par:3,distance_m:90,notes:'Own observations'}
  const hole2={id:randomUUID(),label:'2',par:null,distance_m:null,notes:''}
  const body={course_pin_id:pin.id,name:'My short tees',tee:'Short',basket:'A',description:'Independently authored',checked_on:'2026-10-25',holes:[hole1,hole2]}
  const created=await request('planner','POST',body)
  assert.equal(created.status,201)
  let layout=created.body.layout
  assert.deepEqual((await request(`planner?pin_id=${pin.id}`,'GET',undefined,bob)).status,404)
  assert.equal((await request(`planner?pin_id=${otherPin.id}`,'GET',undefined,bob)).body.layouts.length,0)
  assert.equal((await asUser(pool,bob,c=>c.query('SELECT * FROM private_layouts'))).rowCount,0)
  await assert.rejects(asUser(pool,bob,c=>c.query("INSERT INTO private_plans(user_id,course_pin_id,layout_id) VALUES($1,$2,$3)",[bob,otherPin.id,layout.id])),{code:'23503'})
  const selections={[hole1.id]:{disc_ids:discs.map(d=>d.id),notes:'Safe forehand; alternative for wind'}}
  let plan=(await request(`planner/pins/${pin.id}`,'PUT',{layout_id:layout.id,version:0,selections})).body.plan
  assert.deepEqual(plan.selections,selections)
  assert.equal((await request(`planner/pins/${pin.id}`,'PUT',{layout_id:layout.id,version:0,selections})).status,409)
  assert.equal((await request(`planner/pins/${pin.id}`,'PUT',{layout_id:layout.id,version:plan.version,selections:{[hole1.id]:{disc_ids:[otherDisc.id],notes:''}}})).status,400)
  assert.equal((await request(`planner/pins/${pin.id}`,'PUT',{layout_id:layout.id,version:plan.version,selections:{[randomUUID()]:{disc_ids:[],notes:''}}})).status,400)
  assert.equal((await request(`planner/pins/${otherPin.id}`,'PUT',{layout_id:layout.id,version:0,selections},bob)).status,400)
  // Same course, separate bag link: reuse facts without inheriting the first bag's private choices.
  const secondPlan=await request(`planner/pins/${secondPin.id}`,'PUT',{layout_id:layout.id,version:0,selections:{}})
  assert.equal(secondPlan.status,200)
  assert.deepEqual(secondPlan.body.plan.selections,{})
  assert.equal((await request(`planner/layouts/${layout.id}`,'DELETE')).status,409)
  const changed=await request(`planner/layouts/${layout.id}`,'PUT',{...body,version:layout.version,holes:[hole2,{...hole1,label:'9'}]})
  assert.equal(changed.status,200);layout=changed.body.layout
  const reloaded=(await request(`planner?pin_id=${pin.id}`)).body
  assert.deepEqual(reloaded.layouts[0].holes.map(h=>h.label),['2','9'])
  assert.deepEqual(reloaded.plan.selections,selections)
  assert.equal((await request(`planner/layouts/${layout.id}`,'PUT',{...body,version:1})).status,409)
  // A disc may be selected without changing bag membership; deleting it removes the reference.
  assert.deepEqual((await asUser(pool,alice,c=>c.query('SELECT disc_ids FROM bags WHERE id=$1',[bag.id]))).rows[0].disc_ids,[])
  assert.equal((await request(`discs/${discs[0].id}`,'DELETE',undefined,alice,featureRequest)).status,200)
  plan=(await request(`planner?pin_id=${pin.id}`)).body.plan
  assert.deepEqual(plan.selections[hole1.id].disc_ids,[discs[1].id])
  assert.equal((await request(`planner/layouts/${layout.id}`,'PUT',{...body,version:layout.version,holes:[hole2]})).status,200)
  assert.deepEqual((await request(`planner?pin_id=${pin.id}`)).body.plan.selections,{})
  assert.equal((await request('planner')).body.summaries[0].hole_count,1)
  assert.equal((await request(`course_pins/${pin.id}`,'PATCH',{course_id:'osm:node:1'},alice,featureRequest)).status,400)
  assert.equal((await request(`planner/pins/${pin.id}`,'DELETE')).status,200)
  assert.equal((await request(`planner?pin_id=${pin.id}`)).body.plan,null)
  assert.equal((await request(`bags/${bag.id}`,'DELETE',undefined,alice,featureRequest)).status,200)
  assert.equal((await asUser(pool,alice,c=>c.query('SELECT * FROM private_plans'))).rowCount,0)
  assert.equal((await asUser(pool,alice,c=>c.query('SELECT * FROM private_layouts'))).rowCount,1)
  assert.equal((await request(`planner/layouts/${layout.id}`,'DELETE',undefined,bob)).status,404)
  assert.equal((await request(`planner/layouts/${layout.id}`,'DELETE')).status,200)
})
