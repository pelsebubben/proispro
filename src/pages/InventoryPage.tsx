import { useState, useMemo } from 'react'
import { useDiscs } from '../hooks/useDiscs'
import { useBags } from '../hooks/useBags'
import { ClientDisc, DiscDraft, DISC_TYPES, DiscFilters, filterAndSort, groupByType, SortOption } from '../utils/disc'
import { DiscCard } from '../components/DiscCard'
import { DiscList } from '../components/DiscList'
import { DiscModal } from '../components/DiscModal'

type InventoryView = 'cards' | 'list'

const VIEW_KEY = 'griplock.inventoryView'
// Each view starts on the order that suits it: newest first for cards, A-Z within each type for the list.
const VIEW_SORT: Record<InventoryView, SortOption> = { cards: 'added-desc', list: 'name-asc' }

function loadView(): InventoryView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

export function InventoryPage() {
  const { discs, isLoading, saveDisc, deleteDisc, setDiscQty } = useDiscs()
  const { bags, toggleDiscInBag } = useBags()

  const [view, setView] = useState<InventoryView>(loadView)
  const [filters, setFilters] = useState<DiscFilters>(() => ({
    search: '',
    filterType: '',
    filterBrand: '',
    filterBag: '',
    filterCondition: '',
    filterWeightMin: null,
    filterWeightMax: null,
    activeTagFilter: '',
    sortBy: VIEW_SORT[loadView()],
    groupBy: 'none',
  }))

  const [modalDisc, setModalDisc] = useState<ClientDisc | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Filter + sort + group (memoized for performance). The list groups by type itself.
  const filteredGroups = useMemo(
    () => filterAndSort(discs, bags, view === 'list' ? { ...filters, groupBy: 'none' } : filters),
    [discs, bags, filters, view]
  )
  const listGroups = useMemo(
    () => view === 'list' ? groupByType(filteredGroups[0].discs) : [],
    [view, filteredGroups]
  )

  const totalCount = discs.length
  const filteredCount = filteredGroups.reduce((sum, g) => sum + g.count, 0)
  const isEmpty = (view === 'list' ? listGroups : filteredGroups).every(g => g.discs.length === 0)

  const changeView = (next: InventoryView) => {
    if (next === view) return
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Private browsing can block storage; the choice then lasts for this visit only.
    }
    setFilters(previous => previous.sortBy === VIEW_SORT[view] ? { ...previous, sortBy: VIEW_SORT[next] } : previous)
  }

  const handleAddDisc = () => {
    setModalDisc(null)
    setShowModal(true)
  }

  const handleEditDisc = (disc: ClientDisc) => {
    setModalDisc(disc)
    setShowModal(true)
  }

  const handleSaveDisc = async (disc: DiscDraft) => {
    try {
      await saveDisc(disc)
      setShowModal(false)
    } catch (err) {
      throw err
    }
  }

  const handleDeleteDisc = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(null), 3000)
      return
    }
    try {
      await deleteDisc(id)
      setDeleteConfirm(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete disc')
    }
  }

  const handleQtyChange = async (disc: ClientDisc, delta: number) => {
    try {
      await setDiscQty(disc.id, disc.quantity + delta)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update quantity')
    }
  }

  const handleTagClick = (tag: string) => {
    setFilters({
      ...filters,
      activeTagFilter: filters.activeTagFilter === tag ? '' : tag,
    })
  }

  const toggleGroup = (label: string) => {
    const newCollapsed = new Set(collapsedGroups)
    if (newCollapsed.has(label)) {
      newCollapsed.delete(label)
    } else {
      newCollapsed.add(label)
    }
    setCollapsedGroups(newCollapsed)
  }

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--clr-muted)' }}>
        Loading discs...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Top row: search + add button */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="🔍 Search discs..."
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '0.65rem 1rem',
              background: 'var(--clr-surface)',
              border: '1px solid var(--clr-border)',
              borderRadius: 'var(--radius)',
              color: 'var(--clr-text)',
              fontSize: '0.9rem',
            }}
          />
          <button
            onClick={handleAddDisc}
            style={{
              padding: '0.65rem 1.25rem',
              background: 'var(--clr-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add Disc
          </button>
        </div>

        {/* Filter chips row */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setFilters({ ...filters, filterType: '' })}
            style={{
              padding: '0.45rem 0.85rem',
              background: !filters.filterType ? 'var(--clr-accent)' : 'var(--clr-surface)',
              color: !filters.filterType ? '#fff' : 'var(--clr-text)',
              border: '1px solid var(--clr-border)',
              borderRadius: 'var(--radius)',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            All
          </button>
          {DISC_TYPES.map(({ value: type, label }) => (
            <button
              key={type}
              onClick={() => setFilters({ ...filters, filterType: filters.filterType === type ? '' : type })}
              style={{
                padding: '0.45rem 0.85rem',
                background: filters.filterType === type ? `var(--${type})` : 'var(--clr-surface)',
                color: filters.filterType === type ? 'var(--clr-bg)' : 'var(--clr-text)',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius)',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* View + Sort + Group controls */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div role="group" aria-label="View" className="view-toggle">
            {(['cards', 'list'] as const).map(option => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => changeView(option)}>
                {option === 'cards' ? 'Cards' : 'List'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--clr-muted)' }}>Sort:</label>
            <select
              value={filters.sortBy}
              onChange={e => setFilters({ ...filters, sortBy: e.target.value as SortOption })}
              style={{
                padding: '0.45rem 0.75rem',
                background: 'var(--clr-surface)',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--clr-text)',
                fontSize: '0.85rem',
              }}
            >
              <option value="added-desc">Newest First</option>
              <option value="added-asc">Oldest First</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="type-asc">Type A-Z</option>
              <option value="speed-desc">Speed High-Low</option>
              <option value="speed-asc">Speed Low-High</option>
            </select>
          </div>

          {/* The list is always grouped by type, so it has no Group control */}
          <div style={{ display: view === 'cards' ? 'flex' : 'none', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--clr-muted)' }}>Group:</label>
            <select
              value={filters.groupBy}
              onChange={e => setFilters({ ...filters, groupBy: e.target.value as 'none' | 'type' | 'brand' | 'bag' })}
              style={{
                padding: '0.45rem 0.75rem',
                background: 'var(--clr-surface)',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--clr-text)',
                fontSize: '0.85rem',
              }}
            >
              <option value="none">None</option>
              <option value="type">Type</option>
              <option value="brand">Brand</option>
              <option value="bag">Bag</option>
            </select>
          </div>
        </div>

        {/* Active filters display */}
        {(filters.activeTagFilter || filters.filterBag || filters.filterCondition) && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--clr-muted)' }}>Active filters:</span>
            {filters.activeTagFilter && (
              <button
                onClick={() => setFilters({ ...filters, activeTagFilter: '' })}
                style={{
                  padding: '0.3rem 0.6rem',
                  background: 'var(--clr-accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                #{filters.activeTagFilter} ×
              </button>
            )}
          </div>
        )}
      </div>

      {/* Count display */}
      <div style={{ fontSize: '0.9rem', color: 'var(--clr-muted)' }}>
        {filteredCount === totalCount ? (
          <span>{totalCount} disc{totalCount !== 1 ? 's' : ''}</span>
        ) : (
          <span>
            {filteredCount} of {totalCount} disc{totalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Disc grid or list */}
      {isEmpty ? (
        <div
          style={{
            textAlign: 'center',
            padding: '4rem 1rem',
            color: 'var(--clr-muted)',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🥏</div>
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No discs yet</p>
          <p style={{ fontSize: '0.9rem' }}>Click + Add Disc to get started</p>
        </div>
      ) : view === 'list' ? (
        <DiscList groups={listGroups} onEdit={handleEditDisc} />
      ) : (
        filteredGroups.map(group => (
          <div key={group.label || 'all'}>
            {/* Group header */}
            {group.label && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => toggleGroup(group.label!)}
              >
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--clr-text)' }}>
                  {group.label} ({group.count})
                </h3>
                <span style={{ color: 'var(--clr-muted)', fontSize: '0.9rem' }}>
                  {collapsedGroups.has(group.label) ? '▶' : '▼'}
                </span>
              </div>
            )}

            {/* Grid */}
            {(!group.label || !collapsedGroups.has(group.label)) && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: '1rem',
                  marginBottom: filters.groupBy !== 'none' ? '2rem' : 0,
                }}
              >
                {group.discs.map(disc => (
                  <DiscCard
                    key={disc.id}
                    disc={disc}
                    bags={bags}
                    onEdit={() => handleEditDisc(disc)}
                    onDelete={() => handleDeleteDisc(disc.id)}
                    onToggleBag={bagId => toggleDiscInBag(bagId, disc.id, discs)}
                    onTagClick={handleTagClick}
                    onQtyChange={delta => handleQtyChange(disc, delta)}
                    activeTagFilter={filters.activeTagFilter}
                  />
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {/* Modals */}
      {showModal && (
        <DiscModal disc={modalDisc} onSave={handleSaveDisc} onClose={() => setShowModal(false)} />
      )}

      {deleteConfirm && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--clr-danger)',
            color: '#fff',
            padding: '1rem 1.5rem',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            fontSize: '0.9rem',
            zIndex: 100,
          }}
        >
          Click Delete again to confirm
        </div>
      )}
    </div>
  )
}
