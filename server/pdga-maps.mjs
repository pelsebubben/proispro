const origin = 'https://www.pdga.com'

export function courseMapUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return null
  let url
  try { url = new URL(value, origin) } catch { return null }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
      !/^\/files\/course_maps\/[a-zA-Z0-9_./%-]+\.(pdf|png|jpe?g|webp)$/i.test(url.pathname) ||
      /%2f|%5c|%2e|\/\.\./i.test(url.pathname)) return null
  return url.href
}

export async function readCourseMaps(course, fetcher = fetch) {
  if (!/^https:\/\/www\.pdga\.com\/node\/[1-9][0-9]{0,15}$/.test(course.source_url ?? '')) {
    throw new Error('Invalid provider course identity')
  }
  let url = `${course.source_url}?qt-course_node=1`
  let response
  const signal = AbortSignal.timeout(30_000)
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'text/html' } })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location || redirects === 3) throw new Error('Invalid provider media redirect')
    const target = new URL(location, url)
    if (target.origin !== origin || target.username || target.password) throw new Error('Invalid provider media redirect')
    url = target.href
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw Object.assign(new Error('Provider course media unavailable'), {
      pdgaHttpStatus: response.status, pdgaPhase: 'layouts', pdgaFailure: 'http',
    })
  }
  if (response.url && new URL(response.url).origin !== origin) throw new Error('Invalid provider media redirect')
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Invalid provider media response')
  const chunks = []
  let bytes = 0
  if (!response.body) throw new Error('Invalid provider media response')
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > 2 * 1024 * 1024) throw new Error('Provider media response too large')
    chunks.push(chunk)
  }
  const html = Buffer.concat(chunks).toString('utf8')
  const start = html.indexOf('views-field-field-course-map-revision-id')
  if (start < 0) throw new Error('Provider course media structure changed')
  const end = html.indexOf('views-field-field-course-photo-revision-id', start)
  if (end < 0) throw new Error('Provider course media structure changed')
  const section = html.slice(start, end)
  const maps = []
  for (const match of section.matchAll(/(?:data-src|src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = courseMapUrl(match[1])
    if (!url || maps.some(map => map.url === url)) continue
    if (maps.length === 10) throw new Error('Too many provider course maps')
    maps.push({ url, kind: /\.pdf$/i.test(url) ? 'pdf' : 'image', label: `Course map ${maps.length + 1}` })
  }
  if (!maps.length && !/This course has no maps\./i.test(section)) {
    throw new Error('Provider course map format is not supported')
  }
  return maps
}
