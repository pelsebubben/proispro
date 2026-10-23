import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = await readFile(new URL('../../src/components/FlightChart.tsx', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
})
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
