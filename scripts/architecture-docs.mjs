import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const renderer = {
  repository: 'tt-a1i/archify',
  revision: '51a291770851ad27a400cca73c753c166b5e0c65',
}
const directory = 'docs/architecture'
const snapshotPath = `${directory}/evidence.json`
const definitions = [
  ['runtime', 'architecture', 'components'],
  ['request', 'sequence', 'participants'],
  ['delivery', 'workflow', 'nodes'],
]
const normalize = text => text.replaceAll('\r\n', '\n')
const digest = text => createHash('sha256').update(normalize(text)).digest('hex')
const read = async (root, path) => normalize(await readFile(resolve(root, path), 'utf8'))
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function architectureSource(path) {
  return /^(src\/.*\.(?:ts|tsx|css)|server\/.*\.(?:mjs|sql)|infra\/.*\.(?:bicep|json)|scripts\/.*\.(?:mjs|sh|ps1|py)|\.github\/workflows\/(?:ci|dev|prod|infra|architecture)\.yml|(?:package(?:-lock)?\.json|Dockerfile|\.dockerignore|vite\.config\.ts))$/.test(path)
}

async function files(root, dir) {
  const result = []
  for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`Architecture input cannot be a symlink: ${path}`)
    if (entry.isDirectory()) result.push(...await files(root, path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

async function safeSource(root, path) {
  if (typeof path !== 'string' || !architectureSource(path) || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid architecture source path: ${path}`)
  }
  const actual = await realpath(resolve(root, path))
  const local = relative(await realpath(root), actual)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
    throw new Error(`Architecture source leaves repository: ${path}`)
  }
  return read(root, path)
}

async function inputs(root) {
  const paths = [
    ...(await Promise.all(['src', 'server', 'infra', 'scripts', '.github/workflows'].map(dir => files(root, dir)))).flat(),
    'package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'vite.config.ts',
  ].filter(architectureSource).sort()
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await safeSource(root, path))])))
  const documents = {}
  for (const path of (await files(root, directory)).filter(path => path.endsWith('.md'))) documents[path] = digest(await read(root, path))
  if (!Object.hasOwn(documents, `${directory}/README.md`)) throw new Error('Architecture reference is missing')
  const diagrams = {}
  const specs = []
  for (const [name, type, collection] of definitions) {
    const path = `${directory}/${name}.${type}.json`
    const text = await read(root, path)
    const spec = JSON.parse(text)
    if (spec.diagram_type !== type || spec.meta?.quality_profile !== 'showcase' ||
        spec.meta?.output !== `architecture-report/${name}.html` ||
        typeof spec.meta?.title !== 'string' || !spec.meta.title.trim() ||
        !Array.isArray(spec[collection]) || !spec[collection].length) throw new Error(`Invalid diagram definition: ${path}`)
    const ids = spec[collection].map(node => node.id)
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate diagram node: ${path}`)
    for (const edge of spec.connections ?? spec.messages ?? spec.edges ?? []) {
      if (!ids.includes(edge.from) || !ids.includes(edge.to)) throw new Error(`Unknown diagram endpoint: ${path}`)
    }
    for (const node of spec[collection]) {
      if (!node.sources?.length || node.sources.length > 3) throw new Error(`Missing/bounded sources required: ${path} ${node.id}`)
      for (const source of node.sources) {
        const content = await safeSource(root, source.path)
        const lineCount = content.trimEnd().split('\n').length
        if (!Number.isInteger(source.line) || source.line < 1 || !Number.isInteger(source.end_line) ||
            source.end_line < source.line || source.end_line > lineCount) {
          throw new Error(`Invalid citation: ${path} ${source.path}:${source.line}-${source.end_line}`)
        }
      }
    }
    diagrams[path] = digest(text)
    specs.push({ name, type, path, spec })
  }
  return { snapshot: { formatVersion: 1, sources, diagrams, documents }, specs }
}

export async function refreshArchitecture(root) {
  const { snapshot } = await inputs(root)
  await writeFile(resolve(root, snapshotPath), `${JSON.stringify(snapshot, null, 2)}\n`)
  return snapshot
}

export async function checkArchitecture(root, base) {
  const data = await inputs(root)
  const saved = JSON.parse(await read(root, snapshotPath))
  if (saved.formatVersion !== 1) throw new Error('Unknown architecture evidence format')
  const changed = []
  for (const section of ['sources', 'diagrams', 'documents']) {
    for (const path of new Set([...Object.keys(saved[section] ?? {}), ...Object.keys(data.snapshot[section])])) {
      if (saved[section]?.[path] !== data.snapshot[section][path]) changed.push(path)
    }
  }
  if (changed.length) throw new Error(`Architecture review is stale:\n${changed.join('\n')}\nReview docs/architecture, update diagrams where needed, then run npm run docs:refresh.`)
  if (base && !/^0{40}$/.test(base)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(base)) throw new Error('Invalid base reference')
    git(root, 'rev-parse', '--verify', `${base}^{commit}`)
    const paths = git(root, 'diff', '--name-only', '--no-renames', `${base}...HEAD`).split('\n')
    if (paths.some(architectureSource) && !paths.some(path => /^docs\/architecture\/.*\.md$/.test(path))) {
      throw new Error('Architecture source changed without a docs/architecture Markdown review in the same change. Record an impact assessment even when topology is unchanged.')
    }
  }
  return data
}

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export async function buildArchitecture(root, archify) {
  const { snapshot, specs } = await checkArchitecture(root)
  if (!archify) throw new Error('Set ARCHIFY_CLI to the pinned Archify checkout archify/bin/archify.mjs')
  const tool = resolve(archify)
  const toolRoot = resolve(tool, '..', '..', '..')
  if (git(toolRoot, 'rev-parse', 'HEAD') !== renderer.revision ||
      git(toolRoot, 'status', '--porcelain', '--untracked-files=no')) {
    throw new Error(`Use a clean ${renderer.repository} checkout at ${renderer.revision}`)
  }
  const sourceSha = git(root, 'rev-parse', 'HEAD')
  const trackedInputs = [...Object.keys(snapshot.sources), directory]
  if (git(root, 'status', '--porcelain', '--untracked-files=all', '--', ...trackedInputs)) {
    throw new Error('Commit the reviewed architecture sources and documentation before generating commit-linked diagrams.')
  }
  const origin = new URL(git(root, 'remote', 'get-url', 'origin'))
  if (origin.protocol !== 'https:' || origin.hostname !== 'github.com') throw new Error('Diagram provenance requires this repository GitHub HTTPS origin')
  origin.username = ''; origin.password = ''
  const output = resolve(root, 'architecture-report')
  await mkdir(output, { recursive: true })
  const attempts = `evidence/${randomUUID()}`
  for (const { name, type, spec } of specs) {
    const candidate = `${output}/${name}.${type}.json`
    const prepared = { ...spec, meta: { ...spec.meta,
      repository: { url: origin.href, revision: sourceSha, provider: 'github', link_mode: 'web' } } }
    await writeFile(candidate, `${JSON.stringify(prepared, null, 2)}\n`)
    const run = spawnSync(process.execPath, [tool, 'finalize', type, candidate, spec.meta.output,
      '--repo-root', root, '--quality', 'showcase', '--out-dir', `architecture-report/${attempts}/${name}`, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    process.stdout.write(run.stdout ?? '')
    if (run.status !== 0) throw new Error(`Diagram generation failed: ${name}\n${run.stderr ?? run.error ?? ''}`)
  }
  await copyFile(resolve(root, snapshotPath), resolve(output, 'evidence.json'))
  await copyFile(resolve(root, directory, 'README.md'), resolve(output, 'README.md'))
  const artifacts = {}
  for (const { name } of specs) {
    artifacts[`${name}.html`] = createHash('sha256').update(await readFile(resolve(output, `${name}.html`))).digest('hex')
  }
  await writeFile(resolve(output, 'release.json'), `${JSON.stringify({ sourceSha, repository: origin.href,
    renderer, reviewedEvidenceSha256: digest(JSON.stringify(snapshot)), artifacts }, null, 2)}\n`)
  const reference = await read(root, `${directory}/README.md`)
  await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Griplock architecture</title>
<style>body{font:16px/1.6 system-ui;max-width:70rem;margin:2rem auto;padding:0 1rem}li{margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}a:focus-visible{outline:3px solid currentColor}</style>
<h1>Griplock architecture</h1><p>Source commit: <code>${sourceSha}</code>. Open the standalone drawings below; node details link to that commit.</p>
<ul>${specs.map(({ name, spec }) => `<li><a href="${name}.html">${escape(spec.meta.title)}</a></li>`).join('')}</ul>
<p><a href="release.json">Release provenance and artifact hashes</a> | <a href="README.md">Maintenance reference</a></p>
<h2>Architecture reference</h2><pre>${escape(reference)}</pre></html>\n`)
  return { sourceSha, artifacts }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      base: { type: 'string' }, archify: { type: 'string' },
    } })
    const root = process.cwd()
    const command = positionals[0]
    if (positionals.length !== 1) throw new Error('Usage: architecture-docs.mjs check [--base REF] | refresh | build [--archify PATH]')
    if (command === 'refresh') await refreshArchitecture(root)
    else if (command === 'check') await checkArchitecture(root, values.base)
    else if (command === 'build') await buildArchitecture(root, values.archify ?? process.env.ARCHIFY_CLI)
    else throw new Error(`Unknown architecture command: ${command}`)
    console.log(`Architecture ${command} passed.`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
