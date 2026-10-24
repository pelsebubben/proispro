import { useEffect, useState } from 'react'
import { useCoursePins } from '../hooks/useCoursePins'
import { plannerData } from '../lib/data'

interface Summary { course_pin_id:string; layout_name:string; hole_count:number; planned_count:number }
export function BagCourseLinks({bagId,onOpenCourses}:{bagId:string;onOpenCourses:(bagId:string,pinId?:string)=>void}) {
  const {pins,pinsLoading,pinsError,courseError,courseCache,deletePin,loadPins}=useCoursePins(bagId)
  const [summaries,setSummaries]=useState<Summary[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    let active=true
    void plannerData<{summaries:Summary[]}>('planner').then(result=>{if(active)setSummaries(result.summaries)})
      .catch(reason=>{if(active)setError(reason.message)})
    return ()=>{active=false}
  },[])
  const linked=pins.filter(pin=>pin.bagId===bagId)
  return <section className="bag-course-links" aria-label="Courses and plans">
    <div className="planner-heading"><div><h3>Courses &amp; plans</h3>
      <p className="bag-hint">Where you play this bag, and the choices you have prepared.</p></div>
      <button className="btn" disabled={busy} onClick={()=>onOpenCourses(bagId)}>Link another course</button>
    </div>
    {(pinsError||error)&&<p role="alert">{pinsError||error} <button className="btn" disabled={busy}
      onClick={()=>{void loadPins().catch(reason=>setError(reason.message));void plannerData<{summaries:Summary[]}>('planner')
        .then(result=>{setSummaries(result.summaries);setError('')}).catch(reason=>setError(reason.message))}}>Retry course links</button></p>}
    {courseError&&<p role="status">{courseError} Open Courses to retry loading directory details.</p>}
    {pinsLoading?<p role="status">Loading course links...</p>:!linked.length&&!pinsError?<p className="bag-hint">No courses linked to this bag yet.</p>:
      <ul className="bag-linked-courses">{linked.map(pin=>{
        const summary=summaries.find(s=>s.course_pin_id===pin.id)
        return <li key={pin.id}><div>
          <strong>{pin.courseId?.startsWith('pdga:')&&courseCache[pin.id]?.sourceUrl?
            <a href={courseCache[pin.id].sourceUrl!} target="_blank" rel="noopener noreferrer">{pin.courseName}</a>:pin.courseName}</strong>
          <p className="bag-hint">{summary?`${summary.layout_name} · ${summary.planned_count}/${summary.hole_count} holes planned`:'No private layout linked'}
            {pin.courseId?.startsWith('pdga:')&&` · PDGA ID ${pin.courseId.slice(5)}`}</p>
        </div><div className="planner-toolbar">
          <button className="btn" disabled={busy} onClick={()=>onOpenCourses(bagId,pin.id)}>Open plan</button>
          <button className="btn" disabled={busy} aria-label={`Unlink ${pin.courseName}`} onClick={()=>{
            if(!confirm('Unlink this course from this bag? Its game plan and old hole assignments will be deleted. The private layout remains.'))return
            setBusy(true);setError('')
            void deletePin(pin.id).catch(reason=>setError(reason.message)).finally(()=>setBusy(false))
          }}>Unlink course</button>
        </div></li>
      })}</ul>}
    {linked.some(pin=>pin.courseId?.startsWith('pdga:'))&&<p className="bag-hint">
      <a href="https://www.pdga.com/" target="_blank" rel="noopener noreferrer">Player, event, and course data provided by PDGA.</a>
    </p>}
  </section>
}
