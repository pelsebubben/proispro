import assert from 'node:assert/strict'
import test from 'node:test'
import { searchPdga, readPdgaCourse } from '../../server/pdga-client.mjs'
import { layoutConfiguration, readEventLayouts, readEventLayout } from '../../server/pdga-layouts.mjs'
import { createPdgaService, pdgaCacheMs } from '../../server/pdga-service.mjs'
import { courseRequest } from '../../server/courses.mjs'

const credentials={username:'fixture',password:'synthetic-only'}
const record={course_id:'4551',course_node_nid:'27416',course_name:'Ekeberg fixture',country:'Norway',holes:'18'}
test('REST lookup selects exact legacy identity and discards neighbours and contact data',async()=>{
  const calls=[]
  const fetcher=async(url,options)=>{
    calls.push(new URL(url))
    assert.equal(options.redirect,'error')
    if(url.endsWith('/login'))return Response.json({session_name:'SSESS_fixture',sessid:'fixture',token:'fixture'})
    if(url.endsWith('/logout'))return Response.json(true)
    return Response.json({courses:[{...record,course_id:'4550',course_node_nid:'27415',course_name:'Wrong neighbour'},
      {...record,contact_email:'PRIVATE'}]})
  }
  const course=await readPdgaCourse(credentials,'pdga:4551',fetcher)
  assert.equal(course.source_url,'https://www.pdga.com/node/27416')
  assert.equal(course.name,'Ekeberg fixture')
  assert.equal(calls[1].searchParams.get('course_id'),'4551')
  assert.equal(calls[1].searchParams.get('limit'),'30')
  assert.ok(!JSON.stringify(course).includes('PRIVATE'))
  assert.throws(()=>searchPdga(credentials,''),/Invalid PDGA search/)
  assert.throws(()=>readPdgaCourse(credentials,'invalid'),/Invalid PDGA course/)
  assert.equal(pdgaCacheMs,86400000)
  assert.equal(createPdgaService(),null)
  assert.throws(()=>createPdgaService({username:'one'}),/Both PDGA/)
})

test('event layouts use the canonical node identity, match course and layout, and normalize bounded hole fields',async()=>{
  const config=layoutConfiguration('https://www.pdga.com/api/fixture?courseId={courseId}',
    'https://www.pdga.com/api/fixture/{tournId}')
  for(const bad of ['http://www.pdga.com/api/{courseId}','https://evil.invalid/api/{courseId}',
    'https://user:pass@www.pdga.com/api/{courseId}','https://www.pdga.com/not-api/{courseId}']){
    assert.throws(()=>layoutConfiguration(bad,config.overview))
  }
  const row={courseId:27416,layoutId:11,tournId:99,name:'Fixture',holes:1,par:3,length:100,units:'Feet',
    liveTournament:{tournamentName:'Fixture event',startDate:'2026-01-02'}}
  let calls=0
  const index=await readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},async url=>{
    calls++;assert.equal(new URL(url).searchParams.get('courseId'),'27416');return Response.json([row])
  })
  const detail={layoutDetailId:1,layoutId:11,holeOrdinal:1,label:'1A',par:3,length:100,tee:'Short',target:'Basket',notes:'OB fixture'}
  const payload={tournId:99,liveLayouts:[{...row,courseId:999,layoutId:12,liveLayoutDetails:[]},{...row,liveLayoutDetails:[detail]}]}
  const layout=await readEventLayout(config,index[0],async()=>Response.json(payload))
  assert.equal(layout.holes[0].distance_m,30.48)
  assert.equal(layout.holes[0].tee,'Short')
  assert.equal(layout.holes[0].notes,'OB fixture')
  assert.match(layout.holes[0].id,/^[0-9a-f-]{36}$/)
  assert.deepEqual((await readEventLayout(config,index[0],async()=>Response.json(payload))).holes,layout.holes)
  await assert.rejects(readEventLayout(config,{...index[0],layout_id:'12'},async()=>Response.json(payload)))
  await assert.rejects(readEventLayout(config,index[0],async()=>Response.json({...payload,tournId:100})))
  await assert.rejects(readEventLayout(config,index[0],async()=>Response.json({tournId:99,liveLayouts:[row]})))
  await assert.rejects(readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},async()=>Response.json([{...row,courseId:4551}])))
  await assert.rejects(readEventLayout(config,index[0],async()=>Response.json({tournId:99,
    liveLayouts:[{...row,liveLayoutDetails:[{...detail,par:999}]}]})))
  assert.equal(calls,1)
})

test('provider-only routes reject retired exports, bad queries and disabled access explicitly',async()=>{
  const call=(path,method='GET')=>courseRequest({req:{method},url:new URL(path,'http://localhost'),
    json:(status,body)=>({status,body})})
  assert.equal((await call('/api/v1/courses/export')).status,404)
  assert.equal((await call('/api/v1/courses?q=Ekeberg')).body.error,'pdga_not_configured')
  assert.equal((await call('/api/v1/courses?country=NO')).status,400)
  assert.equal((await call('/api/v1/courses','POST')).status,405)
})

test('browsing sorts actual dates before choosing two distinct events and retains every applicable layout',async()=>{
  const config=layoutConfiguration('https://www.pdga.com/api/fixture?courseId={courseId}',
    'https://www.pdga.com/api/fixture/{tournId}')
  const row={courseId:27416,name:'Same layout name',holes:1,par:3,length:100,units:'Meters'}
  const event=(tournId,layoutId,startDate)=>({...row,tournId,layoutId,
    liveTournament:{tournamentName:`Event ${tournId}`,startDate}})
  const rows=[event(999,1,'28-Sep-2019'),event(200,22,'9-May-2024'),
    event(100,13,'25-May-2024'),event(100,11,'25-May-2024'),
    event(800,2,'2023-05-14'),event(100,12,'25-May-2024'),event(900,3,null)]
  const full=await readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},
    async()=>Response.json(rows))
  assert.equal(full.length,7,'keep the full index for existing saved provider references')
  assert.deepEqual(full.map(l=>l.event_date),
    ['2024-05-25','2024-05-25','2024-05-25','2024-05-09','2023-05-14','2019-09-28',null])
  const call=layouts=>courseRequest({req:{method:'GET'},url:new URL('http://localhost/api/v1/courses/pdga:4551/layouts'),
    pdga:{layouts:async id=>{assert.equal(id,'pdga:4551');return {value:layouts,expiresAt:123}}},
    json:(status,body)=>({status,body})})
  const response=await call([...full].reverse())
  assert.equal(response.status,200)
  assert.equal(response.body.expiresAt,123)
  assert.deepEqual(response.body.layouts.map(l=>`${l.tournament_id}:${l.layout_id}`),
    ['100:11','100:12','100:13','200:22'],'cached indexes are sorted before limiting distinct events')
  assert.deepEqual((await call([])).body.layouts,[])
  assert.deepEqual((await call(full.filter(l=>l.tournament_id==='100'))).body.layouts.map(l=>l.layout_id),['11','12','13'])
  const unknown=full.filter(l=>l.event_date===null)
  assert.deepEqual((await call([unknown[0],full[3]])).body.layouts.map(l=>l.tournament_id),['200','900'])
  assert.deepEqual((await call([{...full[0],tournament_id:'2'},{...full[0],tournament_id:'10'},
    {...full[0],tournament_id:'1'}])).body.layouts.map(l=>l.tournament_id),['10','2'],
    'same-day events have a deterministic numeric identity tie-break, not provider response order')
  assert.deepEqual((await call([{...unknown[0],tournament_id:'2'},{...unknown[0],tournament_id:'10'},
    {...unknown[0],tournament_id:'1'}])).body.layouts.map(l=>l.tournament_id),['10','2'])
  const timestamped=await readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},
    async()=>Response.json([event(1,1,'2026-01-02T00:00:00+02:00')]))
  assert.equal(timestamped[0].event_date,'2026-01-02','preserve the event calendar day rather than shifting to UTC')
  await assert.rejects(readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},
    async()=>Response.json([...rows,event(500,99,'not a date')])),/Invalid provider/)
  await assert.rejects(readEventLayouts(config,{source_url:'https://www.pdga.com/node/27416'},
    async()=>Response.json([{...rows[0],courseId:27415},...rows])),/Invalid provider/,
    'a different course must fail validation, never become a recent course event')
})
