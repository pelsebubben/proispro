import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import pg from 'pg'
import { createPool } from '../../server/database.mjs'
import { migrate } from '../../server/migrate.mjs'
import { createPdgaService, pdgaCacheMs } from '../../server/pdga-service.mjs'
import { courseRequest } from '../../server/courses.mjs'
import { plannerRequest } from '../../server/planner.mjs'

test('PDGA SQL cache survives replicas, expires, isolates exact event holes and preserves private plans without retaining provider facts', async t => {
  const admin = createPool()
  let owner
  const services = []
  t.after(async()=>{
    for(const service of services)service.close()
    try {
      if(owner){
        await admin.query('DELETE FROM private_plans WHERE user_id=$1',[owner])
        await admin.query('DELETE FROM private_layouts WHERE user_id=$1',[owner])
        await admin.query('DELETE FROM course_pins WHERE user_id=$1',[owner])
        await admin.query('DELETE FROM bags WHERE user_id=$1',[owner])
        await admin.query('DELETE FROM owned_discs WHERE user_id=$1',[owner])
        await admin.query('DELETE FROM app_users WHERE id=$1',[owner])
      }
    } finally { await admin.end() }
  })
  await migrate(admin,process.env.PGAPP_PASSWORD,'griplock_pdga_test_app')
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='course_catalog'")).rows[0].n,0)
  const pool=createPool({...process.env,PGUSER:'griplock_pdga_test_app',PGPASSWORD:process.env.PGAPP_PASSWORD})
  t.after(()=>pool.end())
  await pool.query('DELETE FROM provider_cache.entries')
  await pool.query("UPDATE provider_cache.control SET blocked_until=now(),requests=0,window_start=now()")
  const calls=[]
  let rateLimited=false
  let gate=null
  const row={layoutId:11,courseId:27416,tournId:99,name:'Fixture event layout',holes:2,par:7,length:200,units:'Feet',
    liveTournament:{tournamentName:'Fixture event',startDate:'2026-01-02T00:00:00Z'}}
  const fetcher=async(url,options)=>{
    calls.push(url)
    assert.equal(options.redirect,'error')
    if(gate)await gate
    if(url.endsWith('/login'))return Response.json({session_name:'SSESS_fixture',sessid:'fixture',token:'fixture'})
    if(url.endsWith('/logout'))return Response.json(true)
    if(url.includes('/api/fixture-index')){
      if(rateLimited)return new Response('PRIVATE',{status:429,headers:{'Retry-After':'600'}})
      assert.equal(new URL(url).searchParams.get('courseId'),'27416','use node ID, never the legacy REST ID')
      const event=(tournId,layoutId,startDate)=>({...row,tournId,layoutId,
        liveTournament:{tournamentName:`Event ${tournId}`,startDate}})
      return Response.json([row,event(101,22,'9-May-2026'),event(100,15,'25-May-2026'),
        event(999,3,'28-Sep-2019'),event(100,13,'25-May-2026'),event(100,14,'25-May-2026')])
    }
    if(url.includes('/api/fixture-overview'))return Response.json({tournId:99,players:[{private:'NEVER_STORE'}],
      liveLayouts:[{...row,courseId:999,layoutId:12,liveLayoutDetails:[]},
        {...row,liveLayoutDetails:[
          {layoutDetailId:102,layoutId:11,holeOrdinal:2,label:'2A',par:4,length:150,tee:'Long',target:'Basket',notes:'OB fixture'},
          {layoutDetailId:101,layoutId:11,holeOrdinal:1,label:'1',par:3,length:50,tee:'Short',target:null,notes:null},
        ]}]})
    return Response.json({courses:[{course_id:'4550',course_node_nid:'27415',course_name:'Wrong neighbour',country:'Norway'},
      {course_id:'4551',course_node_nid:'27416',course_name:'Ekeberg fixture',country:'Norway',holes:'18'}]})
  }
  const logs=[]
  const options={username:'fixture',password:'synthetic-only',pool,fetcher,logger:e=>logs.push(e),
    indexTemplate:'https://www.pdga.com/api/fixture-index?courseId={courseId}',
    overviewTemplate:'https://www.pdga.com/api/fixture-overview/{tournId}'}
  const create=()=>{const service=createPdgaService(options);services.push(service);return service}
  const first=create()
  const course=await first.course('pdga:4551')
  assert.equal(course.value.name,'Ekeberg fixture')
  assert.ok(Math.abs(course.expiresAt-Date.now()-pdgaCacheMs)<1000)
  const second=create()
  assert.deepEqual(await second.course('pdga:4551'),course,'another replica reads the persisted SQL cache')
  assert.equal(calls.length,3)
  const legacyKey=createHash('sha256').update('layouts:pdga:4551').digest('hex')
  await pool.query('INSERT INTO provider_cache.entries(key,value,expires_at) VALUES($1,$2,$3)',
    [legacyKey,JSON.stringify([{layout_id:'11',tournament_id:'99',event_date:'25-May-202'}]),new Date(Date.now()+pdgaCacheMs)])
  const index=await second.layouts('pdga:4551')
  assert.deepEqual(index.value.map(l=>l.layout_id),['13','14','15','22','11','3'],
    'refresh the versioned index instead of reusing previously truncated dates')
  const indexCalls=calls.length
  const browsed=await courseRequest({req:{method:'GET'},url:new URL('http://localhost/api/v1/courses/pdga:4551/layouts'),
    pdga:first,json:(status,value)=>({status,value})})
  assert.equal(browsed.status,200)
  assert.equal(browsed.value.expiresAt,index.expiresAt)
  assert.deepEqual(browsed.value.layouts.map(l=>`${l.tournament_id}:${l.layout_id}`),
    ['100:13','100:14','100:15','101:22'])
  assert.equal(calls.length,indexCalls,'browsing sorts and limits the shared cached index without provider calls')
  const detail=await first.layout('pdga:4551','99','11')
  assert.equal(detail.value.tournament_id,'99','older saved references remain resolvable outside the latest two events')
  assert.equal(detail.value.holes.length,2)
  assert.equal(detail.value.holes[0].label,'1')
  assert.equal(detail.value.holes[0].distance_m,15.24)
  assert.equal(detail.value.holes[1].tee,'Long')
  assert.equal(detail.value.holes[1].notes,'OB fixture')
  await assert.rejects(first.layout('pdga:4551','99','12'),{code:'layout_not_found'})
  const count=calls.length
  assert.deepEqual(await second.layout('pdga:4551','99','11'),detail)
  assert.equal(calls.length,count,'viewing the same layout must make zero provider requests')
  const values=(await pool.query('SELECT value FROM provider_cache.entries')).rows
  assert.ok(!JSON.stringify(values).includes('NEVER_STORE'))
  assert.ok(!JSON.stringify(values).includes('Wrong neighbour'))
  owner=(await admin.query("INSERT INTO app_users(issuer,subject) VALUES('pdga-fixture',$1) RETURNING id",[randomUUID()])).rows[0].id
  const bag=(await admin.query("INSERT INTO bags(user_id,name) VALUES($1,'Fixture bag') RETURNING id",[owner])).rows[0].id
  const pin=(await admin.query(`INSERT INTO course_pins(user_id,bag_id,course_name,course_id)
    VALUES($1,$2,'PDGA course','pdga:4551') RETURNING id`,[owner,bag])).rows[0].id
  const disc=(await admin.query("INSERT INTO owned_discs(user_id,name) VALUES($1,'Fixture disc') RETURNING id",[owner])).rows[0].id
  const plannerPool=new pg.Pool({...pool.options,password:process.env.PGAPP_PASSWORD,max:1})
  t.after(()=>plannerPool.end())
  const plannerPdga=createPdgaService({...options,pool:plannerPool})
  services.push(plannerPdga)
  const request=async(path,method='GET',body,userId=owner)=>{
    const req=Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),
      {method,headers:{'content-type':'application/json'}})
    return plannerRequest({req,url:new URL(path,'http://localhost'),pool:plannerPool,userId,pdga:plannerPdga,
      json:(status,value)=>({status,value})})
  }
  const chosen=await request('/api/v1/planner/event-layout','POST',{course_pin_id:pin,tournament_id:'99',layout_id:'11'})
  assert.equal(chosen.status,201,'provider planning must work even with one available database connection')
  const layoutId=chosen.value.layout.id
  const holes=chosen.value.layout.holes
  const selections={[holes[0].id]:{disc_ids:[disc],notes:'My own strategy'}}
  assert.equal((await request(`/api/v1/planner/pins/${pin}`,'PUT',{layout_id:layoutId,version:0,selections})).status,200)
  const persisted=(await admin.query('SELECT name,holes,provider_ref FROM private_layouts WHERE id=$1',[layoutId])).rows[0]
  assert.equal(persisted.name,'PDGA event layout')
  assert.deepEqual(persisted.holes,[])
  assert.deepEqual(persisted.provider_ref,{course_id:'pdga:4551',tournament_id:'99',layout_id:'11'})
  assert.ok(!JSON.stringify(persisted).includes('OB fixture'))
  for(const invalid of [
    {...persisted.provider_ref,layout_id:null},
    {...persisted.provider_ref,tournament_id:99},
    {...persisted.provider_ref,course_id:'pdga:4550'},
    {...persisted.provider_ref,notes:'Provider facts must not persist here'},
  ])await assert.rejects(admin.query('UPDATE private_layouts SET provider_ref=$2 WHERE id=$1',[layoutId,JSON.stringify(invalid)]),{code:'23514'})
  const reloaded=await request(`/api/v1/planner?pin_id=${pin}`)
  assert.equal(reloaded.value.layouts[0].holes[0].id,holes[0].id)
  assert.deepEqual(reloaded.value.plan.selections,selections)
  const duplicateBody={course_pin_id:pin,layout_id:layoutId,name:'My everyday Ekeberg plan',version:1}
  assert.equal((await request('/api/v1/planner/duplicate','POST',{...duplicateBody,name:' '})).status,400)
  assert.equal((await request('/api/v1/planner/duplicate','POST',{...duplicateBody,holes})).status,400)
  assert.equal((await request('/api/v1/planner/duplicate','POST',{...duplicateBody,layout_id:randomUUID()})).status,404)
  assert.equal((await request('/api/v1/planner/duplicate','POST',{...duplicateBody,version:0})).status,409)
  assert.equal((await request('/api/v1/planner/duplicate','POST',duplicateBody,randomUUID())).status,404)
  const anotherPin=(await admin.query(`INSERT INTO course_pins(user_id,bag_id,course_name,course_id)
    VALUES($1,$2,'PDGA course','pdga:4550') RETURNING id`,[owner,bag])).rows[0].id
  assert.equal((await request('/api/v1/planner/duplicate','POST',{...duplicateBody,course_pin_id:anotherPin})).status,404)
  const copied=await request('/api/v1/planner/duplicate','POST',duplicateBody)
  assert.equal(copied.status,201)
  assert.notEqual(copied.value.layout.id,layoutId)
  assert.equal(copied.value.layout.private_name,duplicateBody.name)
  assert.deepEqual(copied.value.layout.holes,[],'duplicate stores no permanent provider facts')
  assert.deepEqual(copied.value.layout.provider_ref,persisted.provider_ref)
  assert.deepEqual(copied.value.plan.selections,selections)
  assert.equal(copied.value.plan.version,2)
  assert.equal((await request('/api/v1/planner/event-layout','POST',{course_pin_id:pin,tournament_id:'99',layout_id:'11'})).value.layout.id,layoutId,
    'browsing the source never reuses a named private copy')
  const copyId=copied.value.layout.id
  const ownChanges={[holes[0].id]:{disc_ids:[disc],notes:'Independent recreational strategy'}}
  assert.equal((await request(`/api/v1/planner/pins/${pin}`,'PUT',{layout_id:copyId,version:2,selections:ownChanges})).status,200)
  const original=await request(`/api/v1/planner?pin_id=${pin}&layout_id=${layoutId}`)
  assert.deepEqual(original.value.selected_plan.selections,selections,'source choices survive changing the copy')
  const copyView=await request(`/api/v1/planner?pin_id=${pin}`)
  assert.equal(copyView.value.layouts.find(l=>l.id===copyId).name,duplicateBody.name)
  assert.deepEqual(copyView.value.plan.selections,ownChanges)
  assert.equal((await request(`/api/v1/planner/pins/${pin}`,'PUT',{layout_id:layoutId,version:3,selections})).status,200)
  const restoredCopy=await request(`/api/v1/planner?pin_id=${pin}&layout_id=${copyId}`)
  assert.deepEqual(restoredCopy.value.selected_plan.selections,ownChanges,'switching layouts retains each private game plan')
  assert.equal((await request('/api/v1/planner/duplicate','POST',duplicateBody)).status,409,'old active-plan versions cannot be replayed')
  const api=path=>courseRequest({req:{method:'GET'},url:new URL(path,'http://localhost'),pdga:first,
    json:(status,value)=>({status,value})})
  assert.equal((await api('/api/v1/courses/export')).status,404)
  assert.equal((await api('/api/v1/courses/osm:way:1/holes')).status,404)
  await pool.query("UPDATE provider_cache.entries SET expires_at=now()-interval '1 second'")
  rateLimited=true
  await assert.rejects(first.layouts('pdga:4551'),{code:'pdga_rate_limited'})
  const failedCount=calls.length
  await assert.rejects(second.layouts('pdga:4551'),{code:'pdga_rate_limited'})
  assert.equal(calls.length,failedCount,'provider cooldown applies across replicas, without another upstream call')
  const unavailable=await request(`/api/v1/planner?pin_id=${pin}`)
  assert.ok(unavailable.value.layouts.find(l=>l.id===layoutId).provider_error)
  assert.equal(unavailable.value.layouts.find(l=>l.id===layoutId).name,'PDGA event layout')
  assert.deepEqual(unavailable.value.plan.selections,selections)
  const duringOutage=await request('/api/v1/planner/duplicate','POST',{...duplicateBody,name:'Rate-limit-safe private plan',version:4})
  assert.equal(duringOutage.status,201,'copying saved user choices and IDs needs no provider access')
  assert.deepEqual(duringOutage.value.layout.holes,[])
  assert.equal(calls.length,failedCount)
  const outageView=await request(`/api/v1/planner?pin_id=${pin}`)
  const namedOutage=outageView.value.layouts.find(l=>l.id===duringOutage.value.layout.id)
  assert.equal(namedOutage.name,'Rate-limit-safe private plan')
  assert.deepEqual(namedOutage.holes,[])
  assert.ok(namedOutage.provider_error)
  assert.deepEqual(outageView.value.plan.selections,selections)
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'))
  assert.ok(logs.some(l=>l.httpStatus===429))
  await pool.query("UPDATE provider_cache.control SET blocked_until=now(),requests=0")
  rateLimited=false
  await pool.query('DELETE FROM provider_cache.entries')
  let release
  gate=new Promise(resolve=>{release=resolve})
  const pending=first.course('pdga:4551')
  const same=first.course('pdga:4551')
  await new Promise(resolve=>setTimeout(resolve,100))
  await assert.rejects(second.course('pdga:4551'),{code:'pdga_busy'})
  release();gate=null
  assert.deepEqual(await pending,await same)
})
