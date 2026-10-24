import { expect, test } from '@playwright/test'

test('PDGA search persists IDs only, resolves cached names after reload and has no retired provider UI',async({page})=>{
  const bagId='00000000-0000-4000-8000-000000000001'
  const pinId='00000000-0000-4000-8000-000000000002'
  const pins:object[]=[]
  const course={id:'pdga:4551',source:'pdga',name:'Ekeberg fixture',city:'Oslo',expected_holes:18,
    source_url:'https://www.pdga.com/node/27416',expiresAt:Date.now()+86400000,active:true}
  let failSearch=false
  const external:string[]=[]
  await page.addInitScript(()=>sessionStorage.setItem('griplock.devAccessToken',
    `h.${btoa(JSON.stringify({preferred_username:'fixture'}))}.s`))
  await page.route('**/*',route=>{
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
    if(path==='/api/v1/courses')return failSearch?route.fulfill({status:429,json:{error:'pdga_rate_limited'}}):
      route.fulfill({json:{courses:[course]}})
    if(path.endsWith('/holes'))return route.fulfill({json:{course,holes:[],expiresAt:course.expiresAt,coverage:{note:'Choose an event layout.'}}})
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
  await expect(page.getByRole('alert').last()).toContainText('pdga_rate_limited')
  await expect(page.getByText(/No matching Norwegian courses/)).toHaveCount(0)
  failSearch=false
  await page.getByLabel(/Course Name/).fill('Ekeberg fixture')
  await expect(page.getByRole('link',{name:'Ekeberg fixture on PDGA'})).toHaveAttribute('href',course.source_url)
  await page.getByRole('button',{name:/Ekeberg fixture.*18 listed holes/}).click()
  await page.getByRole('button',{name:'Save Pin',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg fixture',exact:true})).toBeVisible()
  await page.reload()
  await page.getByRole('navigation').getByRole('button',{name:/Courses/}).click()
  await expect(page.getByRole('heading',{name:'Ekeberg fixture',exact:true}).getByRole('link')).toHaveAttribute('href',course.source_url)
  expect(external).toEqual([])
  expect(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth)).toBe(true)
})
