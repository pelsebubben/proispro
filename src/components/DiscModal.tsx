import { useEffect, useId, useRef, useState } from 'react'
import { CatalogDisc } from '../hooks/useDiscCatalog'
import { ClientDisc, DiscDraft, DISC_TYPES, colorSlug } from '../utils/disc'
import { CropState } from '../utils/crop'
import { PhotoSource, checkPhotoFile, openPhoto, releasePhoto } from '../utils/photo'
import { loadDiscPhoto } from '../lib/data'
import { DiscSearch } from './DiscSearch'
import { DiscImage } from './DiscImage'
import { PhotoCropper } from './PhotoCropper'

interface DiscModalProps {
  disc?: ClientDisc | null
  onSave: (disc: DiscDraft) => Promise<void>
  onClose: () => void
}

interface Cropping {
  source: PhotoSource
  blob: Blob
  start?: CropState
}

const CROP_TITLE_ID = 'disc-crop-title'

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

export function DiscModal(props: DiscModalProps) {
  return <DiscForm key={props.disc?.id ?? 'new'} {...props} />
}

function DiscForm({ disc, onSave, onClose }: DiscModalProps) {
  const formId = useId()
  const [form, setForm] = useState(() => ({
    name: disc?.name ?? '',
    edition: disc?.edition ?? '',
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
  const [photo, setPhoto] = useState<string | null>()
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false)
  const [cropping, setCropping] = useState<Cropping | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoSequence = useRef(0)
  const photoInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const photoButton = useRef<HTMLButtonElement>(null)
  const original = useRef<{ blob: Blob; crop: CropState } | null>(null)
  const photoRequest = useRef<AbortController | null>(null)
  const wasCropping = useRef(false)
  const backdropPress = useRef(false)
  const preview = photo === undefined ? disc?.photo_url : photo
  const busy = isSaving || isPreparingPhoto
  useEffect(() => () => { photoSequence.current++; photoRequest.current?.abort() }, [])

  useEffect(() => {
    if (!cropping) return
    return () => releasePhoto(cropping.source)
  }, [cropping])

  useEffect(() => {
    if (cropping) {
      wasCropping.current = true
      dialog.current?.scrollTo({ top: 0 })
    } else if (wasCropping.current) {
      wasCropping.current = false
      // A file picked straight from the hidden input (assistive tech) has no button opener to return to.
      const target = opener.current?.isConnected ? opener.current : photoButton.current
      target?.focus()
    }
  }, [cropping])

  const openCropper = async (load: () => Promise<{ blob: Blob; start?: CropState }>) => {
    const sequence = ++photoSequence.current
    setPhotoError(null)
    setIsPreparingPhoto(true)
    try {
      const { blob, start } = await load()
      const source = await openPhoto(blob)
      if (sequence !== photoSequence.current) {
        releasePhoto(source)
        return
      }
      setCropping({ source, blob, start })
    } catch (reason) {
      if (sequence === photoSequence.current) setPhotoError(reason instanceof Error ? reason.message : 'Photo could not be prepared.')
    } finally {
      if (sequence === photoSequence.current) setIsPreparingPhoto(false)
    }
  }

  const choosePhoto = (file: File) => openCropper(async () => {
    checkPhotoFile(file)
    return { blob: file }
  })

  const requestPhoto = (event: React.MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget
    photoInput.current?.click()
  }

  // A photo that was just cropped re-opens from its original with the same framing;
  // a stored photo is fetched (usually from the cache) and re-cropped from what we kept.
  const adjustCrop = () => openCropper(async () => {
    if (photo && original.current) return { blob: original.current.blob, start: original.current.crop }
    if (!disc?.photo_url) throw new Error('There is no photo to adjust.')
    photoRequest.current?.abort()
    photoRequest.current = new AbortController()
    return { blob: await loadDiscPhoto(disc.photo_url, photoRequest.current.signal) }
  })

  const applyCrop = (cropped: string, crop: CropState) => {
    if (!cropping) return
    original.current = { blob: cropping.blob, crop }
    setPhoto(cropped)
    setCropping(null)
  }

  const removePhoto = () => {
    original.current = null
    setPhoto(null)
    setPhotoError(null)
  }

  const selectSuggestion = (selectedDisc: CatalogDisc) => {
    if (disc) {
      setForm(prev => ({ ...prev, name: selectedDisc.name, manufacturer: selectedDisc.brand,
        edition: selectedDisc.edition ?? '', ...(selectedDisc.plastic ? { plastic: selectedDisc.plastic } : {}) }))
    } else {
      setForm(prev => ({
        ...prev,
        name: selectedDisc.name,
        manufacturer: selectedDisc.brand,
        edition: selectedDisc.edition ?? '',
        plastic: selectedDisc.plastic ?? '',
        type: selectedDisc.type,
        speed: selectedDisc.speed,
        glide: selectedDisc.glide,
        turn: selectedDisc.turn,
        fade: selectedDisc.fade,
      }))
    }

  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving || isPreparingPhoto) return
    if (!form.name.trim() || !form.type) {
      setError('Name and Type are required.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await onSave({
        ...(disc?.id ? { id: disc.id } : {}),
        ...form,
        name: form.name.trim(),
        photo_url: disc?.photo_url || null,
        ...(photo !== undefined ? { photo } : {}),
        added: disc?.added || Date.now(),
      })
      onClose()
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? JSON.stringify(err)
      setError('Save failed: ' + msg)
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
      onPointerDown={event => { backdropPress.current = event.target === event.currentTarget }}
      onClick={event => { if (backdropPress.current && event.target === event.currentTarget && !isSaving && !cropping) onClose() }}
    >
      <div
        ref={dialog}
        className="disc-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={cropping ? CROP_TITLE_ID : 'disc-form-title'}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.defaultPrevented && !isSaving) onClose()
          if (event.key === 'Tab') {
            const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'))
              .filter(field => !field.matches(':disabled') && field.tabIndex >= 0 && field.getClientRects().length > 0)
            const first = fields[0]
            const last = fields[fields.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}
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
        <div className="disc-form-head" style={{ display: cropping ? 'none' : undefined }}>
          <div className="disc-form-head-text">
            <div className="disc-form-title-row">
              <h2 id="disc-form-title" className="disc-form-title">
                {disc ? 'Edit Disc' : 'Add Disc'}
              </h2>
              <button type="submit" form={formId} className="btn btn-primary btn-sm"
                aria-label={isSaving ? 'Saving disc' : 'Save disc'} disabled={busy}>
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
            <div className="disc-photo-actions">
              <button ref={photoButton} type="button" className="btn btn-secondary btn-sm" disabled={busy}
                onClick={requestPhoto}>
                {preview ? 'Change photo' : 'Add photo'}
              </button>
              {preview && <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                onClick={event => { opener.current = event.currentTarget; void adjustCrop() }}>Adjust crop</button>}
              {preview && <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                onClick={removePhoto}>Remove photo</button>}
            </div>
            <input id="disc-photo-upload" ref={photoInput} className="disc-photo-input" type="file"
              accept="image/jpeg,image/png,image/webp" aria-label="Personal photo" tabIndex={-1} disabled={busy}
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void choosePhoto(file)
              }} />
            <small className="disc-photo-hint">JPEG, PNG or WebP, up to 10 MB. Frame the disc inside the circle before saving.</small>
            {isPreparingPhoto && <p role="status">Preparing photo...</p>}
            {photoError && <p role="alert">{photoError}</p>}
          </div>
          <div className="disc-thumb disc-thumb-lg disc-photo-picker">
            <DiscImage disc={form} photo={preview} />
            <button type="button" className="disc-photo-picker-button" disabled={busy}
              aria-label={preview ? 'Change disc photo' : 'Add disc photo'} onClick={requestPhoto} />
          </div>
        </div>

        <form id={formId} onSubmit={handleSubmit} style={{ display: cropping ? 'none' : 'flex', flexDirection: 'column', gap: '1rem' }}>
          <DiscSearch value={form.name} onChange={name => setForm(previous => ({ ...previous, name }))}
            onSelect={selectSuggestion} />
          <div className="disc-edition-field">
            <label htmlFor="disc-edition">Edition / Run</label>
            <input id="disc-edition" value={form.edition} maxLength={200}
              placeholder="Optional, e.g. Midnight Prowl II"
              onChange={event => setForm(previous => ({ ...previous, edition: event.target.value }))} />
          </div>
          {error && <p role="alert">{error}</p>}

          {/* Manufacturer */}
          <div>
            <label htmlFor="disc-manufacturer" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Manufacturer
            </label>
            <input
              id="disc-manufacturer"
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
            <label htmlFor="disc-type" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Type <span style={{ color: 'var(--clr-danger)' }}>*</span>
            </label>
            <select
              id="disc-type"
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
            <label htmlFor="disc-notes" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--clr-text)' }}>
              Notes
            </label>
            <textarea
              id="disc-notes"
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
              disabled={isSaving || isPreparingPhoto}
              style={{
                flex: 1,
                padding: '0.65rem',
                background: 'var(--clr-accent)',
                color: 'var(--clr-bg)',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: isSaving || isPreparingPhoto ? 'wait' : 'pointer',
                opacity: isSaving || isPreparingPhoto ? 0.6 : 1,
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
        {cropping && (
          <PhotoCropper source={cropping.source} initial={cropping.start} titleId={CROP_TITLE_ID}
            onCancel={() => setCropping(null)} onDone={applyCrop} />
        )}
      </div>
    </div>
  )
}
