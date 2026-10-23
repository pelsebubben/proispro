import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import sharp from 'sharp'
import { normalizePhoto, photoLimits } from '../../server/photo.mjs'

const dataUrl = bytes => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
const noise = (width, height, quality) => sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
  .jpeg({ quality }).toBuffer()
const flat = (width, height) => sharp({ create: { width, height, channels: 3, background: '#3366aa' } })
  .jpeg({ quality: 80 }).toBuffer()
// A flat colour with a small noisy patch: unique, but only a few KiB.
async function photo(width, height, metadata) {
  const patch = await sharp(randomBytes(120 * 80 * 3), { raw: { width: 120, height: 80, channels: 3 } }).png().toBuffer()
  const image = sharp({ create: { width, height, channels: 3, background: '#3366aa' } })
    .composite([{ input: patch, left: 10, top: 10 }])
  return (metadata ? image.withMetadata(metadata) : image).jpeg({ quality: 85 }).toBuffer()
}
const pad = (bytes, size) => Buffer.concat([bytes, Buffer.alloc(size - bytes.length)])
const rejects = (input, status, code, label) => assert.rejects(normalizePhoto(input),
  error => error.status === status && error.message === code, label)

test('a photo becomes an upright JPEG of at most 1024px without any embedded metadata', async () => {
  const source = await photo(1600, 1200, { orientation: 6, exif: { IFD0: { Copyright: 'secret-copyright' } } })
  assert.ok(source.includes(Buffer.from('secret-copyright')), 'the fixture must carry metadata to strip')
  const stored = await normalizePhoto(dataUrl(source))
  const info = await sharp(stored).metadata()
  assert.deepEqual([stored[0], stored[1], stored[2]], [0xff, 0xd8, 0xff])
  assert.deepEqual([info.format, info.width, info.height], ['jpeg', 768, 1024], 'EXIF orientation is applied, then dropped')
  assert.deepEqual([info.exif, info.icc, info.xmp, info.orientation], [undefined, undefined, undefined, undefined])
  assert.equal(stored.includes(Buffer.from('secret-copyright')), false)
  const small = await sharp(await normalizePhoto(dataUrl(await photo(640, 480)))).metadata()
  assert.deepEqual([small.width, small.height], [640, 480], 'photos are never enlarged')
})

test('noisy photos are re-encoded until they fit the stored size limit', async () => {
  const source = await noise(1024, 1024, 25)
  assert.ok(source.length < 524_288)
  assert.ok((await sharp(source).jpeg({ quality: 82 }).toBuffer()).length > 262_144,
    'the fixture must be too big for the first encoding attempt')
  const stored = await normalizePhoto(dataUrl(source))
  const info = await sharp(stored).metadata()
  assert.ok(stored.length <= 262_144, `${stored.length} bytes`)
  assert.ok(info.format === 'jpeg' && info.width <= 1024 && info.height <= 1024)
})

test('input bytes are capped at 512 KiB and decoded pixels at 16 million', async () => {
  assert.deepEqual(photoLimits, { inputBytes: 524_288, outputBytes: 262_144, pixels: 16_000_000 }, 'the agreed limits')
  const small = await photo(1600, 1200)
  assert.equal((await sharp(await normalizePhoto(dataUrl(pad(small, 524_288)))).metadata()).format, 'jpeg')
  await rejects(dataUrl(pad(small, 524_289)), 413, 'photo_too_large', 'one byte over the input cap')
  assert.equal((await sharp(await normalizePhoto(dataUrl(await flat(4000, 4000)))).metadata()).width, 1024)
  await rejects(dataUrl(await flat(4001, 4000)), 413, 'photo_too_large', 'one pixel row over 16 million')
  await rejects(dataUrl(await flat(8000, 8000)), 413, 'photo_too_large', '64 million pixels')
})

test('anything that is not a complete JPEG data URL is rejected as invalid_photo', async () => {
  const small = await photo(1600, 1200)
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aa3366' } }).png().toBuffer()
  const encoded = small.toString('base64')
  const cases = {
    'png data url': `data:image/png;base64,${png.toString('base64')}`,
    'png bytes under the jpeg prefix': dataUrl(png),
    'svg under the jpeg prefix': dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')),
    'random bytes': dataUrl(randomBytes(2000)),
    'truncated jpeg': dataUrl(small.subarray(0, small.length / 2)),
    'jpeg header only': dataUrl(small.subarray(0, 20)),
    'empty payload': 'data:image/jpeg;base64,',
    'empty string': '',
    'no data url prefix': encoded,
    'uppercase media type': `data:IMAGE/JPEG;base64,${encoded}`,
    'characters outside base64': 'data:image/jpeg;base64,@@@@',
    'unpadded length': `data:image/jpeg;base64,${encoded}A`,
    'whitespace inside the payload': `data:image/jpeg;base64,${encoded.slice(0, 8)}\n${encoded.slice(8)}`,
    'not a string': 42,
  }
  for (const [label, input] of Object.entries(cases)) await rejects(input, 400, 'invalid_photo', label)
})
