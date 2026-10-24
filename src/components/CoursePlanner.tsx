import { useEffect, useRef, useState, type FormEvent } from 'react'
import { plannerData, readCourseCatalogue } from '../lib/data'
import type { ClientPin } from '../hooks/useCoursePins'
import type { ClientBag, ClientDisc } from '../utils/disc'

export interface ManualHole {
  id: string; label: string; par: number | null; distance_m: number | null; notes: string
  tee?: string; target?: string; length?: number | null; units?: string
}
interface EventLayout {
  layout_id:string; tournament_id:string; name:string; hole_count:number; par:number|null
  length:number|null; units:string; event_name:string; event_date:string|null
}
export interface PrivateLayout {
  id: string; name: string; tee: string; basket: string; description: string; checked_on: string | null
  holes: ManualHole[]; version: number
  provider_ref?: {course_id:string;tournament_id:string;layout_id:string} | null
  provider_event?: EventLayout
  provider_error?: string
  expiresAt?: number
  private_name?: string | null
}
interface HolePlan { disc_ids: string[]; notes: string }
interface PrivatePlan { layout_id: string; selections: Record<string,HolePlan>; version: number }
interface PlannerState { layouts: PrivateLayout[]; plan: PrivatePlan | null; selected_plan?: PrivatePlan | null }
const emptyLayout = (): PrivateLayout => ({
  id: '', name: '', tee: '', basket: '', description: '', checked_on: null, holes: [], version: 0,
})
const emptyChoice = (): HolePlan => ({disc_ids:[],notes:''})

export function CoursePlanner({pin,bag,discs,onOpenBag}: {
  pin: ClientPin; bag: ClientBag | undefined; discs: ClientDisc[]; onOpenBag?: (id:string)=>void
}) {
  const [data,setData] = useState<PlannerState | null>(null)
  const [layoutId,setLayoutId] = useState('')
  const [draft,setDraft] = useState<PrivateLayout | null>(null)
  const [selections,setSelections] = useState<Record<string,HolePlan>>({})
  const [dirty,setDirty] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [events,setEvents] = useState<{layouts:EventLayout[];expiresAt:number}|null>(null)
  const [eventSelection,setEventSelection] = useState('')
  const [copyName,setCopyName] = useState<string|null>(null)
  const saving = useRef(false)
  const layout = data?.layouts.find(l=>l.id===layoutId)
  useEffect(()=>{
    const expiries=[...(events?[events.expiresAt]:[]),...(data?.layouts.flatMap(l=>l.expiresAt?[l.expiresAt]:[])??[])]
    if(!expiries.length)return
    const timer=setTimeout(()=>{
      const now=Date.now()
      setEvents(previous=>previous&&previous.expiresAt>now?previous:null)
      setData(previous=>previous?{...previous,layouts:previous.layouts.map(l=>l.expiresAt&&l.expiresAt<=now?
        {...l,name:l.private_name??'PDGA event layout',holes:[],provider_event:undefined,expiresAt:undefined,
          provider_error:'Cached event details expired. Reload saved plan to refresh; your disc choices are unchanged.'}:l)}:null)
    },Math.max(0,Math.min(...expiries)-Date.now()))
    return ()=>clearTimeout(timer)
  },[events,data])
  useEffect(()=>{
    if(!dirty&&!draft&&!copyName?.trim())return
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    const beforeNavigate=(event:Event)=>{if(!confirm('Leave without saving your private planner changes?'))event.preventDefault()}
    window.addEventListener('beforeunload',beforeUnload)
    window.addEventListener('griplock-before-navigation',beforeNavigate)
    return ()=>{
      window.removeEventListener('beforeunload',beforeUnload)
      window.removeEventListener('griplock-before-navigation',beforeNavigate)
    }
  },[dirty,draft,copyName])
  const load = async () => {
    const next = await plannerData<PlannerState>(`planner?pin_id=${pin.id}`)
    setData(next); setLayoutId(next.plan?.layout_id ?? '')
    setSelections(next.plan?.selections ?? {}); setDirty(false)
    return next
  }
  useEffect(()=>{
    let active=true
    void plannerData<PlannerState>(`planner?pin_id=${pin.id}`).then(next=>{
      if (!active) return
      setData(next); setLayoutId(next.plan?.layout_id ?? ''); setSelections(next.plan?.selections ?? {})
    }).catch(reason=>{if(active)setError(reason.message)})
    return ()=>{active=false}
  },[pin.id])
  const perform = async(action:()=>Promise<void>)=>{
    if(saving.current)return
    saving.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(reason){setError(reason instanceof Error?reason.message:'Could not save the plan. Retry after reloading.')}
    finally{saving.current=false;setBusy(false)}
  }
  const savePlan = async()=>{
    await plannerData(`planner/pins/${pin.id}`,'PUT',{layout_id:layoutId,version:data?.plan?.version??0,selections})
    await load();setNotice('Game plan saved.')
  }
  const selectLayout = async(selected:string)=>{
    const next=await plannerData<PlannerState>(`planner?pin_id=${pin.id}&layout_id=${selected}`)
    setData(next);setLayoutId(selected)
    setSelections(next.selected_plan?.selections??(selected===next.plan?.layout_id?next.plan.selections:{}))
    setDirty(selected!==(next.plan?.layout_id??''))
  }
  const updateChoice=(holeId:string,value:HolePlan)=>{
    setSelections(previous=>({...previous,[holeId]:value}));setDirty(true);setNotice('')
  }
  const progress = layout?.holes.filter(h=>selections[h.id]?.disc_ids.length).length??0
  const missing = new Set(Object.values(selections).flatMap(s=>s.disc_ids).filter(id=>!bag?.disc_ids.includes(id)))
  const saveDisabled = busy||!dirty||!!layout?.provider_error
  return <section className="course-planner" aria-label={`Private planner for ${pin.courseName}`}>
    <div className="planner-heading">
      <div><h3>Private layout &amp; game plan</h3><p className="bag-hint">Choose a historical event layout or enter your own. Disc choices and strategy stay private.</p></div>
      <div className="planner-toolbar" role="group" aria-label="Planner actions">
        {layout&&!draft&&<button className="btn btn-primary" disabled={saveDisabled}
          onClick={()=>void perform(savePlan)}>{busy?'Saving...':'Save game plan'}</button>}
        {bag&&onOpenBag&&<button className="btn" onClick={()=>onOpenBag(bag.id)}>Open bag: {bag.name}</button>}
      </div>
    </div>
    {error&&<div className="bag-feedback" role="alert">{error} <button className="btn" disabled={busy}
      onClick={()=>void perform(async()=>{await load();setDraft(null)})}>Reload saved plan</button></div>}
    {notice&&<p role="status">{notice}</p>}
    {!data&&!error&&<p role="status">Loading your layouts...</p>}
    {data&&<>
      {pin.courseId?.startsWith('pdga:')&&<div className="event-layout-picker">
        <button className="btn" disabled={busy||!!draft} onClick={()=>void perform(async()=>{
          const result=await readCourseCatalogue<{layouts:EventLayout[];expiresAt:number}>(`courses/${pin.courseId}/layouts`)
          setEvents(result)
          const first=result.layouts[0]
          setEventSelection(first?`${first.tournament_id}:${first.layout_id}`:'')
        })}>Browse PDGA event layouts</button>
        {events&&<>
          <p className="bag-hint">Layouts from the two most recent events at this course, newest first. Historical setups, not a guarantee of today&apos;s layout.</p>
          {!events.layouts.length?<p>No event layouts are available for this course. You can create a private layout instead.</p>:
          <div className="planner-toolbar">
            <label htmlFor={`event-${pin.id}`}>PDGA event layout</label><select id={`event-${pin.id}`} value={eventSelection} disabled={busy} onChange={e=>setEventSelection(e.target.value)}>
              <option value="">Choose an event and layout</option>
              {events.layouts.map(e=><option key={`${e.tournament_id}:${e.layout_id}`} value={`${e.tournament_id}:${e.layout_id}`}>
                {e.name} · {e.event_name} · {e.event_date??'Date unknown'} · {e.hole_count} holes · Par {e.par??'?'} · {e.length??'?'} {e.units}
              </option>)}
            </select>
            <button className="btn" disabled={busy||!eventSelection} onClick={()=>{
              if(dirty&&!confirm('Discard unsaved choices before selecting this event layout?'))return
              void perform(async()=>{
                if(events.expiresAt<=Date.now())throw new Error('Event list expired. Browse event layouts again.')
                const [tournament_id,layout_id]=eventSelection.split(':')
                const result=await plannerData<{layout:PrivateLayout}>('planner/event-layout','POST',
                  {course_pin_id:pin.id,tournament_id,layout_id})
                await selectLayout(result.layout.id)
                setNotice('Event layout selected. Choose discs and save the game plan to link it to this bag.')
              })
            }}>Use event layout</button>
          </div>}
        </>}
      </div>}
      <div className="planner-toolbar">
        <label>Layout<select aria-label="Layout" value={layoutId} disabled={busy||!!draft} onChange={event=>{
          if(dirty&&!confirm('Discard unsaved game-plan changes?'))return
          const selected=event.target.value
          setCopyName(null)
          if(!selected){setLayoutId('');setSelections({});setDirty(false);return}
          void perform(()=>selectLayout(selected))
          setNotice('')
        }}><option value="">Choose a private layout</option>
          {data.layouts.map(l=><option key={l.id} value={l.id}>{l.private_name??l.name}{l.private_name?' · Private game plan':l.provider_ref?` · Event ${l.provider_ref.tournament_id} / Layout ${l.provider_ref.layout_id}`:''}</option>)}
        </select></label>
        <button className="btn" disabled={busy||!!draft} onClick={()=>{
          if(!dirty||confirm('Discard unsaved game-plan changes before creating a layout?'))setDraft(emptyLayout())
        }}>Create private layout</button>
        {layout?.provider_ref&&<button className="btn" disabled={busy||!!draft||dirty} onClick={()=>setCopyName('')}>
          Duplicate &amp; rename
        </button>}
        {layout&&!layout.provider_ref&&<button className="btn" disabled={busy||!!draft} onClick={()=>{
          if(!dirty||confirm('Discard unsaved game-plan changes before editing the layout?'))setDraft(structuredClone(layout))
        }}>Edit layout</button>}
        {layout&&<button className="btn" disabled={busy||!!draft} onClick={()=>{
          if(confirm('Delete this private layout and discard unsaved game-plan changes? It must be unlinked from all game plans first. This cannot be undone.'))
            void perform(async()=>{await plannerData(`planner/layouts/${layout.id}`,'DELETE');await load();setNotice('Private layout deleted.')})
        }}>Delete layout</button>}
      </div>
      {copyName!==null&&layout?.provider_ref&&<form aria-label="Duplicate private game plan" className="course-search-form" onSubmit={event=>{
        event.preventDefault()
        void perform(async()=>{
          await plannerData('planner/duplicate','POST',{course_pin_id:pin.id,layout_id:layout.id,
            name:copyName.trim(),version:data.plan?.version??0})
          await load();setCopyName(null);setNotice('Private game plan created. Your saved disc choices were copied; the source plan is unchanged.')
        })
      }}>
        <label>Private game plan name<input required autoFocus maxLength={100} value={copyName} disabled={busy}
          onChange={event=>setCopyName(event.target.value)} placeholder="e.g. Ekeberg everyday rounds"/></label>
        <p className="bag-hint">Your name, saved disc choices and strategy are copied privately. PDGA holes still refresh from the 24-hour cache.
          This is not a permanent hole-layout snapshot.</p>
        <div className="planner-toolbar">
          <button className="btn btn-primary" disabled={busy||!copyName.trim()||dirty}>Create private game plan</button>
          <button type="button" className="btn" disabled={busy} onClick={()=>setCopyName(null)}>Cancel</button>
        </div>
      </form>}
      {layout?.provider_ref&&dirty&&!draft&&<p className="bag-hint">Save your changes before duplicating this game plan.</p>}
      {data.layouts.length===0&&!draft&&<p>Add holes from your own observations. Do not copy restricted course guides, maps or provider content.</p>}
      {draft?<LayoutEditor key={draft.id||'new'} initial={draft} busy={busy} onCancel={()=>setDraft(null)}
        onSave={value=>void perform(async()=>{
          const result=await plannerData<{layout:PrivateLayout}>(value.id?`planner/layouts/${value.id}`:'planner',
            value.id?'PUT':'POST',{course_pin_id:pin.id,version:value.version,name:value.name,tee:value.tee,
              basket:value.basket,description:value.description,checked_on:value.checked_on,holes:value.holes})
          const next=await load();          setData({...next,layouts:next.layouts.map(l=>l.id===result.layout.id?result.layout:l)})
          setLayoutId(result.layout.id)
          setSelections(next.plan?.layout_id===result.layout.id?next.plan.selections:{})
          setDirty(next.plan?.layout_id!==result.layout.id);setDraft(null)
          setNotice(next.plan?.layout_id===result.layout.id?'Layout updated. Existing game plans keep their remaining hole choices.':
            'Layout saved. Save the game plan to link it to this bag.')
        })}/>:layout&&<>
        <div className="planner-heading"><div>
          <h4>{layout.private_name??layout.name}</h4>
          {layout.private_name&&<p className="bag-hint">Private game plan · Your disc choices and strategy are independent of the source plan.</p>}
          {layout.provider_event?<p className="bag-hint">PDGA event: {layout.provider_event.event_name} · {layout.provider_event.event_date??'Date unknown'}
            {' '}· Par {layout.provider_event.par??'?'} · {layout.provider_event.length??'?'} {layout.provider_event.units}.
            {' '}This historical setup may differ from the current course.</p>:
          !layout.provider_ref&&<p className="bag-hint">{layout.tee||'Tee not specified'} · {layout.basket||'Basket not specified'}
            {layout.checked_on&&` · Checked ${layout.checked_on.slice(0,10)}`}</p>}
          {layout.description&&<p>{layout.description}</p>}
        </div><strong>{progress}/{layout.holes.length} holes planned</strong></div>
        {missing.size>0&&<p className="bag-feedback" role="status">{missing.size} selected {missing.size===1?'disc is':'discs are'} missing from this bag. Add them in Bags or change your selections.</p>}
        {layout.provider_error&&<p role="alert">{layout.provider_error} <button className="btn" disabled={busy}
          onClick={()=>{if(!dirty||confirm('Reload saved choices and discard unsaved changes?'))void perform(async()=>{await load()})}}>Reload saved plan</button></p>}
        {!layout.holes.length&&!layout.provider_ref&&<p>This layout has no holes yet. Edit the layout to add your first hole.</p>}
        {Object.keys(selections).some(id=>!layout.holes.some(h=>h.id===id))&&<p role="status">
          Some saved choices refer to holes not present in the available layout. They are retained, not reassigned to another hole.</p>}
        <ol className="planner-holes">{layout.holes.map((hole,index)=>{
          const choice=selections[hole.id]??emptyChoice()
          const selectedDiscs=choice.disc_ids.map(id=>discs.find(d=>d.id===id)).filter((d):d is ClientDisc=>!!d)
          return <li key={hole.id} className="planner-hole">
            <div><h4>Hole {hole.label}</h4><p className="bag-hint">{hole.par===null?'Par unknown':`Par ${hole.par}`} · {hole.distance_m===null?'Distance unknown':
              hole.units==='Feet'?`${hole.length} ft (${hole.distance_m} m)`:`${hole.distance_m} m`}</p>
              {(hole.tee||hole.target)&&<p className="bag-hint">Tee: {hole.tee||'Not specified'} · Target: {hole.target||'Not specified'}</p>}
              {hole.notes&&<p>{hole.notes}</p>}
            </div>
            <div className="planner-hole-plan">
              <ol className="planner-choices">{selectedDiscs.map((disc,i)=><li key={disc.id}>
                <span>{i===0?'Primary':'Alternative'}: {disc.name}{!bag?.disc_ids.includes(disc.id)&&' · Not in bag'}</span>
                <button className="btn" disabled={busy||i===0} aria-label={`Make ${disc.name} primary on hole ${hole.label}`}
                  onClick={()=>updateChoice(hole.id,{...choice,disc_ids:[disc.id,...choice.disc_ids.filter(id=>id!==disc.id)]})}>Make primary</button>
                <button className="btn" disabled={busy} aria-label={`Remove ${disc.name} from hole ${hole.label}`}
                  onClick={()=>updateChoice(hole.id,{...choice,disc_ids:choice.disc_ids.filter(id=>id!==disc.id)})}>Remove</button>
              </li>)}</ol>
              <label htmlFor={`disc-${pin.id}-${hole.id}`}>Add disc for hole {hole.label}</label>
              <select id={`disc-${pin.id}-${hole.id}`} value="" disabled={busy||choice.disc_ids.length>=12}
                onChange={event=>{if(event.target.value)updateChoice(hole.id,{...choice,disc_ids:[...choice.disc_ids,event.target.value]})}}>
                <option value="">Choose from your inventory</option>
                {[...discs].sort((a,b)=>Number(!!bag?.disc_ids.includes(b.id))-Number(!!bag?.disc_ids.includes(a.id))||a.name.localeCompare(b.name))
                  .filter(d=>!choice.disc_ids.includes(d.id)).map(d=><option key={d.id} value={d.id}>{d.name}{bag?.disc_ids.includes(d.id)?' · In bag':' · Not in bag'}</option>)}
              </select>
              <label htmlFor={`strategy-${pin.id}-${hole.id}`}>Strategy for hole {hole.label}</label>
              <textarea id={`strategy-${pin.id}-${hole.id}`} value={choice.notes} maxLength={1000} disabled={busy}
                placeholder={index===0?'e.g. Forehand to the safe landing zone':''}
                onChange={event=>updateChoice(hole.id,{...choice,notes:event.target.value})}/>
            </div>
          </li>
        })}</ol>
        <div className="planner-toolbar">
          <button className="btn btn-primary" disabled={saveDisabled} onClick={()=>void perform(savePlan)}>{busy?'Saving...':'Save game plan'}</button>
          {dirty&&<span role="status">Unsaved changes</span>}
          {data.plan?.layout_id===layout.id&&<button className="btn" disabled={busy} onClick={()=>{
            if(confirm('Unlink this layout and remove this bag’s private hole choices? The layout stays available.'))
              void perform(async()=>{await plannerData(`planner/pins/${pin.id}`,'DELETE');await load();setNotice('Layout unlinked.')})
          }}>Unlink layout</button>}
        </div>
      </>}
    </>}
  </section>
}

function LayoutEditor({initial,busy,onSave,onCancel}:{initial:PrivateLayout;busy:boolean;onSave:(value:PrivateLayout)=>void;onCancel:()=>void}) {
  const [draft,setDraft]=useState(initial)
  const [rights,setRights]=useState(false)
  const updateHole=(id:string,update:Partial<ManualHole>)=>setDraft(previous=>({...previous,holes:previous.holes.map(h=>h.id===id?{...h,...update}:h)}))
  const move=(index:number,delta:number)=>setDraft(previous=>{
    const holes=[...previous.holes];[holes[index],holes[index+delta]]=[holes[index+delta],holes[index]]
    return {...previous,holes}
  })
  const submit=(event:FormEvent)=>{event.preventDefault();if(rights)onSave(draft)}
  return <form className="layout-editor" onSubmit={submit}>
    <fieldset disabled={busy}><legend>{draft.id?'Edit private layout':'New private layout'}</legend>
      <div className="planner-fields">
        <label>Layout name<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>Tee variant<input maxLength={100} value={draft.tee} placeholder="e.g. Short tees" onChange={e=>setDraft({...draft,tee:e.target.value})}/></label>
        <label>Basket variant<input maxLength={100} value={draft.basket} onChange={e=>setDraft({...draft,basket:e.target.value})}/></label>
        <label>Date checked<input type="date" value={draft.checked_on?.slice(0,10)??''} onChange={e=>setDraft({...draft,checked_on:e.target.value||null})}/></label>
      </div>
      <label>Description<textarea maxLength={1000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <p className="bag-hint">Layouts are private and reusable across your bag links for this course. Edits affect those links; deleting a hole removes its saved choices.</p>
      <ol className="layout-edit-holes">{draft.holes.map((hole,index)=><li key={hole.id}>
        <div className="planner-fields">
          <label>Hole label<input required maxLength={40} value={hole.label} onChange={e=>updateHole(hole.id,{label:e.target.value})}/></label>
          <label>Par<input type="number" min={1} max={15} step={1} value={hole.par??''} onChange={e=>updateHole(hole.id,{par:e.target.value?Number(e.target.value):null})}/></label>
          <label>Distance (m)<input type="number" min={0.1} max={3000} step="any" value={hole.distance_m??''} onChange={e=>updateHole(hole.id,{distance_m:e.target.value?Number(e.target.value):null})}/></label>
          <label>Hole notes<input maxLength={500} value={hole.notes} onChange={e=>updateHole(hole.id,{notes:e.target.value})}/></label>
        </div>
        <div className="planner-toolbar">
          <button type="button" className="btn" aria-label={`Move hole ${hole.label} up`} disabled={index===0} onClick={()=>move(index,-1)}>Move up</button>
          <button type="button" className="btn" aria-label={`Move hole ${hole.label} down`} disabled={index===draft.holes.length-1} onClick={()=>move(index,1)}>Move down</button>
          <button type="button" className="btn" onClick={()=>{
            if(confirm(`Remove hole ${hole.label}? Its saved disc choices will be removed when you save the layout.`))
              setDraft({...draft,holes:draft.holes.filter(h=>h.id!==hole.id)})
          }}>Remove hole {hole.label}</button>
        </div>
      </li>)}</ol>
      <button type="button" className="btn" disabled={draft.holes.length>=72} onClick={()=>setDraft({...draft,holes:[...draft.holes,
        {id:crypto.randomUUID(),label:String(draft.holes.length+1),par:null,distance_m:null,notes:''}]})}>+ Add hole</button>
      <label className="planner-consent"><input type="checkbox" required checked={rights} onChange={e=>setRights(e.target.checked)}/>
        I entered my own observations or information I have permission to use, not copied restricted provider content.</label>
      <div className="planner-toolbar"><button type="submit" className="btn btn-primary" disabled={!rights}>{busy?'Saving...':'Save layout'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel layout edit</button></div>
    </fieldset>
  </form>
}
