import { useState } from 'react'
import { useDiscs } from '../hooks/useDiscs'
import { useBags } from '../hooks/useBags'
import { BagCard } from '../components/BagCard'
import { BagPopout } from '../components/BagPopout'
import { DiscPickerModal } from '../components/DiscPickerModal'
import { ClientBag } from '../utils/disc'

export function BagsPage() {
  const { discs } = useDiscs()
  const { bags, createBag, renameBag, deleteBag, toggleDiscInBag, removeDiscFromBag, loadBagHistory } = useBags()

  const [expandedBagId, setExpandedBagId] = useState<string | null>(null)
  const [popoutBag, setPopoutBag] = useState<ClientBag | null>(null)
  const [pickerBagId, setPickerBagId] = useState<string | null>(null)
  const pickerBag = bags.find(bag => bag.id === pickerBagId)
  const [renamingBag, setRenamingBag] = useState<ClientBag | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleCreateBag = () => {
    const name = prompt('Enter bag name:')
    if (name && name.trim()) {
      createBag(name.trim())
    }
  }

  const handleRename = (bag: ClientBag) => {
    setRenamingBag(bag)
    setRenameValue(bag.name)
  }

  const handleRenameConfirm = () => {
    if (renamingBag && renameValue.trim()) {
      renameBag(renamingBag.id, renameValue.trim())
      setRenamingBag(null)
      setRenameValue('')
    }
  }

  const handleDelete = (bag: ClientBag) => {
    if (confirm(`Delete "${bag.name}"? This cannot be undone.`)) {
      deleteBag(bag.id)
    }
  }

  const handleRemoveDisc = (bagId: string, discId: string) => {
    const disc = discs.find(d => d.id === discId)
    if (disc) {
      removeDiscFromBag(bagId, discId, disc.name)
    }
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ margin: 0, color: 'var(--clr-text)' }}>
          👜 {bags.length} {bags.length === 1 ? 'bag' : 'bags'}
        </h2>
        <button
          onClick={handleCreateBag}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--clr-accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          + Create Bag
        </button>
      </div>

      {/* Empty state */}
      {bags.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: 'var(--clr-surface)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--clr-border)',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👜</div>
          <div style={{ color: 'var(--clr-text)', fontSize: '1.25rem', fontWeight: 600 }}>
            No bags yet
          </div>
          <div style={{ color: 'var(--clr-muted)', marginTop: '0.5rem' }}>
            Create your first bag to organize your discs!
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {bags.map(bag => (
            <BagCard
              key={bag.id}
              bag={bag}
              allDiscs={discs}
              isExpanded={expandedBagId === bag.id}
              onToggleExpand={() => setExpandedBagId(expandedBagId === bag.id ? null : bag.id)}
              onRename={() => handleRename(bag)}
              onDelete={() => handleDelete(bag)}
              onOpenDiscPicker={() => setPickerBagId(bag.id)}
              onOpenPopout={() => setPopoutBag(bag)}
              onRemoveDisc={discId => handleRemoveDisc(bag.id, discId)}
              loadBagHistory={loadBagHistory}
            />
          ))}
        </div>
      )}

      {/* Popout modal */}
      {popoutBag && (
        <BagPopout bag={popoutBag} allDiscs={discs} onClose={() => setPopoutBag(null)} />
      )}

      {/* Disc picker modal */}
      {pickerBag && (
        <DiscPickerModal
          bag={pickerBag}
          allDiscs={discs}
          onToggle={discId => toggleDiscInBag(pickerBag.id, discId, discs)}
          onClose={() => setPickerBagId(null)}
        />
      )}

      {/* Rename modal */}
      {renamingBag && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setRenamingBag(null)}
        >
          <div
            style={{
              background: 'var(--clr-surface)',
              borderRadius: 'var(--radius)',
              padding: '1.5rem',
              width: '400px',
              maxWidth: '90vw',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: 'var(--clr-text)' }}>Rename Bag</h3>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRenameConfirm()
                if (e.key === 'Escape') setRenamingBag(null)
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'var(--clr-surface2)',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--clr-text)',
                fontSize: '1rem',
                marginBottom: '1rem',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRenamingBag(null)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--clr-surface2)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  color: 'var(--clr-text)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRenameConfirm}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--clr-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
