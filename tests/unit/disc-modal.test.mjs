import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = await readFile(new URL('../../src/components/DiscModal.tsx', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
})
const moduleSource = outputText
  .replace(/from ["']react["']/g, `from ${JSON.stringify(import.meta.resolve('react'))}`)
  .replace(/from ["']react\/jsx-runtime["']/g, `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
  .replace(/import .* from ['"]\.\/DiscSearch['"];?/, `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}; const DiscSearch = ({ value }) => createElement('input', { value, readOnly: true });`)
  .replace(/import .* from ['"]\.\/DiscImage['"];?/, `const DiscImage = ({ disc, photo }) => createElement('i', { 'data-disc': disc.name, 'data-photo': photo ?? '' });`)
  .replace(/import .* from ['"]\.\/PhotoCropper['"];?/, 'const PhotoCropper = () => null;')
  .replace(/import .* from ['"]\.\.\/lib\/data['"];?/, 'const loadDiscPhoto = async () => new Blob();')
  .replace(/import .* from ['"]\.\.\/utils\/photo['"];?/, 'const checkPhotoFile = () => {}; const openPhoto = async () => ({}); const releasePhoto = () => {};')
  .replace(/import .* from ['"]\.\.\/utils\/crop['"];?/, '')
  .replace(/import .* from ['"]\.\.\/utils\/disc['"];?/, `const colorSlug = name => name.toLowerCase();
    const DISC_TYPES = ['putter','midrange','fairway','distance','utility'].map(value => ({ value, label: value }));`)
const { DiscModal } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
const disc = {
  id: 'fixture', name: 'Ready on first render', edition: 'Special run', manufacturer: 'Test brand', type: 'midrange',
  plastic: 'Premium', weight: '174', quantity: 2, color: 'Blue', condition: 'used',
  speed: 5, glide: 4, turn: -1.5, fade: 1, notes: 'Existing notes', tags: ['favorite'],
  photo_url: null, added: 1,
}
const render = value => renderToStaticMarkup(createElement(DiscModal, { disc: value, onSave: async () => {}, onClose() {} }))

test('edit fields are populated on the first render, without waiting for effects', () => {
  const html = render(disc)
  for (const value of ['Ready on first render', 'Special run', 'Test brand', 'Premium', '174', '-1.5']) {
    assert.ok(html.includes(`value="${value}"`), `${value} is ready before effects or field input`)
  }
  assert.match(html, /value="midrange" selected=""/)
  assert.match(html, /value="used" selected=""/)
  assert.match(html, />Existing notes<\/textarea>/)
  assert.ok(html.includes('favorite'))
})

test('selected IDs key the form so switching discs or returning to add resets draft state', () => {
  assert.equal(DiscModal({ disc }).key, disc.id)
  assert.equal(DiscModal({ disc: { ...disc, id: 'second' } }).key, 'second')
  assert.equal(DiscModal({ disc: null }).key, 'new')
  assert.match(render(null), /value="" selected=""/)
  assert.ok(!render(null).includes('Ready on first render'))
})

test('the disc picture sits in the header frame, beside the title and photo actions', () => {
  const html = render({ ...disc, photo_url: '/api/v1/discs/fixture/photo' })
  assert.match(html, /<div class="disc-form-head"><div class="disc-form-head-text"><h2 id="disc-form-title" class="disc-form-title">Edit Disc<\/h2>/)
  assert.match(html, /<div class="disc-thumb disc-thumb-lg"><i data-disc="Ready on first render" data-photo="\/api\/v1\/discs\/fixture\/photo"><\/i><\/div><\/div>/)
  assert.match(render(null), /<div class="disc-thumb disc-thumb-lg"><i data-disc="" data-photo=""><\/i><\/div>/)
})

test('photo actions depend on whether the disc has a photo, and the picker only accepts web image formats', () => {
  const withPhoto = render({ ...disc, photo_url: '/api/v1/discs/fixture/photo' })
  for (const action of ['Change photo', 'Adjust crop', 'Remove photo']) assert.ok(withPhoto.includes(`>${action}</button>`), action)
  assert.ok(!withPhoto.includes('>Add photo</button>'))
  const withoutPhoto = render(disc)
  assert.ok(withoutPhoto.includes('>Add photo</button>'))
  for (const action of ['Change photo', 'Adjust crop', 'Remove photo']) assert.ok(!withoutPhoto.includes(`>${action}</button>`), action)
  assert.match(withoutPhoto, /<input id="disc-photo-upload"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/)
  assert.match(withoutPhoto, /aria-label="Personal photo"/)
})
