import {expect,test,type Page} from '@playwright/test'
import type {PrivateLayout} from '../../src/components/CoursePlanner'
const bagId='00000000-0000-4000-8000-000000000001'
const pinId='00000000-0000-4000-8000-000000000002'
const discId='00000000-0000-4000-8000-000000000003'
const secondDiscId='00000000-0000-4000-8000-000000000004'
const layoutId='00000000-0000-4000-8000-000000000005'
interface Plan {layout_id:string;version:number;selections:Record<string,{disc_ids:string[];notes:string}>}
const fixtureEvent={layout_id:'11',tournament_id:'99',name:'Fixture event layout',hole_count:1,par:3,length:85,
  units:'Meters',event_name:'Fixture event',event_date:'2026-01-02'}
async function setup(page:Page,event=false,eventLayouts=[fixtureEvent],failEvents=false,courseId='pdga:4551',
  inventory:object[]=[],bagDiscs=[discId]){
  const state:{layouts:PrivateLayout[];plan:Plan|null;plans:Record<string,Plan>;failSave:boolean;layoutBodies:object[];providerRequests:number;failEvents:boolean}={
    layouts:[],plan:null,plans:{},failSave:false,layoutBodies:[],providerRequests:0,failEvents}
  await page.addInitScript(()=>{
    sessionStorage.setItem('griplock.devAccessToken',`h.${btoa(JSON.stringify({preferred_username:'planner-fixture'}))}.s`)
  })
  await page.route('**/runtime-config.js',route=>route.fulfill({contentType:'text/javascript',
    body:'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}'}))
  await page.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname
    const method=route.request().method()
    if(path.startsWith('/api/v1/courses/')){
      state.providerRequests++
      if(path.endsWith('/layouts'))return state.failEvents?route.fulfill({status:429,json:{error:'pdga_rate_limited'}}):
        route.fulfill({json:{layouts:eventLayouts,expiresAt:Date.now()+86400000}})
      if(path.endsWith('/maps'))return route.fulfill({json:{maps:courseId==='pdga:4550'?[
        {url:'https://www.pdga.com/files/course_maps/fixture.pdf',kind:'pdf',label:'Course map 1'}]:[],expiresAt:Date.now()+86400000}})
      return route.fulfill({json:{course:{name:courseId==='pdga:4550'?'Ankerskogen fixture':'Ekeberg fixture',source_url:'https://www.pdga.com/node/27416',active:true},
        holes:[],coverage:{note:'Choose an event layout.'},expiresAt:Date.now()+86400000}})
    }
    if(path==='/api/v1/session')return route.fulfill({json:{userId:bagId}})
    if(path==='/api/v1/bags')return route.fulfill({json:{bags:[
      {id:bagId,name:'Everyday bag',disc_ids:bagDiscs},{id:'00000000-0000-4000-8000-000000000009',name:'Travel bag',disc_ids:[]}]}})
    if(path==='/api/v1/discs')return route.fulfill({json:{discs:[
      {id:discId,name:'Buzzz',manufacturer:'Discraft',added_at:new Date().toISOString()},
      {id:secondDiscId,name:'Leopard',manufacturer:'Innova',added_at:new Date().toISOString()},...inventory]}})
    if(path==='/api/v1/course_pins')return route.fulfill({json:{course_pins:[
      {id:pinId,course_name:event?'PDGA course':'My local course',course_id:event?courseId:null,bag_id:bagId,created_at:new Date().toISOString()}]}})
    if(path==='/api/v1/planner/event-layout'&&method==='POST'){
      const body=route.request().postDataJSON()
      state.layoutBodies.push(body)
      const selected=eventLayouts.find(e=>e.tournament_id===body.tournament_id&&e.layout_id===body.layout_id)!
      const layout:PrivateLayout={id:layoutId,name:selected.name,tee:'',basket:'',description:'',checked_on:null,
        version:1,holes:[{id:'00000000-0000-4000-8000-000000000008',label:'1A',par:3,distance_m:85,tee:'Long tee',target:'Basket A',notes:'OB fixture'}],
        provider_ref:{course_id:courseId,tournament_id:selected.tournament_id,layout_id:selected.layout_id},
        provider_event:selected,expiresAt:Date.now()+86400000}
      const existing=state.layouts.find(l=>l.id===layoutId)
      if(!existing)state.layouts.push(layout)
      return route.fulfill({status:201,json:{layout:existing??layout}})
    }
    if(path==='/api/v1/planner/duplicate'&&method==='POST'){
      if(state.failSave)return route.fulfill({status:409,json:{error:'plan_changed_reload'}})
      const body=route.request().postDataJSON()
      const source=state.layouts.find(l=>l.id===body.layout_id)!
      const layout={...structuredClone(source),id:'00000000-0000-4000-8000-000000000010',
        private_name:body.name,name:body.name}
      state.layouts.push(layout)
      state.plan={layout_id:layout.id,version:(state.plan?.version??0)+1,
        selections:structuredClone(state.plans[source.id]?.selections??{})}
      state.plans[layout.id]=structuredClone(state.plan)
      return route.fulfill({status:201,json:{layout,plan:state.plan}})
    }
    if(path==='/api/v1/planner'){
      if(method==='POST'){
        const body=route.request().postDataJSON();state.layoutBodies.push(body)
        const layout={...body,id:layoutId,version:1} as PrivateLayout
        state.layouts.push(layout)
        return route.fulfill({status:201,json:{layout}})
      }
      if(new URL(route.request().url()).search)return route.fulfill({json:{layouts:state.layouts,plan:state.plan,
        selected_plan:state.plans[new URL(route.request().url()).searchParams.get('layout_id')??'']??null}})
      const layout=state.layouts.find(l=>l.id===state.plan?.layout_id)
      return route.fulfill({json:{summaries:layout?[{course_pin_id:pinId,layout_name:layout.name,hole_count:layout.holes.length,
        planned_count:Object.values(state.plan!.selections).filter(s=>s.disc_ids.length).length}]:[]}})
    }
    if(path===`/api/v1/planner/layouts/${layoutId}`&&method==='PUT'){
      const body=route.request().postDataJSON();state.layoutBodies.push(body)
      const layout={...body,id:layoutId,version:state.layouts[0].version+1} as PrivateLayout
      state.layouts=[layout]
      if(state.plan)state.plan.version++
      return route.fulfill({json:{layout}})
    }
    if(path===`/api/v1/planner/layouts/${layoutId}`&&method==='DELETE'){
      if(state.plan)return route.fulfill({status:409,json:{error:'layout_in_use_unlink_game_plans_first'}})
      state.layouts=[]
      return route.fulfill({json:{deleted:true}})
    }
    if(path===`/api/v1/planner/pins/${pinId}`&&method==='PUT'){
      if(state.failSave)return route.fulfill({status:409,json:{error:'plan_changed_reload'}})
      state.plan={...route.request().postDataJSON(),version:(state.plan?.version??0)+1}
      state.plans[state.plan!.layout_id]=structuredClone(state.plan!)
      return route.fulfill({json:{plan:state.plan}})
    }
    return route.fulfill({json:{[path.split('/').at(-1)!]:[]}})
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button',{name:/Bags/}).click()
  await expect(page.getByRole('button',{name:'Courses (1) & plans',exact:true})).toBeVisible()
  expect(state.providerRequests).toBe(0)
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('griplock-data-error',{detail:'Synthetic provider warning'})))
  await expect(page.getByRole('alert')).toContainText('Synthetic provider warning')
  await expect(page.locator('.bag-course-shortcut')).toHaveCount(1)
  await page.getByRole('button',{name:'Dismiss',exact:true}).click()
  await expect(page.locator('.bag-course-shortcut')).toHaveCount(1)
  await page.getByRole('button',{name:'Courses (1) & plans',exact:true}).click()
  await page.getByRole('button',{name:'Open private planner',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Private layout & game plan'})).toBeVisible()
  return state
}
async function createLayout(page:Page){
  await page.getByRole('button',{name:'Create private layout',exact:true}).click()
  await page.getByLabel('Layout name',{exact:true}).fill('Short tees · My observations')
  await page.getByRole('button',{name:'+ Add hole',exact:true}).click()
  await page.getByLabel('Par',{exact:true}).fill('3')
  await page.getByLabel('Distance (m)',{exact:true}).fill('85')
  await page.getByRole('checkbox',{name:/I entered my own observations/}).check()
  await page.getByRole('button',{name:'Save layout',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Short tees · My observations'})).toBeVisible()
}

test('private manual holes retain choices and compact bag navigation keeps course details in Courses',async({page},testInfo)=>{
  const state=await setup(page)
  await createLayout(page)
  const stableId=state.layouts[0].holes[0].id
  await page.getByLabel('Add disc for hole 1',{exact:true}).selectOption(discId)
  await page.getByLabel('Add disc for hole 1',{exact:true}).selectOption(secondDiscId)
  await page.getByLabel('Strategy for hole 1',{exact:true}).fill('Safe forehand, Leopard for calm conditions.')
  await expect(page.getByText(/1 selected disc is missing from this bag/)).toBeVisible()
  await page.getByRole('button',{name:'Make Leopard primary on hole 1',exact:true}).click()
  await expect(page.getByText('Primary: Leopard · Not in bag',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Save game plan',exact:true}).last().click()
  expect(state.plan?.selections[stableId].disc_ids).toEqual([secondDiscId,discId])
  await page.getByRole('button',{name:'Edit layout',exact:true}).click()
  await page.getByLabel('Hole label',{exact:true}).fill('1A')
  await page.getByRole('checkbox',{name:/I entered my own observations/}).check()
  await page.getByRole('button',{name:'Save layout',exact:true}).click()
  expect(state.layouts[0].holes[0].id).toBe(stableId)
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Safe forehand, Leopard for calm conditions.')
  await expect(page.getByText('1/1 holes planned',{exact:true})).toBeVisible()
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('private-planner.png'),fullPage:true})
  await page.getByRole('button',{name:'Open linked bag',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Courses & plans',exact:true})).toHaveCount(0)
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('compact-bag-courses.png'),fullPage:true})
  await page.getByRole('button',{name:'Courses (1) & plans',exact:true}).click()
  await page.getByRole('button',{name:'Open private planner',exact:true}).click()
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Safe forehand, Leopard for calm conditions.')
  await page.getByRole('button',{name:'Open linked bag',exact:true}).click()
  await page.getByRole('button',{name:'Courses (1) & plans',exact:true}).click()
  await page.getByRole('button',{name:'+ Pin Course',exact:true}).click()
  await expect(page.getByLabel('Link to Bag',{exact:true})).toHaveValue(bagId)
})

test('PDGA historical holes display tee target and notes and accept private multi-disc strategy without editing provider facts',async({page},testInfo)=>{
  const state=await setup(page,true,[fixtureEvent],true)
  await expect(page.getByRole('alert').last()).toContainText('pdga_rate_limited')
  state.failEvents=false
  await page.getByRole('button',{name:'Dismiss',exact:true}).click()
  await page.getByRole('button',{name:'Retry course layouts',exact:true}).click()
  await page.getByLabel('Available course layouts',{exact:true}).selectOption('99:11')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Hole 1A',exact:true})).toBeVisible()
  await expect(page.getByText('Par 3 · 85 m',{exact:true})).toBeVisible()
  await expect(page.getByText('Tee: Long tee · Target: Basket A',{exact:true})).toBeVisible()
  await expect(page.getByText('OB fixture',{exact:true})).toBeVisible()
  await expect(page.getByText(/PDGA event: Fixture event.*2026-01-02/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Edit layout',exact:true})).toHaveCount(0)
  await page.getByLabel('Add disc for hole 1A',{exact:true}).selectOption(discId)
  await page.getByLabel('Add disc for hole 1A',{exact:true}).selectOption(secondDiscId)
  await page.getByLabel('Strategy for hole 1A',{exact:true}).fill('My private strategy')
  const topSave=page.getByRole('group',{name:'Planner actions',exact:true}).getByRole('button',{name:'Save game plan',exact:true})
  await expect(topSave).toBeEnabled()
  await topSave.click()
  expect(Object.values(state.plan!.selections)[0].disc_ids).toEqual([discId,secondDiscId])
  await expect(page.getByText('Game plan saved.',{exact:true})).toBeVisible()
  await expect(topSave).toBeDisabled()
  await expect(page.getByRole('button',{name:'Save game plan',exact:true}).last()).toBeDisabled()
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('event-hole-planner.png'),fullPage:true})
})

test('failed saves remain explicit and unsaved navigation can be declined',async({page})=>{
  const state=await setup(page)
  await createLayout(page)
  await page.getByLabel('Add disc for hole 1',{exact:true}).selectOption(discId)
  state.failSave=true
  const topSave=page.getByRole('group',{name:'Planner actions',exact:true}).getByRole('button',{name:'Save game plan',exact:true})
  await topSave.click()
  await expect(page.getByRole('alert').last()).toContainText('plan_changed_reload')
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible()
  page.once('dialog',dialog=>dialog.dismiss())
  await page.getByRole('button',{name:'Open linked bag',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Private layout & game plan'})).toBeVisible()
  const plannerUrl=page.url()
  page.once('dialog',dialog=>dialog.dismiss())
  await page.goBack()
  await expect(page.getByRole('heading',{name:'Private layout & game plan'})).toBeVisible()
  await expect(page).toHaveURL(plannerUrl)
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible()
  state.failSave=false
  await expect(topSave).toBeEnabled()
  await page.getByRole('button',{name:'Save game plan',exact:true}).last().click()
  await expect(page.getByText('Game plan saved.',{exact:true})).toBeVisible()
})

test('latest two events display newest first with all layouts and default to the newest without replacing a saved plan',async({page})=>{
  const recent={...fixtureEvent,tournament_id:'100',event_name:'Recent event',event_date:'2026-05-25'}
  const events=[{...recent,layout_id:'13',name:'Short tees'},{...recent,layout_id:'14',name:'Long tees'},
    {...recent,layout_id:'15',name:'Final tees'},
    {...fixtureEvent,tournament_id:'101',layout_id:'22',event_name:'Previous event',event_date:'2026-05-09'}]
  const state=await setup(page,true,events)
  await expect(page.getByRole('button',{name:'Browse PDGA event layouts',exact:true})).toHaveCount(0)
  const picker=page.getByLabel('Available course layouts',{exact:true})
  await expect(picker).toHaveValue('100:13')
  expect(await picker.locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value)))
    .toEqual(['','100:13','100:14','100:15','101:22'])
  await expect(picker.locator('option').nth(1)).toContainText('Recent event · 2026-05-25')
  await expect(picker.locator('option').last()).toContainText('Previous event · 2026-05-09')
  expect(state.layouts).toEqual([])
  expect(state.plan).toBeNull()
  await picker.selectOption('100:14')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  expect(state.layoutBodies.at(-1)).toEqual({course_pin_id:pinId,tournament_id:'100',layout_id:'14'})
  await expect(page.getByRole('heading',{name:'Long tees',exact:true})).toBeVisible()
  await page.getByLabel('Strategy for hole 1A',{exact:true}).fill('Keep my saved strategy')
  await page.getByRole('group',{name:'Planner actions',exact:true}).getByRole('button',{name:'Save game plan',exact:true}).click()
  await page.getByRole('button',{name:'Duplicate & rename',exact:true}).click()
  await page.getByLabel('Private game plan name',{exact:true}).fill('My recent event plan')
  await page.getByRole('button',{name:'Create private game plan',exact:true}).click()
  await expect(page.getByRole('heading',{name:'My recent event plan',exact:true})).toBeVisible()
  const copy=state.layouts.find(l=>l.private_name==='My recent event plan')!
  expect(copy.provider_ref).toEqual({course_id:'pdga:4551',tournament_id:'100',layout_id:'14'})
  await expect(picker).toHaveValue('100:14')
  await expect(page.getByRole('combobox',{name:'Layout',exact:true})).toHaveValue(copy.id)
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Keep my saved strategy')
  expect(state.plan?.layout_id).toBe(copy.id)
})

test('an unused layout can be deleted without having to link it to a plan first',async({page})=>{
  const state=await setup(page)
  await createLayout(page)
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'Delete layout',exact:true}).click()
  await expect(page.getByText('Private layout deleted.',{exact:true})).toBeVisible()
  expect(state.layouts).toEqual([])
  expect(state.plan).toBeNull()
})

test('an unchanged event layout duplicates immediately without a saved source or mandatory disc edits',async({page})=>{
  const state=await setup(page,true)
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  await expect(page.getByText('No course map is available from PDGA for this course.',{exact:true})).toBeVisible()
  await expect(page.locator('.hole-maps')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Duplicate & rename',exact:true})).toBeEnabled()
  expect(state.plan).toBeNull()
  await page.getByRole('button',{name:'Duplicate & rename',exact:true}).click()
  await page.getByLabel('Private game plan name',{exact:true}).fill('Ekeberg casual rounds')
  await page.getByRole('button',{name:'Create private game plan',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg casual rounds',exact:true})).toBeVisible()
  expect(state.plan?.selections).toEqual({})
  expect(state.plans[layoutId]).toBeUndefined()
  expect(state.layouts).toHaveLength(2)
})

test('Ankerskogen maps appear below hole facts on demand without loading every PDF in advance',async({page},testInfo)=>{
  await page.route('https://www.pdga.com/files/course_maps/fixture.pdf',route=>route.fulfill({
    contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF')}))
  await setup(page,true,[fixtureEvent],false,'pdga:4550')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  const hole=page.locator('.planner-hole').first()
  await expect(hole).toContainText('Course overview, not a hole-specific diagram.')
  await expect(page.locator('iframe')).toHaveCount(0)
  await hole.locator('summary').click()
  await expect(hole.getByRole('link',{name:'Open course map 1 in full size',exact:true}))
    .toHaveAttribute('href','https://www.pdga.com/files/course_maps/fixture.pdf')
  await expect(hole.locator('iframe')).toHaveAttribute('title','Ankerskogen fixture · Hole 1A · Course map 1')
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('ankerskogen-course-map.png'),fullPage:true})
})

test('large disc inventory keeps bag discs first, groups by type and filters distinctive labels',async({page})=>{
  const putterId='10000000-0000-4000-8000-000000000001'
  const driverId='10000000-0000-4000-8000-000000000002'
  const inventory=[
    {id:putterId,name:'Z Putter',disc_type:'putter',plastic:'Soft',weight:173,color:'Blue'},
    {id:driverId,name:'Z Driver',disc_type:'distance',plastic:'Star',weight:175,color:'Red'},
    ...Array.from({length:220},(_,index)=>({
      id:`20000000-0000-4000-8000-${index.toString().padStart(12,'0')}`,
      name:`Disc ${220-index}`,disc_type:index%2?'putter':'distance',plastic:index%2?'Star':'Champion',
      weight:170+index%6,color:index%2?'Red':'Blue',
    })),
  ]
  await setup(page,false,[fixtureEvent],false,'pdga:4551',inventory,[driverId,putterId,discId])
  await createLayout(page)
  const picker=page.getByLabel('Add disc for hole 1',{exact:true})
  expect(await picker.locator('option').count()).toBe(225)
  expect(await picker.locator('optgroup').evaluateAll(groups=>groups.map(group=>group.getAttribute('label'))))
    .toEqual(['In bag · Putter','In bag · Distance Driver','In bag · Other',
      'Other inventory · Putter','Other inventory · Distance Driver','Other inventory · Other'])
  expect(await picker.locator('option').evaluateAll(options=>options.slice(1,4).map(option=>option.getAttribute('value'))))
    .toEqual([putterId,driverId,discId])
  await expect(picker.locator(`option[value="${putterId}"]`)).toHaveText('Z Putter · Soft · 173 g · Blue')
  const others=picker.locator('optgroup[label="Other inventory · Putter"] option')
  await expect(others.first()).toHaveText('Disc 1 · Star · 173 g · Red')
  await expect(others.nth(1)).toHaveText('Disc 3 · Star · 171 g · Red')
  await picker.selectOption(putterId)
  await expect(picker.locator(`option[value="${putterId}"]`)).toHaveCount(0)
  await page.getByRole('searchbox',{name:'Find a disc',exact:true}).fill('Champion Blue')
  expect(await picker.locator('option').count()).toBeGreaterThan(1)
  await expect(picker.locator('optgroup[label^="In bag"]')).toHaveCount(0)
  await page.getByRole('searchbox',{name:'Find a disc',exact:true}).fill('No such disc')
  await expect(picker.locator('option')).toHaveCount(1)
  await page.getByRole('searchbox',{name:'Find a disc',exact:true}).fill('')
  await expect(picker.locator('option')).toHaveCount(224)
  await expect(page.getByText('Primary: Z Putter · Soft · 173 g · Blue',{exact:true})).toBeVisible()
})

test('expired or unavailable maps remove previews and offer retry without destroying private plans',async({page})=>{
  await page.clock.install()
  const state=await setup(page,true,[fixtureEvent],false,'pdga:4550')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  await page.getByLabel('Strategy for hole 1A',{exact:true}).fill('Keep my own notes')
  await page.getByRole('group',{name:'Planner actions',exact:true}).getByRole('button',{name:'Save game plan',exact:true}).click()
  await expect(page.locator('.hole-maps')).toBeVisible()
  await page.clock.fastForward(86400001)
  await expect(page.locator('.hole-maps')).toHaveCount(0)
  await expect(page.getByText('Course maps expired. Reload to refresh.',{exact:false})).toBeVisible()
  await page.route('**/courses/pdga:4550/maps',route=>route.fulfill({status:503,json:{error:'pdga_unavailable'}}))
  await page.getByRole('button',{name:'Retry maps',exact:true}).click()
  await expect(page.locator('.course-maps')).toContainText('pdga_unavailable')
  expect(Object.values(state.plan!.selections)[0].notes).toBe('Keep my own notes')
  await expect(page.locator('.course-map-preview')).toHaveCount(0)
})

test('duplicate and rename keeps independent private choices and never claims a static provider snapshot',async({page},testInfo)=>{
  const state=await setup(page,true)
  await page.getByLabel('Available course layouts',{exact:true}).selectOption('99:11')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  const duplicate=page.getByRole('button',{name:'Duplicate & rename',exact:true})
  await expect(duplicate).toBeEnabled()
  await page.getByLabel('Add disc for hole 1A',{exact:true}).selectOption(discId)
  await page.getByLabel('Strategy for hole 1A',{exact:true}).fill('Saved source strategy')
  await expect(duplicate).toBeDisabled()
  const topSave=page.getByRole('group',{name:'Planner actions',exact:true}).getByRole('button',{name:'Save game plan',exact:true})
  await topSave.click()
  await duplicate.click()
  const form=page.getByRole('form',{name:'Duplicate private game plan',exact:true})
  await expect(form.getByRole('button',{name:'Create private game plan',exact:true})).toBeDisabled()
  await form.getByLabel('Private game plan name',{exact:true}).fill('Ekeberg everyday rounds')
  await expect(form).toContainText('not a permanent hole-layout snapshot')
  state.failSave=true
  await form.getByRole('button',{name:'Create private game plan',exact:true}).click()
  await expect(form.getByLabel('Private game plan name',{exact:true})).toHaveValue('Ekeberg everyday rounds')
  state.failSave=false
  await form.getByRole('button',{name:'Create private game plan',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg everyday rounds',exact:true})).toBeVisible()
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Saved source strategy')
  await page.getByLabel('Strategy for hole 1A',{exact:true}).fill('My independent everyday strategy')
  await topSave.click()
  expect(state.plans['00000000-0000-4000-8000-000000000010'].selections['00000000-0000-4000-8000-000000000008'].notes).toBe('My independent everyday strategy')
  await page.getByRole('combobox',{name:'Layout',exact:true}).selectOption(layoutId)
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Saved source strategy')
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('combobox',{name:'Layout',exact:true}).selectOption('00000000-0000-4000-8000-000000000010')
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('My independent everyday strategy')
  await page.reload()
  await page.getByRole('navigation').getByRole('button',{name:/Courses/}).click()
  await page.getByRole('button',{name:'Open private planner',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg everyday rounds',exact:true})).toBeVisible()
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('My independent everyday strategy')
  await page.getByLabel('Available course layouts',{exact:true}).selectOption('99:11')
  await page.getByRole('button',{name:'Use layout',exact:true}).click()
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('Saved source strategy')
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('combobox',{name:'Layout',exact:true}).selectOption('00000000-0000-4000-8000-000000000010')
  await expect(page.getByLabel('Strategy for hole 1A',{exact:true})).toHaveValue('My independent everyday strategy')
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('private-named-gameplan.png'),fullPage:true})
})
