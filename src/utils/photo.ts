import { CropState, outputSide, sourceRect } from './crop'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_BYTES = 10 * 1024 * 1024
// Matches the server limit for the base64 payload of a photo upload.
const MAX_DATA_URL_LENGTH = 512 * 1024 * 4 / 3

export interface PhotoSource {
  url: string
  image: HTMLImageElement
  width: number
  height: number
}

export function checkPhotoFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a photo smaller than 10 MB.')
}

// One decoded <img> is both what the cropper shows and what the canvas draws from,
// so the saved crop always matches the preview, including EXIF rotation.
export async function openPhoto(blob: Blob): Promise<PhotoSource> {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image')
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('This photo could not be opened. Try another JPEG, PNG or WebP file.')
  }
  return { url, image, width: image.naturalWidth, height: image.naturalHeight }
}

export function releasePhoto(source: PhotoSource) {
  URL.revokeObjectURL(source.url)
}

export function cropPhoto(source: PhotoSource, crop: CropState): string {
  const rect = sourceRect(crop, source.width, source.height)
  const side = outputSide(rect.size)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not prepare the photo.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, side, side)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.image, rect.x, rect.y, rect.size, rect.size, 0, 0, side, side)
  for (const quality of [0.85, 0.7, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality)
    if (data.length <= MAX_DATA_URL_LENGTH) return data
  }
  throw new Error('This photo is too detailed to upload. Choose a smaller image.')
}
