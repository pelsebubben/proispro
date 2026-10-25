import { expect, test } from '@playwright/test'

test('PDGA search persists IDs only, resolves cached names after reload and has no retired provider UI',async({page})=>{
  const bagId='00000000-0000-4000-8000-000000000001'
  const pinId='00000000-0000-4000-8000-000000000002'
  const pins:object[]=[]
  const course={id:'pdga:4551',source:'pdga',name:'Ekeberg fixture',city:'Oslo',expected_holes:18,
    source_url:'https://www.pdga.com/node/27416',expiresAt:Date.now()+86400000,active:true}
  let failSearch=false
  let searchRequests=0
  const external:string[]=[]
  await page.addInitScript(()=>sessionStorage.setItem('griplock.devAccessToken',
    `h.${btoa(JSON.stringify({preferred_username:'fixture'}))}.s`))
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.origin!=='http://127.0.0.1:4173'){external.push(url.origin);return route.abort()}
    const path=url.pathname
    if(path==='/runtime-config.js')return route.fulfill({contentType:'text/javascript',
      body:'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}'})
    if(path==='/api/v1/session')return route.fulfill({json:{userId:bagId}})
    if(path==='/api/v1/bags')return route.fulfill({json:{bags:[{id:bagId,name:'Main',disc_ids:[]}]}})
    if(path==='/api/v1/course_pins'){
      if(route.request().method()==='POST'){
        const body=route.request().postDataJSON()
        expect(body.course_name).toBe('PDGA course')
        expect(body.course_id).toBe(course.id)
        const pin={...body,id:pinId,created_at:new Date().toISOString()}
        pins.push(pin);return route.fulfill({status:201,json:pin})
      }
      return route.fulfill({json:{course_pins:pins}})
    }
    if(path==='/api/v1/courses'){
      searchRequests++
      await new Promise(resolve=>setTimeout(resolve,400))
      return failSearch?route.fulfill({status:429,json:{error:'pdga_rate_limited',retryAfterSeconds:60}}):
        route.fulfill({json:{courses:[course]}})
    }
    if(path.endsWith('/holes'))return route.fulfill({json:{course,holes:[],expiresAt:course.expiresAt,coverage:{note:'Choose an event layout.'}}})
    if(path.endsWith('/layouts'))return route.fulfill({json:{layouts:[],expiresAt:course.expiresAt}})
    if(path.endsWith('/maps'))return route.fulfill({json:{maps:[],expiresAt:course.expiresAt}})
    if(path==='/api/v1/planner')return route.fulfill({json:{layouts:[],plan:null,summaries:[]}})
    if(path.startsWith('/api/v1/'))return route.fulfill({json:{[path.split('/').at(-1)!]:[]}})
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button',{name:/Courses/}).click()
  await expect(page.getByRole('button',{name:/Download ODbL/})).toHaveCount(0)
  await expect(page.getByRole('link',{name:/OpenStreetMap/})).toHaveCount(0)
  await page.getByRole('button',{name:'+ Pin Course',exact:true}).click()
  failSearch=true
  await page.getByLabel(/Course Name/).fill('Ekeberg')
  await page.waitForTimeout(500)
  expect(searchRequests).toBe(0)
  await page.getByRole('button',{name:'Search PDGA',exact:true}).click()
  await expect(page.getByRole('alert').last()).toContainText('pdga_rate_limited')
  await expect(page.getByRole('alert').last()).toContainText('1 minute')
  await expect(page.getByText(/No matching Norwegian courses/)).toHaveCount(0)
  failSearch=false
  await page.getByRole('button',{name:'Search PDGA',exact:true}).click()
  await expect(page.getByRole('link',{name:'Ekeberg fixture on PDGA'})).toHaveAttribute('href',course.source_url)
  await page.getByRole('button',{name:/Ekeberg fixture.*18 listed holes/}).click()
  await page.getByRole('button',{name:'Save Pin',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg fixture',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Private layout & game plan',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Browse PDGA event layouts',exact:true})).toHaveCount(0)
  await page.reload()
  await page.getByRole('navigation').getByRole('button',{name:/Courses/}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg fixture',exact:true}).getByRole('link')).toHaveCount(0)
  await page.getByRole('button',{name:'Ekeberg fixture',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Private layout & game plan',exact:true})).toBeVisible()
  await expect(page.locator('.course-disclaimer')).toContainText('Course data may vary.')
  expect(external).toEqual([])
  expect(searchRequests).toBe(2)
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
})

test('course library groups bag links, shows packing needs and switches independent plans',async({page},testInfo)=>{
  const bagA='00000000-0000-4000-8000-000000000001'
  const bagB='00000000-0000-4000-8000-000000000002'
  const pinA='00000000-0000-4000-8000-000000000003'
  const pinB='00000000-0000-4000-8000-000000000004'
  const course={id:'pdga:4551',name:'Ekeberg fixture',source_url:'https://www.pdga.com/node/27416'}
  const pins=[{id:pinA,course_id:course.id,course_name:'PDGA course',bag_id:bagA,created_at:new Date().toISOString()},
    {id:pinB,course_id:course.id,course_name:'PDGA course',bag_id:bagB,created_at:new Date().toISOString()}]
  let detailRequests=0,creates=0
  const openedPlans:string[]=[]
  await page.addInitScript(()=>sessionStorage.setItem('griplock.devAccessToken',
    `h.${btoa(JSON.stringify({preferred_username:'fixture'}))}.s`))
  await page.route('**/runtime-config.js',route=>route.fulfill({contentType:'text/javascript',
    body:'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}'}))
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname
    if(path.endsWith('/session'))return route.fulfill({json:{userId:bagA}})
    if(path.endsWith('/bags'))return route.fulfill({json:{bags:[
      {id:bagA,name:'Everyday',disc_ids:[]},{id:bagB,name:'Travel',disc_ids:[]}]}})
    if(path.endsWith('/course_pins')){
      if(route.request().method()==='POST')creates++
      return route.fulfill({json:{course_pins:pins}})
    }
    if(path.endsWith('/holes')){detailRequests++;return route.fulfill({json:{course,expiresAt:Date.now()+86400000}})}
    if(path.endsWith('/courses'))return route.fulfill({json:{courses:[{...course,expiresAt:Date.now()+86400000}]}})
    if(path.endsWith('/layouts'))return route.fulfill({json:{layouts:[],expiresAt:Date.now()+86400000}})
    if(path.endsWith('/maps'))return route.fulfill({json:{maps:[],expiresAt:Date.now()+86400000}})
    if(path.endsWith('/planner')){
      if(url.searchParams.has('pin_id')){
        openedPlans.push(url.searchParams.get('pin_id')!)
        return route.fulfill({json:{layouts:[],plan:null}})
      }
      return route.fulfill({json:{summaries:[
        {course_pin_id:pinA,layout_name:'Everyday round',planned_count:12,required_disc_count:4,missing_disc_count:2},
        {course_pin_id:pinB,layout_name:'Travel round',planned_count:18,required_disc_count:5,missing_disc_count:0}]}})
    }
    return route.fulfill({json:{[path.split('/').at(-1)!]:[]}})
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button',{name:/Courses/}).click()
  await expect(page.getByRole('heading',{name:'1 course pinned',exact:true})).toBeVisible()
  await expect(page.locator('.course-link')).toHaveCount(1)
  await expect(page.locator('.course-link')).toContainText('2 linked bags')
  await expect(page.locator('.course-plan-summary')).toContainText('Everyday round')
  await expect(page.locator('.course-plan-summary')).toContainText('2 planned discs to pack')
  expect(detailRequests).toBe(1)
  await page.screenshot({path:testInfo.outputPath('compact-course-library.png'),fullPage:true})
  await page.getByRole('button',{name:'Open private planner',exact:true}).click()
  await expect.poll(()=>openedPlans.at(-1)).toBe(pinA)
  await page.getByLabel('Bag for Ekeberg fixture',{exact:true}).selectOption(pinB)
  await expect.poll(()=>openedPlans.at(-1)).toBe(pinB)
  await expect(page.locator('.course-plan-summary')).toContainText('Travel round')
  await expect(page.locator('.course-plan-summary')).toContainText('All planned discs in bag')
  await page.getByRole('button',{name:'Close private planner',exact:true}).click()
  await page.getByRole('searchbox',{name:'Find a planned course'}).fill('Travel')
  await expect(page.locator('.course-link')).toHaveCount(1)
  await page.getByRole('searchbox',{name:'Find a planned course'}).fill('Missing')
  await expect(page.locator('.course-link')).toHaveCount(0)
  await expect(page.getByText('No planned courses match your search.',{exact:true})).toBeVisible()
  await page.getByRole('searchbox',{name:'Find a planned course'}).fill('')
  await page.getByLabel('Filter courses by bag').selectOption(bagA)
  await expect(page.getByLabel('Bag for Ekeberg fixture')).toHaveValue(pinA)
  await expect(page.locator('.course-plan-summary')).toContainText('2 planned discs to pack')
  await page.getByRole('button',{name:'+ Pin Course',exact:true}).click()
  await page.getByLabel(/Course Name/).fill('Ekeberg')
  await page.getByRole('button',{name:'Search PDGA',exact:true}).click()
  await page.getByRole('button',{name:/Ekeberg fixture.*listed holes/}).click()
  await page.getByRole('button',{name:'Save Pin',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Private layout & game plan',exact:true})).toBeVisible()
  expect(creates).toBe(0)
  await expect(page.locator('.course-link')).toHaveCount(1)
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
})
