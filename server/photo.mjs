import sharp from 'sharp'

export const photoLimits = { inputBytes: 512 * 1024, outputBytes: 256 * 1024, pixels: 16_000_000 }
const prefix = 'data:image/jpeg;base64,'
const base64 = /^[A-Za-z0-9+/]+={0,2}$/
// Tried in order so even a very noisy photo ends up inside the stored size limit.
const steps = [[1024, 82], [1024, 70], [1024, 58], [800, 58], [640, 52], [512, 45]]
const reject = (code, status) => Object.assign(new Error(code), { status })

// Turns a client JPEG data URL into the bytes we store: upright, at most 1024px, without any metadata.
export async function normalizePhoto(dataUrl) {
  const encoded = typeof dataUrl === 'string' && dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : ''
  if (!encoded || encoded.length % 4 || !base64.test(encoded)) throw reject('invalid_photo', 400)
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > photoLimits.inputBytes) throw reject('photo_too_large', 413)
  const open = () => sharp(bytes, { limitInputPixels: photoLimits.pixels })
  try {
    if ((await open().metadata()).format !== 'jpeg') throw reject('invalid_photo', 400)
    for (const [edge, quality] of steps) {
      const image = await open().rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality }).toBuffer()
      if (image.length <= photoLimits.outputBytes) return image
    }
  } catch (error) {
    if (error.status) throw error
    throw /pixel limit/i.test(error.message) ? reject('photo_too_large', 413) : reject('invalid_photo', 400)
  }
  throw reject('photo_too_large', 413)
}
