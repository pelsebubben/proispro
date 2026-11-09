import { useEffect, useState } from 'react'
import { listRows } from '../lib/data'

export function BagCourseLinks({bagId,onOpenCourses}:{bagId:string;onOpenCourses:(bagId:string)=>void}) {
  const [count,setCount]=useState<number|null>(null)
  const [error,setError]=useState(false)
  useEffect(()=>{
    let active=true
    void listRows<{bag_id:string}>('course_pins').then(pins=>{
      if(active)setCount(pins.filter(pin=>pin.bag_id===bagId).length)
    }).catch(()=>{if(active)setError(true)})
    return ()=>{active=false}
  },[bagId])
  return <div className="bag-course-shortcut">
    <button className="btn" onClick={()=>onOpenCourses(bagId)}>
      Courses{count!==null?` (${count})`:''} &amp; plans
    </button>
    {error&&<span role="status" className="bag-hint">Course count unavailable. Open Courses to retry.</span>}
  </div>
}
