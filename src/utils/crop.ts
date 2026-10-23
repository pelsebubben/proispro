// Square crop model. The window is described in source-image terms so the maths
// never depends on how large the cropper happens to be on screen.
export interface CropState {
  zoom: number // 1 = the largest square that fits, higher zooms in
  cx: number // window centre as a fraction of image width
  cy: number // window centre as a fraction of image height
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
export const OUTPUT_MAX = 1024

export const initialCrop = (): CropState => ({ zoom: MIN_ZOOM, cx: 0.5, cy: 0.5 })

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

// Side of the square window, in source pixels.
export const windowSide = (width: number, height: number, zoom: number) =>
  Math.min(width, height) / zoom

export function clampCrop(crop: CropState, width: number, height: number): CropState {
  const zoom = clampZoom(crop.zoom)
  const side = windowSide(width, height, zoom)
  const halfX = side / 2 / width
  const halfY = side / 2 / height
  return {
    zoom,
    cx: Math.min(1 - halfX, Math.max(halfX, crop.cx)),
    cy: Math.min(1 - halfY, Math.max(halfY, crop.cy)),
  }
}

export function sourceRect(crop: CropState, width: number, height: number) {
  const { zoom, cx, cy } = clampCrop(crop, width, height)
  const size = windowSide(width, height, zoom)
  return {
    x: Math.max(0, Math.min(width - size, cx * width - size / 2)),
    y: Math.max(0, Math.min(height - size, cy * height - size / 2)),
    size,
  }
}

// dx and dy are drag distances as a fraction of the visible window. Dragging the
// photo right moves the window left across it.
export function panBy(crop: CropState, dx: number, dy: number, width: number, height: number) {
  const size = windowSide(width, height, crop.zoom)
  return clampCrop({ ...crop, cx: crop.cx - (dx * size) / width, cy: crop.cy - (dy * size) / height }, width, height)
}

// Zoom while keeping the source point under `anchor` (0..1 across the window) fixed.
export function zoomTo(crop: CropState, zoom: number, width: number, height: number, anchor = { x: 0.5, y: 0.5 }) {
  const before = sourceRect(crop, width, height)
  const next = clampZoom(zoom)
  const side = windowSide(width, height, next)
  const pointX = before.x + anchor.x * before.size
  const pointY = before.y + anchor.y * before.size
  return clampCrop({
    zoom: next,
    cx: (pointX - anchor.x * side + side / 2) / width,
    cy: (pointY - anchor.y * side + side / 2) / height,
  }, width, height)
}

// Where to place the full image inside the square window, as percentages of it.
export function imageBox(crop: CropState, width: number, height: number) {
  const rect = sourceRect(crop, width, height)
  return {
    width: (width / rect.size) * 100,
    height: (height / rect.size) * 100,
    left: -(rect.x / rect.size) * 100,
    top: -(rect.y / rect.size) * 100,
  }
}

// Never upscale: a small source keeps its own resolution.
export const outputSide = (size: number) => Math.max(1, Math.min(OUTPUT_MAX, Math.floor(size)))
