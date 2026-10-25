import { useCallback, useEffect, useState } from 'react'
import type { ClientDisc, ClientBag } from '../utils/disc'
import { useCoursePins, type CatalogueCourse, type ClientPin } from '../hooks/useCoursePins'
import { confirmPlannerNavigation, plannerData, subscribeToChanges } from '../lib/data'
import { CoursePlanner } from '../components/CoursePlanner'

interface CoursesPagesProps {
  allDiscs: ClientDisc[]
  allBags: ClientBag[]
  initialBagId?: string
  initialPinId?: string
  onOpenBag?: (bagId:string)=>void
}
interface PlanSummary {
  course_pin_id:string; layout_name:string; planned_count:number; required_disc_count:number; missing_disc_count:number
}

export function CoursesPage({allDiscs,allBags,initialBagId,initialPinId,onOpenBag}:CoursesPagesProps) {
  const {pins,pinsLoading,pinsError,loadPins,createPin,deletePin,searchCourses,resetCourseSearch,
    courseLoading,courseSuggestions,courseError,courseCache,loadCourseDetails,searchedQuery,courseDetailsErrors}=useCoursePins(true)
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
  const [courseFilter,setCourseFilter]=useState('')
  const [chosenPins,setChosenPins]=useState<Record<string,string>>({})
  const [summaries,setSummaries]=useState<PlanSummary[]>([])
  const [summaryError,setSummaryError]=useState('')
  const loadSummaries=useCallback(async()=>{
    try {
      const result=await plannerData<{summaries:PlanSummary[]}>('planner')
      setSummaries(result.summaries);setSummaryError('')
    } catch(reason) {setSummaryError(reason instanceof Error?reason.message:'Could not load bag readiness.')}
  },[])
  useEffect(()=>{
    void loadSummaries()
    return subscribeToChanges(['planner','bags','course_pins'],loadSummaries)
  },[loadSummaries])
  useEffect(()=>{
    if(!selected?.expiresAt)return
    const timer=setTimeout(()=>{setSelected(null);setQuery('');resetCourseSearch()},
      Math.max(0,selected.expiresAt-Date.now()))
    return ()=>clearTimeout(timer)
  },[selected])
  const perform=async(action:()=>Promise<void>)=>{
    if(busy)return
    setBusy(true);setError('')
    try{await action()}catch(reason){setError(reason instanceof Error?reason.message:'Could not update the course link.')}
    finally{setBusy(false)}
  }
  const groups=new Map<string,ClientPin[]>()
  for(const pin of pins) {
    const key=pin.courseId??`custom:${pin.id}`
    groups.set(key,[...(groups.get(key)??[]),pin])
  }
  const visible=[...groups.entries()].filter(([,links])=>
    links.some(pin=>(!filterBagId||pin.bagId===filterBagId)&&
      `${pin.courseName} ${allBags.find(b=>b.id===pin.bagId)?.name??''}`.toLocaleLowerCase().includes(courseFilter.trim().toLocaleLowerCase())))
    .sort(([,a],[,b])=>a[0].courseName.localeCompare(b[0].courseName))
  return <div className="courses-page">
    <div className="planner-heading">
      <div><h2>{groups.size} {groups.size===1?'course':'courses'} pinned</h2>
        <p className="bag-hint">Choose your course, compare bag configurations, then open your private game plan.</p></div>
      <button className="btn btn-primary" onClick={()=>{
        setShowForm(true);setQuery('');setSelected(null);setBagId(filterBagId||allBags[0]?.id||'');resetCourseSearch()
      }}>+ Pin Course</button>
    </div>
    <div className="course-list-filters">
    <label>Find a planned course
      <input type="search" value={courseFilter} onChange={event=>{
        if(plannerPinId&&!confirmPlannerNavigation())return
        setCourseFilter(event.target.value);setPlannerPinId(null)
      }} placeholder="Course or bag name"/>
    </label>
    <label>Bag configuration
      <select aria-label="Filter courses by bag" value={filterBagId} onChange={event=>{
        if(confirmPlannerNavigation()){setFilterBagId(event.target.value);setPlannerPinId(null)}
      }}><option value="">All bags</option>{allBags.map(bag=><option key={bag.id} value={bag.id}>{bag.name}</option>)}</select>
    </label></div>
    {summaryError&&<p role="alert">{summaryError} <button className="btn" onClick={()=>void loadSummaries()}>Retry bag readiness</button></p>}
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
          setQuery(event.target.value);setSelected(null);resetCourseSearch()
        }}/>
      </label>
      <button type="button" className="btn" disabled={courseLoading||query.trim().length<2}
        onClick={()=>void searchCourses(query)}>Search PDGA</button>
      <p className="bag-hint">Search when the course name is ready. Typing does not send requests to PDGA.</p>
      {courseLoading&&<p role="status">Searching PDGA...</p>}
      {courseError&&<p role="alert">{courseError} Cached searches remain available. You can also save a custom course.</p>}
      {!courseLoading&&!courseError&&!!searchedQuery&&searchedQuery===query.trim()&&!selected&&!courseSuggestions.length&&
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
    {!pinsLoading&&!visible.length&&<p className="bag-hint">{courseFilter.trim()?'No planned courses match your search.':pins.length?'No courses linked to this bag yet.':'No courses pinned yet.'}</p>}
    <div className="course-list-head" aria-hidden="true"><span>Course</span><span>Bag configuration</span><span>Game plan / packing</span><span>Actions</span></div>
    <div className="course-links">{visible.map(([courseKey,links])=>{
      const eligible=links.filter(pin=>!filterBagId||pin.bagId===filterBagId)
      const pin=eligible.find(pin=>pin.id===plannerPinId)??eligible.find(pin=>pin.id===chosenPins[courseKey])??eligible[0]
      const bag=allBags.find(b=>b.id===pin.bagId)
      const details=pin.courseId?courseCache[pin.courseId]:undefined
      const summary=summaries.find(s=>s.course_pin_id===pin.id)
      const unlinkedBags=allBags.filter(b=>!links.some(p=>p.bagId===b.id))
      const linkedBagCount=new Set(links.map(p=>p.bagId)).size
      return <section key={courseKey} className="course-link" aria-label={`Course ${pin.courseName}`}>
        <div className="course-list-row">
          <div><h3><button className="course-name-link" aria-expanded={plannerPinId===pin.id} onClick={()=>{
            if(confirmPlannerNavigation())setPlannerPinId(pin.id)
          }}>{pin.courseName}</button></h3>
            <p className="bag-hint">{linkedBagCount} linked {linkedBagCount===1?'bag':'bags'}
              {details?.sourceUrl&&<> · <a href={details.sourceUrl} target="_blank" rel="noopener noreferrer">PDGA</a></>}</p></div>
          <label><span className="sr-only">Bag for {pin.courseName}</span>
            <select aria-label={`Bag for ${pin.courseName}`} value={pin.id} onChange={event=>{
              if(!confirmPlannerNavigation())return
              setChosenPins(previous=>({...previous,[courseKey]:event.target.value}))
              if(plannerPinId&&links.some(p=>p.id===plannerPinId))setPlannerPinId(event.target.value)
            }}>{eligible.map(p=><option key={p.id} value={p.id}>{allBags.find(b=>b.id===p.bagId)?.name??'Unknown bag'}</option>)}</select>
          </label>
          <div className="course-plan-summary">{summary?<>
            <strong>{summary.layout_name}</strong>
            <span className="bag-hint">{summary.planned_count} holes planned</span>
            <span>{summary.missing_disc_count>0?`${summary.missing_disc_count} planned discs to pack`:
              summary.required_disc_count>0?'All planned discs in bag':'No discs selected yet'}</span>
          </>:<span className="bag-hint">No saved game plan</span>}</div>
          <div className="course-row-actions">
          <button className="btn" aria-expanded={plannerPinId===pin.id} onClick={()=>{
            if(confirmPlannerNavigation())setPlannerPinId(plannerPinId===pin.id?null:pin.id)
          }}>{plannerPinId===pin.id?'Close private planner':'Open private planner'}</button>
          {bag&&onOpenBag&&<button className="btn" onClick={()=>onOpenBag(bag.id)}>Open linked bag</button>}
          <details className="course-row-menu"><summary>More<span className="sr-only"> actions for {pin.courseName}</span></summary>
          <button className="btn" disabled={!unlinkedBags.length} onClick={()=>{setLinkPin(linkPin===pin.id?null:pin.id);setLinkBag('')}}>Link another bag</button>
          <button className="btn" aria-label={`Unlink ${pin.courseName}`} disabled={busy} onClick={()=>{
            if(confirmPlannerNavigation()&&confirm(`Unlink ${pin.courseName} from ${bag?.name??'this bag'}? Its game plan will be deleted. The private layout remains.`))
              void perform(async()=>{await deletePin(pin.id);if(plannerPinId===pin.id)setPlannerPinId(null)})
          }}>Unlink course</button>
          {pin.courseId?.startsWith('pdga:')&&!details&&<button className="btn" disabled={courseLoading}
            onClick={()=>void loadCourseDetails(pin)}>Load course details</button>}
          </details></div>
        </div>
        {pin.courseId?.startsWith('pdga:')&&!details&&courseDetailsErrors[pin.courseId]&&
          <p role="status">{courseDetailsErrors[pin.courseId]} Use More → Load course details to retry.</p>}
        {linkPin===pin.id&&<form className="planner-toolbar" onSubmit={event=>{
          event.preventDefault()
          void perform(async()=>{
            if(!confirmPlannerNavigation())return
            const id=await createPin(pin.courseName,pin.courseId??`custom:${pin.id}`,linkBag)
            setFilterBagId(linkBag);setPlannerPinId(id);setLinkPin(null)
          })
        }}>
          <label>Another bag configuration<select required value={linkBag} onChange={event=>setLinkBag(event.target.value)}>
            <option value="">Choose a bag</option>{unlinkedBags.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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
