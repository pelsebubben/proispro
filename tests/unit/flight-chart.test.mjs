import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

const source = await readFile(new URL('../../src/components/FlightChart.tsx', import.meta.url), 'utf8')
const { code: outputText } = await transformWithOxc(source, 'FlightChart.tsx', { jsx: { runtime: 'automatic' } })
const compiled = outputText.replace(/from ["']react\/jsx-runtime["']/g, `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
const { FlightChart } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
test('Utility discs retain flight-chart representation and a wrapping legend', () => {
  const html = renderToStaticMarkup(createElement(FlightChart, {
    discs: [{ id: 'utility', name: 'Utility test', type: 'utility', speed: 5, glide: 5, turn: -1, fade: 1 }],
  }))
  assert.match(html, /<circle[^>]+fill="var\(--utility\)"/)
  assert.match(html, /<\/span> Utility/)
  assert.match(html, /flex-wrap:wrap/)
})
