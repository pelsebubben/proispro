import { useEffect, useState } from 'react'
import type { ClientDisc, ClientBag } from '../utils/disc'
import { useCoursePins, type CatalogueCourse } from '../hooks/useCoursePins'
import { confirmPlannerNavigation } from '../lib/data'
import { CoursePlanner } from '../components/CoursePlanner'

interface CoursesPagesProps {
  allDiscs: ClientDisc[]
  allBags: ClientBag[]
  initialBagId?: string
  initialPinId?: string
  onOpenBag?: (bagId:string)=>void
}

export function CoursesPage({allDiscs,allBags,initialBagId,initialPinId,onOpenBag}:CoursesPagesProps) {
  const {pins,pinsLoading,pinsError,loadPins,createPin,deletePin,searchCoursesDebounced,
    courseLoading,courseSuggestions,courseError,courseCache,loadCourseDetails}=useCoursePins(true)
  const [showForm,setShowForm]=useState(false)
  const [query,setQuery]=useState('')
  const [selected,setSelected]=useState<CatalogueCourse|null>(null)
  const [bagId,setBagId]=useState(initialBagId??allBags[0]?.id??'')
  const [filterBagId,setFilterBagId]=useState(initialBagId??'')
  const [plannerPinId,setPlannerPinId]=useState<string|null>(initialPinId??null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [linkPin,setLinkPin]=useState<string|null>(null)
  const [linkBag,setLinkBag]=useState('')
  useEffect(()=>{
    if(!selected?.expiresAt)return
    const timer=setTimeout(()=>{setSelected(null);setQuery('');searchCoursesDebounced('')},
      Math.max(0,selected.expiresAt-Date.now()))
    return ()=>clearTimeout(timer)
  },[selected])
  const perform=async(action:()=>Promise<void>)=>{
    if(busy)return
    setBusy(true);setError('')
    try{await action()}catch(reason){setError(reason instanceof Error?reason.message:'Could not update the course link.')}
    finally{setBusy(false)}
  }
  const visible=pins.filter(pin=>!filterBagId||pin.bagId===filterBagId)
  return <div className="courses-page">
    <div className="planner-heading">
      <h2>{pins.length} {pins.length===1?'course':'courses'} pinned</h2>
      <button className="btn btn-primary" onClick={()=>{
        setShowForm(true);setQuery('');setSelected(null);setBagId(filterBagId||allBags[0]?.id||'');searchCoursesDebounced('')
      }}>+ Pin Course</button>
    </div>
    <label className="planner-toolbar">Bag configuration
      <select aria-label="Filter courses by bag" value={filterBagId} onChange={event=>{
        if(confirmPlannerNavigation()){setFilterBagId(event.target.value);setPlannerPinId(null)}
      }}><option value="">All bags</option>{allBags.map(bag=><option key={bag.id} value={bag.id}>{bag.name}</option>)}</select>
    </label>
    {(pinsError||error)&&<p role="alert">{pinsError||error} <button className="btn" onClick={()=>void perform(loadPins)}>Retry course links</button></p>}
    {pinsLoading&&<p role="status">Loading course links...</p>}
    {showForm&&<form className="course-search-form" aria-label="Pin a Course" onSubmit={event=>{
      event.preventDefault()
      void perform(async()=>{
        if(selected?.expiresAt&&selected.expiresAt<=Date.now())throw new Error('Search results expired. Search again before saving.')
        if(!confirmPlannerNavigation())return
        const id=await createPin(selected?.name??query.trim(),selected?.id??null,bagId)
        setFilterBagId(bagId);setPlannerPinId(id);setShowForm(false)
      })
    }}>
      <h3>Pin a Course</h3>
      <label>Course Name (search PDGA or type custom)
        <input autoFocus required value={query} maxLength={100} placeholder="Start typing course name..." onChange={event=>{
          setQuery(event.target.value);setSelected(null);searchCoursesDebounced(event.target.value)
        }}/>
      </label>
      {courseLoading&&<p role="status">Searching PDGA...</p>}
      {courseError&&<p role="alert">{courseError} Change the search to retry. Cached courses remain available during rate limits.</p>}
      {!courseLoading&&!courseError&&query.trim().length>=2&&!selected&&!courseSuggestions.length&&
        <p className="bag-hint">No matching Norwegian courses found. You can still add a custom course.</p>}
      {!selected&&courseSuggestions.map(course=><div key={course.id} className="planner-toolbar">
        <button type="button" className="btn" onClick={()=>{setSelected(course);setQuery(course.name)}}>
          {course.name} · {course.city||'Norway'} · {course.expected_holes??'?'} listed holes
        </button>
        {course.source_url&&<a href={course.source_url} target="_blank" rel="noopener noreferrer" aria-label={`${course.name} on PDGA`}>PDGA</a>}
      </div>)}
      <label htmlFor="course-bag">Link to Bag</label><select id="course-bag" required value={bagId} onChange={event=>setBagId(event.target.value)}>
        <option value="">Select a bag</option>{allBags.map(bag=><option key={bag.id} value={bag.id}>{bag.name}</option>)}
      </select>
      <div className="planner-toolbar">
        <button className="btn btn-primary" disabled={busy||!query.trim()||!bagId}>Save Pin</button>
        <button type="button" className="btn" onClick={()=>setShowForm(false)} disabled={busy}>Cancel</button>
      </div>
    </form>}
    {!pinsLoading&&!visible.length&&<p className="bag-hint">{pins.length?'No courses linked to this bag yet.':'No courses pinned yet.'}</p>}
    <div className="course-links">{visible.map(pin=>{
      const bag=allBags.find(b=>b.id===pin.bagId)
      const details=courseCache[pin.id]
      return <section key={pin.id} className="course-link" aria-label={`Course ${pin.courseName}`}>
        <div className="planner-heading">
          <div><h3><button className="course-name-link" aria-expanded={plannerPinId===pin.id} onClick={()=>{
            if(confirmPlannerNavigation())setPlannerPinId(pin.id)
          }}>{pin.courseName}</button></h3>
            <p className="bag-hint">Bag: {bag?.name??'Unknown'}{pin.courseId?.startsWith('pdga:')&&` · PDGA ID ${pin.courseId.slice(5)}`}</p></div>
          <button className="btn" aria-label={`Unlink ${pin.courseName}`} disabled={busy} onClick={()=>{
            if(confirmPlannerNavigation()&&confirm('Unlink this course? Its game plan will be deleted. The private layout remains.'))
              void perform(()=>deletePin(pin.id))
          }}>Unlink course</button>
        </div>
        <div className="planner-toolbar">
          <button className="btn" aria-expanded={plannerPinId===pin.id} onClick={()=>{
            if(confirmPlannerNavigation())setPlannerPinId(plannerPinId===pin.id?null:pin.id)
          }}>{plannerPinId===pin.id?'Close private planner':'Open private planner'}</button>
          {bag&&onOpenBag&&<button className="btn" onClick={()=>onOpenBag(bag.id)}>Open linked bag</button>}
          <button className="btn" onClick={()=>{setLinkPin(linkPin===pin.id?null:pin.id);setLinkBag('')}}>Link another bag</button>
          {pin.courseId?.startsWith('pdga:')&&!details&&<button className="btn" disabled={courseLoading}
            onClick={()=>void loadCourseDetails(pin)}>Load course details</button>}
        </div>
        {pin.courseId?.startsWith('pdga:')&&!details&&courseError&&<p role="status">{courseError} Use Load course details to retry.</p>}
        {linkPin===pin.id&&<form className="planner-toolbar" onSubmit={event=>{
          event.preventDefault()
          void perform(async()=>{
            if(!confirmPlannerNavigation())return
            const id=await createPin(pin.courseName,pin.courseId??`custom:${pin.id}`,linkBag)
            setFilterBagId(linkBag);setPlannerPinId(id);setLinkPin(null)
          })
        }}>
          <label>Another bag configuration<select required value={linkBag} onChange={event=>setLinkBag(event.target.value)}>
            <option value="">Choose a bag</option>{allBags.filter(b=>b.id!==pin.bagId).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
          <button className="btn" disabled={busy||!linkBag}>Link bag to course</button>
        </form>}
        {plannerPinId===pin.id&&<CoursePlanner key={pin.id} pin={pin} bag={bag} discs={allDiscs} onOpenBag={onOpenBag}/>}
      </section>
    })}</div>
    <footer className="course-disclaimer bag-hint">Course data may vary. Check the course before playing.{' '}
      <a href="https://www.pdga.com/" target="_blank" rel="noopener noreferrer">Player, event, and course data provided by PDGA.</a>
    </footer>
  </div>
}
