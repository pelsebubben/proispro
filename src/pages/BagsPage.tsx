import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useDiscs } from '../hooks/useDiscs'
import { useBags, formatHistoryTime, type BagHistoryEntry } from '../hooks/useBags'
import { DiscList } from '../components/DiscList'
import { BagCourseLinks } from '../components/BagCourseLinks'
import { FlightChart } from '../components/FlightChart'
import { ClientBag, DISC_TYPES, DiscFilters, filterAndSort, groupByType, SortOption } from '../utils/disc'

const initialFilters: DiscFilters = {
  search: '', filterType: '', filterBrand: '', filterBag: '', filterCondition: '',
  filterWeightMin: null, filterWeightMax: null, activeTagFilter: '', sortBy: 'name-asc', groupBy: 'none',
}

export function BagsPage({initialBagId,onOpenCourses}:{initialBagId?:string;onOpenCourses?:(bagId:string,pinId?:string)=>void}) {
  const { discs, isLoading: discsLoading, error: discsError, loadDiscs } = useDiscs()
  const { bags, isLoading, error: bagsError, loadBags, createBag, renameBag, deleteBag, toggleDiscInBag, loadBagHistory } = useBags()
  const [selectedId, setSelectedId] = useState<string | null>(initialBagId??null)
  const [scope, setScope] = useState<'bag' | 'inventory'>('bag')
  const [filters, setFilters] = useState(initialFilters)
  const [nameForm, setNameForm] = useState<{ bag?: ClientBag } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [history, setHistory] = useState<BagHistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const createButton = useRef<HTMLButtonElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const sortedBags = [...bags].sort((a, b) => a.name.localeCompare(b.name))
  const bag = bags.find(b => b.id === selectedId) ?? sortedBags[0]
  const bagDiscs = useMemo(() => discs.filter(disc => bag?.disc_ids.includes(disc.id)), [discs, bag])
  const filteredDiscs = useMemo(() => filterAndSort(scope === 'bag' ? bagDiscs : discs, [], filters)[0].discs,
    [scope, bagDiscs, discs, filters])
  const groups = useMemo(() => groupByType(filteredDiscs), [filteredDiscs])

  useEffect(() => {
    setHistory(null)
    setShowChart(false)
    setDeleteConfirm(false)
    setError(null)
  }, [bag?.id])

  const closeNameForm = () => {
    const target = nameForm?.bag ? renameButton.current : createButton.current
    setNameForm(null)
    requestAnimationFrame(() => target?.focus())
  }

  const saveName = async (name: string) => {
    if (nameForm?.bag) {
      await renameBag(nameForm.bag.id, name)
    } else {
      const created = await createBag(name)
      setSelectedId(created.id)
      setScope('inventory')
      setFilters(initialFilters)
    }
    closeNameForm()
  }

  const perform = async (action: () => Promise<void>) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      setHistory(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your bag. Please try again.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const toggleHistory = async () => {
    if (history) { setHistory(null); return }
    if (!bag) return
    setHistoryLoading(true)
    setError(null)
    try {
      setHistory(await loadBagHistory(bag.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load bag history. Please try again.')
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div className="bags-page">
      <div className="bags-toolbar">
        <div className="bag-selector">
          <label htmlFor="selected-bag">Bag configuration</label>
          <select id="selected-bag" value={bag?.id ?? ''} disabled={busy || historyLoading || !!nameForm || !bags.length}
            onChange={event => { setSelectedId(event.target.value); setFilters(initialFilters) }}>
            {!bags.length && <option value="">No bags yet</option>}
            {sortedBags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <button ref={createButton} className="btn btn-primary" disabled={busy || historyLoading || !!nameForm || isLoading || !!bagsError}
          onClick={() => { setNameForm({}); setDeleteConfirm(false) }}>+ Create Bag</button>
      </div>

      {nameForm && <BagNameForm key={nameForm.bag?.id ?? 'new'} bag={nameForm.bag} onSave={saveName} onClose={closeNameForm} />}

      {(bagsError || discsError) ? (
        <div className="bag-feedback" role="alert">
          <p>{bagsError || discsError}</p>
          <button className="btn" onClick={() => { void loadBags(); void loadDiscs() }}>Retry loading</button>
        </div>
      ) : isLoading || discsLoading ? (
        <p className="bag-hint" role="status">Loading bags and inventory...</p>
      ) : !bag ? (
        !nameForm && <div className="bag-empty">
          <h2>No bags yet</h2>
          <p>Create a configuration, then choose discs from your inventory.</p>
          <p>The same disc can be included in more than one bag.</p>
        </div>
      ) : (
        <>
          <div className="bag-heading">
            <div>
              <h2>{bag.name}</h2>
              <p className="bag-hint">{bagDiscs.length} {bagDiscs.length === 1 ? 'disc' : 'discs'} in this configuration</p>
            </div>
            <div className="bag-actions">
              <button ref={renameButton} className="btn" disabled={busy || !!nameForm}
                onClick={() => { setNameForm({ bag }); setDeleteConfirm(false) }}>Rename</button>
              <button className="btn" disabled={busy || historyLoading || !!nameForm}
                aria-expanded={showChart} onClick={() => setShowChart(!showChart)}>Flight chart</button>
              <button className="btn" disabled={busy || historyLoading || !!nameForm}
                aria-expanded={history !== null} onClick={() => void toggleHistory()}>{historyLoading ? 'Loading history...' : 'History'}</button>
              <button className="btn bag-delete" disabled={busy || historyLoading || !!nameForm}
                aria-expanded={deleteConfirm} onClick={() => setDeleteConfirm(!deleteConfirm)}>Delete bag</button>
            </div>
          </div>

          {deleteConfirm && <section className="bag-feedback" aria-label="Confirm bag deletion">
            <p>Delete &ldquo;{bag.name}&rdquo;? Its course links and history will also be removed. Your inventory discs will not be deleted.</p>
            <div className="bag-actions">
              <button className="btn" autoFocus disabled={busy} onClick={() => setDeleteConfirm(false)}>Cancel</button>
              <button className="btn bag-delete" disabled={busy} onClick={() => void perform(async () => {
                await deleteBag(bag.id)
                setSelectedId(null)
                setDeleteConfirm(false)
              })}>{busy ? 'Deleting...' : 'Delete configuration'}</button>
            </div>
          </section>}

          {error && <p className="bag-feedback" role="alert">{error}</p>}
          {showChart && <section aria-label="Bag flight chart"><FlightChart discs={bagDiscs} /></section>}
          {history && <section className="bag-history" aria-label="Bag history">
            <h3>Recent changes</h3>
            {history.length ? <ul>{history.map(entry => <li key={entry.id}>
              <span>{entry.action === 'added' ? 'Added' : 'Removed'} {entry.disc_name}</span>
              <time dateTime={entry.changed_at}>{formatHistoryTime(entry.changed_at)}</time>
            </li>)}</ul> : <p className="bag-hint">No changes recorded yet.</p>}
          </section>}

          <div className="bag-disc-toolbar">
            <input aria-label="Search discs" placeholder="Search discs..." value={filters.search}
              onChange={event => setFilters({ ...filters, search: event.target.value })} />
            <div className="bag-type-filters" role="group" aria-label="Disc type">
              {[{ value: '', label: 'All' }, ...DISC_TYPES].map(type => (
                <button key={type.value} type="button" aria-pressed={filters.filterType === type.value}
                  style={filters.filterType === type.value && type.value ? { background: `var(--${type.value})`, color: 'var(--clr-bg)' } : undefined}
                  onClick={() => setFilters({ ...filters, filterType: type.value })}>{type.label}</button>
              ))}
            </div>
            <div className="bag-list-controls">
              <div className="view-toggle" role="group" aria-label="Disc selection">
                <button type="button" aria-pressed={scope === 'bag'} onClick={() => setScope('bag')}>In this bag ({bagDiscs.length})</button>
                <button type="button" aria-pressed={scope === 'inventory'} onClick={() => setScope('inventory')}>All inventory ({discs.length})</button>
              </div>
              <label className="bag-sort">Sort:
                <select value={filters.sortBy} onChange={event => setFilters({ ...filters, sortBy: event.target.value as SortOption })}>
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="speed-desc">Speed High-Low</option>
                  <option value="speed-asc">Speed Low-High</option>
                  <option value="added-desc">Newest First</option>
                  <option value="added-asc">Oldest First</option>
                </select>
              </label>
              {onOpenCourses&&<BagCourseLinks key={`courses-${bag.id}`} bagId={bag.id} onOpenCourses={onOpenCourses}/>}
            </div>
          </div>
          <div className="bag-list-status">
            <p className="bag-hint">{scope === 'inventory' ? 'Check discs to include them in this bag. Uncheck to remove; your inventory stays unchanged.' : 'Choose All inventory to add discs. Uncheck a disc to remove it from this bag.'}</p>
            <span role="status">{busy ? 'Saving...' : `${filteredDiscs.length} shown · ${bagDiscs.length} in bag`}</span>
          </div>
          {groups.length ? <DiscList key={bag.id} groups={groups} membership={{
            bagName: bag.name, selectedIds: bag.disc_ids, disabled: busy || !!nameForm || historyLoading,
            onToggle: disc => void perform(() => toggleDiscInBag(bag.id, disc.id, discs)),
          }} /> : <div className="bag-empty">
            <h3>{filters.search || filters.filterType ? 'No matching discs' : scope === 'bag' ? 'This bag is empty' : 'Your inventory is empty'}</h3>
            <p>{filters.search || filters.filterType ? 'Try a different search or disc type.' : scope === 'bag' ? 'Choose All inventory to start adding discs.' : 'Add discs in Inventory, then return here to build your bag.'}</p>
          </div>}
        </>
      )}
    </div>
  )
}

function BagNameForm({ bag, onSave, onClose }: {
  bag?: ClientBag
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(bag?.name ?? '')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving.current || !name.trim()) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      await onSave(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your bag. Please try again.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <form className="bag-name-form" aria-labelledby="bag-form-title" onSubmit={event => void submit(event)}
      onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }}>
      <h3 id="bag-form-title">{bag ? 'Rename Bag' : 'Create Bag'}</h3>
      <label htmlFor="bag-name">Bag name</label>
      <div className="bag-name-fields">
        <input id="bag-name" autoFocus required maxLength={200} value={name} disabled={busy}
          placeholder="e.g. Main bag or Wooded course" onChange={event => setName(event.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving...' : bag ? 'Save name' : 'Create bag'}</button>
        <button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {error && <p role="alert">{error} Your name has been kept; try saving again.</p>}
    </form>
  )
}
