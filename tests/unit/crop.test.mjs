import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithOxc } from 'vite'

const source = await readFile(new URL('../../src/utils/crop.ts', import.meta.url), 'utf8')
const { code: outputText } = await transformWithOxc(source, 'crop.ts')
const { MIN_ZOOM, MAX_ZOOM, OUTPUT_MAX, initialCrop, clampCrop, sourceRect, panBy, zoomTo, imageBox, outputSide } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} != ${expected}`)

test('a fresh crop is the largest centred square, for landscape, portrait and square photos', () => {
  assert.deepEqual(sourceRect(initialCrop(), 1800, 1200), { x: 300, y: 0, size: 1200 })
  assert.deepEqual(sourceRect(initialCrop(), 1200, 1800), { x: 0, y: 300, size: 1200 })
  assert.deepEqual(sourceRect(initialCrop(), 900, 900), { x: 0, y: 0, size: 900 })
})

test('the window can never leave the photo, whatever the zoom or position asked for', () => {
  for (const [width, height] of [[1800, 1200], [1200, 1800], [640, 640], [4000, 900]]) {
    for (const zoom of [0.2, 1, 1.37, 2, 3.99, 4, 10]) {
      for (const cx of [-5, 0, 0.3, 0.5, 1, 7]) {
        for (const cy of [-5, 0, 0.8, 1, 7]) {
          const rect = sourceRect({ zoom, cx, cy }, width, height)
          const expectedSize = Math.min(width, height) / Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
          close(rect.size, expectedSize, 'window side follows the clamped zoom')
          assert.ok(rect.x >= 0 && rect.y >= 0, 'starts inside the photo')
          assert.ok(rect.x + rect.size <= width + 1e-9 && rect.y + rect.size <= height + 1e-9, 'ends inside the photo')
        }
      }
    }
  }
  // The zoom is limited first, so the window is 300px and the centre may sit 150px from each edge.
  assert.deepEqual(clampCrop({ zoom: 99, cx: -1, cy: 2 }, 1800, 1200), { zoom: MAX_ZOOM, cx: 150 / 1800, cy: 1 - 150 / 1200 })
})

test('dragging moves the photo with the finger and stops at the photo edge', () => {
  const zoomed = { zoom: 2, cx: 0.5, cy: 0.5 } // 600px window on a 1800x1200 photo
  // Drag the photo right by half the window: the window slides left by 300px of the photo.
  close(panBy(zoomed, 0.5, 0, 1800, 1200).cx, 0.5 - 300 / 1800)
  close(panBy(zoomed, 0, -0.5, 1800, 1200).cy, 0.5 + 300 / 1200)
  assert.equal(panBy(zoomed, 0.5, 0.5, 1800, 1200).cy, 0.5 - 300 / 1200)
  // Dragging far past the edge parks the window against it.
  const edge = panBy(zoomed, 50, -50, 1800, 1200)
  close(edge.cx, 300 / 1800)
  close(edge.cy, 1 - 300 / 1200)
  // At zoom 1 the short side is already fully shown, so only the long side can move.
  const fit = panBy(initialCrop(), 0.4, 0.4, 1800, 1200)
  assert.equal(fit.cy, 0.5)
  assert.ok(fit.cx < 0.5 && fit.cx >= 1 / 3)
})

test('zooming keeps the point under the pointer fixed until the photo edge gets in the way', () => {
  const point = (crop, anchor, width, height) => {
    const rect = sourceRect(crop, width, height)
    return [rect.x + anchor.x * rect.size, rect.y + anchor.y * rect.size]
  }
  const start = initialCrop()
  for (const anchor of [{ x: 0.25, y: 0.75 }, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 }]) {
    const before = point(start, anchor, 1800, 1200)
    for (const zoom of [1.5, 2, 3]) {
      const after = point(zoomTo(start, zoom, 1800, 1200, anchor), anchor, 1800, 1200)
      close(after[0], before[0], `x at ${zoom}x`)
      close(after[1], before[1], `y at ${zoom}x`)
    }
  }
  // Zooming back out re-centres as far as the photo allows, and never past the zoom limits.
  const out = zoomTo({ zoom: 3, cx: 0.2, cy: 0.5 }, 1, 1800, 1200)
  assert.equal(out.zoom, MIN_ZOOM)
  assert.ok(out.cx >= 1 / 3 && out.cx <= 2 / 3)
  assert.equal(zoomTo(start, 40, 1800, 1200).zoom, MAX_ZOOM)
  assert.equal(zoomTo(start, 0, 1800, 1200).zoom, MIN_ZOOM)
})

test('the photo is positioned in the window with percentages that always cover it', () => {
  const expectBox = (box, expected) => Object.entries(expected).forEach(([key, value]) => close(box[key], value, key))
  expectBox(imageBox(initialCrop(), 1800, 1200), { width: 150, height: 100, left: -25, top: 0 })
  expectBox(imageBox({ zoom: 2, cx: 0.5, cy: 0.5 }, 1800, 1200), { width: 300, height: 200, left: -100, top: -50 })
  for (const crop of [initialCrop(), { zoom: 4, cx: 0, cy: 1 }, { zoom: 2.5, cx: 0.9, cy: 0.1 }]) {
    for (const [width, height] of [[1800, 1200], [1200, 1800]]) {
      const box = imageBox(crop, width, height)
      assert.ok(box.left <= 1e-9 && box.top <= 1e-9, 'photo starts at or before the window origin')
      assert.ok(box.left + box.width >= 100 - 1e-9 && box.top + box.height >= 100 - 1e-9, 'photo reaches the far window edges')
    }
  }
})

test('output is never upscaled and never larger than the upload limit', () => {
  assert.equal(OUTPUT_MAX, 1024)
  assert.equal(outputSide(300), 300)
  assert.equal(outputSide(1200), 1024)
  assert.equal(outputSide(5000), OUTPUT_MAX)
  assert.equal(outputSide(1023.9), 1023)
  assert.equal(outputSide(0.4), 1)
})
