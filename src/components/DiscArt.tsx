import { colorSlug } from '../utils/disc'

export interface ArtDisc {
  name: string
  manufacturer?: string
  type?: string
  color?: string
  speed?: number | string
  glide?: number | string
  turn?: number | string
  fade?: number | string
}

const TYPE_TOKENS = ['putter', 'midrange', 'fairway', 'distance', 'utility']

// The disc colour when it is one of the known palette names, otherwise the type colour.
function discTint({ type, color }: Pick<ArtDisc, 'type' | 'color'>) {
  const typeTint = type && TYPE_TOKENS.includes(type) ? `var(--${type})` : 'var(--clr-muted)'
  const slug = color ? colorSlug(color).replace(/[^a-z0-9-]/g, '') : ''
  return slug ? `var(--disc-${slug}, ${typeTint})` : typeTint
}

const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text
const hasNumber = (value: number | string | undefined) => value !== '' && value != null

// A generated top-down illustration, not a photograph. `stamp` prints the brand, mold
// and flight numbers on the label, which only reads well at preview size.
export function DiscArt({ disc, stamp = false }: { disc: ArtDisc; stamp?: boolean }) {
  const tint = discTint(disc)
  const mold = clip(disc.name.trim(), 18)
  const brand = clip((disc.manufacturer ?? '').trim().toUpperCase(), 12)
  const flight = [disc.speed, disc.glide, disc.turn, disc.fade].every(hasNumber)
    ? [disc.speed, disc.glide, disc.turn, disc.fade].join(' | ') : ''
  const moldSize = Math.max(8, Math.min(17, 92 / (Math.max(mold.length, 1) * 0.62)))
  const labelled = stamp
    ? { role: 'img' as const, 'aria-label': `${disc.name || 'Disc'} stock illustration` }
    : { 'aria-hidden': true as const }
  return (
    <svg className="disc-art" viewBox="0 0 200 200" {...labelled}>
      <circle cx="100" cy="100" r="98" style={{ fill: `color-mix(in oklch, ${tint} 62%, black)` }} />
      <circle cx="100" cy="100" r="88" style={{ fill: tint }} />
      <circle cx="100" cy="100" r="76" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="64" fill="none" stroke="#000" strokeOpacity=".16" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="50" stroke="#000" strokeOpacity=".3" strokeWidth="1.5"
        style={{ fill: `color-mix(in oklch, ${tint} 12%, white)` }} />
      <path d="M29 59A82 82 0 0 1 72 23" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="5" strokeLinecap="round" />
      {stamp && (
        <g textAnchor="middle" fill="#1a2233" fontFamily="system-ui, sans-serif">
          {brand && <text x="100" y="80" fontSize="8.5" fontWeight="700" letterSpacing=".8">{brand}</text>}
          {mold && <text x="100" y={flight ? 102 : 106} fontSize={moldSize} fontWeight="800">{mold}</text>}
          {flight && <text x="100" y="124" fontSize="9" fontWeight="600">{flight}</text>}
        </g>
      )}
    </svg>
  )
}
