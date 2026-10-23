import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react'
import { CropState, MAX_ZOOM, MIN_ZOOM, clampCrop, imageBox, initialCrop, panBy, zoomTo } from '../utils/crop'
import { PhotoSource, cropPhoto } from '../utils/photo'

interface PhotoCropperProps {
  source: PhotoSource
  initial?: CropState
  titleId: string
  onCancel: () => void
  onDone: (photo: string, crop: CropState) => void
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const KEY_ZOOM = 1.1

// The visible square is exactly what gets saved: drag the photo, pinch or scroll to zoom.
export function PhotoCropper({ source, initial, titleId, onCancel, onDone }: PhotoCropperProps) {
  const { width, height } = source
  const [crop, setCrop] = useState<CropState>(() => clampCrop(initial ?? initialCrop(), width, height))
  const [error, setError] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistance = useRef(0)

  useEffect(() => { stage.current?.focus({ preventScroll: true }) }, [])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
      const anchor = { x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) }
      setCrop(previous => zoomTo(previous, previous.zoom * Math.exp(-delta * 0.0015), width, height, anchor))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [width, height])

  const distanceBetweenPointers = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinchDistance.current = pointers.current.size === 2 ? distanceBetweenPointers() : 0
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId)
    const box = event.currentTarget.getBoundingClientRect()
    if (!last || !box.width || !box.height) return
    const current = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, current)
    if (pointers.current.size === 1) {
      const dx = (current.x - last.x) / box.width
      const dy = (current.y - last.y) / box.height
      setCrop(previous => panBy(previous, dx, dy, width, height))
    } else if (pointers.current.size === 2) {
      const distance = distanceBetweenPointers()
      if (!distance || !pinchDistance.current) return
      const ratio = distance / pinchDistance.current
      pinchDistance.current = distance
      const [a, b] = [...pointers.current.values()]
      const anchor = {
        x: clamp01(((a.x + b.x) / 2 - box.left) / box.width),
        y: clamp01(((a.y + b.y) / 2 - box.top) / box.height),
      }
      setCrop(previous => zoomTo(previous, previous.zoom * ratio, width, height, anchor))
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    pinchDistance.current = 0
  }

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setCrop(previous => panBy(previous, move[0], move[1], width, height))
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setCrop(previous => zoomTo(previous, previous.zoom * KEY_ZOOM, width, height))
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      setCrop(previous => zoomTo(previous, previous.zoom / KEY_ZOOM, width, height))
    }
  }

  // Escape closes the cropper only; preventDefault stops the dialog from closing too.
  function onPaneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onCancel()
  }

  function apply() {
    try {
      onDone(cropPhoto(source, crop), crop)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This photo could not be cropped.')
    }
  }

  const box = imageBox(crop, width, height)
  return (
    <div className="photo-cropper" onKeyDown={onPaneKeyDown}>
      <h2 id={titleId} className="photo-cropper-title">Crop photo</h2>
      <p className="photo-cropper-hint">Drag to move, pinch or scroll to zoom. Everything inside the square is saved.</p>
      <div
        ref={stage}
        className="photo-cropper-stage"
        role="group"
        tabIndex={0}
        aria-label="Crop area. Arrow keys move the photo. Plus and minus zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onStageKeyDown}
      >
        <img src={source.url} alt="" draggable={false}
          style={{ width: `${box.width}%`, height: `${box.height}%`, left: `${box.left}%`, top: `${box.top}%` }} />
        <div className="photo-cropper-guide" aria-hidden="true" />
      </div>
      <label className="photo-cropper-zoom">
        <span>Zoom</span>
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={crop.zoom}
          aria-valuetext={`${crop.zoom.toFixed(1)}×`}
          onChange={event => setCrop(previous => zoomTo(previous, Number(event.target.value), width, height))} />
        <output>{crop.zoom.toFixed(1)}×</output>
      </label>
      {error && <p role="alert" className="photo-cropper-error">{error}</p>}
      <div className="photo-cropper-actions">
        <button type="button" className="btn btn-secondary" onClick={() => { setError(null); setCrop(initialCrop()) }}>Reset</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={apply}>Use photo</button>
      </div>
    </div>
  )
}
