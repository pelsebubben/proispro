import { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogDisc, useDiscCatalog } from '../hooks/useDiscCatalog'
import { ClientDisc, colorSlug } from '../utils/disc'

interface DiscModalProps {
  disc?: ClientDisc | null
  onSave: (disc: Omit<ClientDisc, 'id'> & { id?: string }) => Promise<void>
  onClose: () => void
}

const DISC_TYPES = [
  { value: 'putter', label: 'Putter' },
  { value: 'midrange', label: 'Midrange' },
  { value: 'fairway', label: 'Fairway Driver' },
  { value: 'distance', label: 'Distance Driver' },
]

const CONDITION_OPTIONS = [
  { value: 'new', label: 'New/Mint' },
  { value: 'good', label: 'Good' },
  { value: 'used', label: 'Used' },
  { value: 'beat', label: 'Beat-in' },
]

const COLOR_SWATCHES = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
  'White',
  'Black',
  'Yellow-Green',
  'Teal',
  'Crimson',
]

const NAME_SUGGESTION_LIMIT = 8
const NAME_SUGGESTIONS_ID = 'disc-name-suggestions'

export function DiscModal(props: DiscModalProps) {
  return <DiscForm key={props.disc?.id ?? 'new'} {...props} />
}

function DiscForm({ disc, onSave, onClose }: DiscModalProps) {
  const [form, setForm] = useState(() => ({
    name: disc?.name ?? '',
    manufacturer: disc?.manufacturer ?? '',
    type: disc?.type ?? '',
    plastic: disc?.plastic ?? '',
    weight: disc?.weight ?? '',
    quantity: disc?.quantity ?? 1,
    color: disc?.color ?? '',
    condition: disc?.condition ?? 'good',
    speed: disc?.speed ?? '',
    glide: disc?.glide ?? '',
    turn: disc?.turn ?? '',
    fade: disc?.fade ?? '',
    notes: disc?.notes ?? '',
    tags: disc?.tags ?? [],
  }))
  const [tagInput, setTagInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const { catalog, isLoading: isCatalogLoading } = useDiscCatalog()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const nameFieldRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const suggestions = useMemo(() => {
    const query = form.name.trim().toLowerCase()
    if (!query) return []

    return catalog
      .filter(item => item.name.toLowerCase().includes(query))
      .slice(0, NAME_SUGGESTION_LIMIT)
  }, [catalog, form.name])

  const shouldShowSuggestionMenu = showSuggestions && dropdownPos !== null && (isCatalogLoading || suggestions.length > 0)

  const updateDropdownPos = () => {
    if (nameInputRef.current) {
      const rect = nameInputRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  const closeSuggestions = () => {
    setShowSuggestions(false)
    setActiveSuggestion(-1)
    setDropdownPos(null)
  }

  useEffect(() => {
    setActiveSuggestion(-1)
  }, [form.name, suggestions.length])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (nameFieldRef.current && !nameFieldRef.current.contains(event.target as Node)) {
        closeSuggestions()
      }
    }

    document.addEventListener('click', handleDocumentClick)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [])

  useEffect(() => {
    if (!showSuggestions) return

    const close = () => {
      closeSuggestions()
    }

    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [showSuggestions])

  const selectSuggestion = (selectedDisc: CatalogDisc) => {
    if (disc) {
      setForm(prev => ({ ...prev, name: selectedDisc.name }))
    } else {
      setForm(prev => ({
        ...prev,
        name: selectedDisc.name,
        manufacturer: selectedDisc.brand,
        type: selectedDisc.type,
        speed: selectedDisc.speed,
        glide: selectedDisc.glide,
        turn: selectedDisc.turn,
        fade: selectedDisc.fade,
      }))
    }

    closeSuggestions()
  }

  const handleNameChange = (value: string) => {
    const shouldOpen = value.trim().length > 0

    setForm(prev => ({ ...prev, name: value }))
    setActiveSuggestion(-1)

    if (shouldOpen) {
      updateDropdownPos()
      setShowSuggestions(true)
      return
    }

    closeSuggestions()
  }

  const handleNameFocus = () => {
    if (form.name.trim().length > 0) {
      updateDropdownPos()
      setShowSuggestions(true)
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return
      e.preventDefault()
      updateDropdownPos()
      setShowSuggestions(true)
      setActiveSuggestion(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
      return
    }

    if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      e.preventDefault()
      updateDropdownPos()
      setShowSuggestions(true)
      setActiveSuggestion(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
      return
    }

    if (e.key === 'Enter' && showSuggestions && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      e.preventDefault()
      selectSuggestion(suggestions[activeSuggestion])
      return
    }

    if (e.key === 'Escape') {
      closeSuggestions()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.type) {
      alert('Name and Type are required')
      return
    }
    setIsSaving(true)
    try {
      await onSave({
        ...(disc?.id ? { id: disc.id } : {}),
        ...form,
        photo_url: disc?.photo_url || null,
        added: disc?.added || Date.now(),
      } as Omit<ClientDisc, 'id'> & { id?: string })
      onClose()
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? JSON.stringify(err)
      alert('Save failed: ' + msg)
    } finally {
      setIsSaving(false)
    }
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] })
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter(t => t !== tag) })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--clr-surface)',
          borderRadius: 'var(--radius)',
          padding: '1.5rem',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 1.5rem 0', color: 'var(--clr-text)' }}>
          {disc ? 'Edit Disc' : 'Add Disc'}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Name */}
          <div ref={nameFieldRef}>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Disc Name <span style={{ color: 'var(--clr-danger)' }}>*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              onFocus={handleNameFocus}
              onKeyDown={handleNameKeyDown}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={shouldShowSuggestionMenu}
              aria-controls={NAME_SUGGESTIONS_ID}
              aria-activedescendant={
                activeSuggestion >= 0 ? `${NAME_SUGGESTIONS_ID}-${activeSuggestion}` : undefined
              }
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--clr-bg)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                color: 'var(--clr-text)',
                fontSize: '0.9rem',
              }}
            />
            {shouldShowSuggestionMenu && (
              <div
                id={NAME_SUGGESTIONS_ID}
                role="listbox"
                style={{
                  position: 'fixed',
                  top: dropdownPos?.top ?? 0,
                  left: dropdownPos?.left ?? 0,
                  width: dropdownPos?.width ?? 0,
                  zIndex: 1100,
                  maxHeight: '240px',
                  overflowY: 'auto',
                  background: 'var(--clr-surface)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  boxShadow: '0 12px 24px rgba(0, 0, 0, 0.22)',
                }}
              >
                {isCatalogLoading ? (
                  <div
                    style={{
                      padding: '0.65rem 0.75rem',
                      color: 'var(--clr-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    Loading catalog…
                  </div>
                ) : (
                  suggestions.map((suggestion, index) => {
                    const isActive = index === activeSuggestion
                    return (
                      <div
                        key={suggestion.id || `${suggestion.brand}-${suggestion.name}-${index}`}
                        id={`${NAME_SUGGESTIONS_ID}-${index}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onMouseDown={e => {
                          e.preventDefault()
                          selectSuggestion(suggestion)
                        }}
                        style={{
                          padding: '0.65rem 0.75rem',
                          background: isActive ? 'var(--clr-surface2)' : 'var(--clr-surface)',
                          borderLeft: isActive ? '2px solid var(--clr-accent)' : '2px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 600, color: 'var(--clr-text)' }}>{suggestion.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--clr-muted)' }}>{suggestion.brand}</div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Manufacturer */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Manufacturer
            </label>
            <input
              type="text"
              value={form.manufacturer}
              onChange={e => setForm({ ...form, manufacturer: e.target.value })}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--clr-bg)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                color: 'var(--clr-text)',
                fontSize: '0.9rem',
              }}
            />
          </div>

          {/* Type */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Type <span style={{ color: 'var(--clr-danger)' }}>*</span>
            </label>
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--clr-bg)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                color: 'var(--clr-text)',
                fontSize: '0.9rem',
              }}
            >
              <option value="">Select type...</option>
              {DISC_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Plastic + Weight */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
                Plastic
              </label>
              <input
                type="text"
                value={form.plastic}
                onChange={e => setForm({ ...form, plastic: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: 'var(--clr-bg)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  color: 'var(--clr-text)',
                  fontSize: '0.9rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
                Weight (g)
              </label>
              <input
                type="number"
                value={form.weight}
                onChange={e => setForm({ ...form, weight: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: 'var(--clr-bg)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  color: 'var(--clr-text)',
                  fontSize: '0.9rem',
                }}
              />
            </div>
          </div>

          {/* Copies */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Copies
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setForm({ ...form, quantity: Math.max(1, form.quantity - 1) })}
                disabled={form.quantity <= 1}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'var(--clr-surface2)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  cursor: form.quantity > 1 ? 'pointer' : 'not-allowed',
                  opacity: form.quantity <= 1 ? 0.5 : 1,
                }}
              >
                −
              </button>
              <span style={{ fontSize: '1rem', minWidth: '40px', textAlign: 'center' }}>
                {form.quantity}
              </span>
              <button
                type="button"
                onClick={() => setForm({ ...form, quantity: form.quantity + 1 })}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'var(--clr-surface2)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Color swatches */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--clr-text)' }}>
              Color
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {COLOR_SWATCHES.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, color })}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: `var(--disc-${colorSlug(color)})`,
                    border: form.color === color ? '3px solid var(--clr-accent)' : '2px solid var(--clr-border)',
                    cursor: 'pointer',
                  }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Condition */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Condition
            </label>
            <select
              value={form.condition}
              onChange={e => setForm({ ...form, condition: e.target.value })}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--clr-bg)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                color: 'var(--clr-text)',
                fontSize: '0.9rem',
              }}
            >
              {CONDITION_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Flight numbers */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--clr-text)' }}>
              Flight Numbers
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
              {[
                { key: 'speed', label: 'Speed' },
                { key: 'glide', label: 'Glide' },
                { key: 'turn', label: 'Turn' },
                { key: 'fade', label: 'Fade' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--clr-muted)' }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      background: 'var(--clr-bg)',
                      border: '1px solid var(--clr-border)',
                      borderRadius: '6px',
                      color: 'var(--clr-text)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--clr-bg)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                color: 'var(--clr-text)',
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Tags */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Tags
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="Add tag..."
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  background: 'var(--clr-bg)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: '6px',
                  color: 'var(--clr-text)',
                  fontSize: '0.9rem',
                }}
              />
              <button
                type="button"
                onClick={addTag}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--clr-accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Add
              </button>
            </div>
            {form.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {form.tags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'var(--clr-surface2)',
                      border: '1px solid var(--clr-border)',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--clr-danger)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.9rem',
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                flex: 1,
                padding: '0.65rem',
                background: 'var(--clr-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: isSaving ? 'wait' : 'pointer',
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              style={{
                flex: 1,
                padding: '0.65rem',
                background: 'transparent',
                color: 'var(--clr-text)',
                border: '1px solid var(--clr-border)',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
