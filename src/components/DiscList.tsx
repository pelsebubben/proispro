import { memo, useState } from 'react'
import { ClientDisc, TypeGroup, condLabel, stabilityLabel } from '../utils/disc'
import { DiscArt } from './DiscArt'
import { DiscPhoto } from './DiscPhoto'

interface DiscListProps {
  groups: TypeGroup[]
  onEdit?: (disc: ClientDisc) => void
  membership?: {
    bagName: string
    selectedIds: string[]
    disabled: boolean
    onToggle: (disc: ClientDisc) => void
  }
}

const hasNumber = (value: number | string) => value !== '' && value != null

function flightOf(disc: ClientDisc) {
  const numbers = [disc.speed, disc.glide, disc.turn, disc.fade]
  return numbers.every(hasNumber) ? numbers.join(' | ') : ''
}

const icon = { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

// Moxfield-style: text rows grouped by type, with the picture of whichever disc is
// hovered, focused or tapped shown beside (or, on a phone, above) the list.
export function DiscList({ groups, onEdit, membership }: DiscListProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const discs = groups.flatMap(group => group.discs)
  const active = discs.find(disc => disc.id === activeId) ?? discs[0]
  return (
    <div className="disc-list">
      <aside className="disc-preview" aria-label="Selected disc">
        {active && <DiscPreview disc={active} />}
      </aside>
      <div className="disc-list-groups">
        {groups.map(group => {
          const id = `disc-group-${group.type || 'none'}`
          return (
            <section key={group.type || 'none'} aria-labelledby={id}>
              <h3 id={id} className="disc-list-heading">
                <span className="disc-list-dot" aria-hidden="true" style={{ background: `var(--${group.type || 'clr-muted'})` }} />
                {group.label}{' '}<span className="disc-list-count">{`(${group.discs.length})`}</span>
              </h3>
              <ul className="disc-list-rows">
                {group.discs.map(disc => (
                  <DiscRow key={disc.id} disc={disc} active={disc.id === active?.id} onActivate={setActiveId} onEdit={onEdit} membership={membership} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DiscPreview({ disc }: { disc: ClientDisc }) {
  const flight = flightOf(disc)
  const details = [disc.plastic, disc.weight && `${disc.weight}g`, condLabel(disc.condition)].filter(Boolean).join(' · ')
  return (
    <>
      <figure className="disc-preview-figure">
        <div className="disc-preview-media">
          {disc.photo_url
            ? <DiscPhoto key={disc.photo_url} src={disc.photo_url} name={disc.name} />
            : <DiscArt disc={disc} stamp />}
        </div>
        <figcaption>{disc.photo_url ? 'Your photo' : 'Stock illustration'}</figcaption>
      </figure>
      <div className="disc-preview-info">
        <p className="disc-preview-name">{disc.name}</p>
        {disc.edition && <p className="disc-edition disc-preview-edition">{disc.edition}</p>}
        {disc.manufacturer && <p className="disc-preview-maker">{disc.manufacturer}</p>}
        {details && <p className="disc-preview-details">{details}</p>}
        {flight && <p className="disc-preview-flight">{flight}{' '}<span>{stabilityLabel(disc.turn, disc.fade)}</span></p>}
      </div>
    </>
  )
}

interface DiscRowProps {
  disc: ClientDisc
  active: boolean
  onActivate: (id: string) => void
  onEdit?: (disc: ClientDisc) => void
  membership?: DiscListProps['membership']
}

const DiscRow = memo(function DiscRow({ disc, active, onActivate, onEdit, membership }: DiscRowProps) {
  const flight = flightOf(disc)
  return (
    <li className="disc-row" data-active={active ? 'true' : undefined}>
      {membership && (
        <label className="disc-row-membership">
          <input
            type="checkbox"
            checked={membership.selectedIds.includes(disc.id)}
            disabled={membership.disabled}
            onChange={() => membership.onToggle(disc)}
          />
          <span className="sr-only">{`Include ${disc.name}${disc.edition ? ` ${disc.edition}` : ''} in ${membership.bagName}`}</span>
        </label>
      )}
      <button
        type="button"
        className="disc-row-main"
        aria-current={active ? 'true' : undefined}
        onPointerEnter={event => { if (event.pointerType !== 'touch') onActivate(disc.id) }}
        onFocus={() => onActivate(disc.id)}
        onClick={() => onActivate(disc.id)}
      >
        {!membership && <span className="disc-row-qty">{disc.quantity > 1 ? `${disc.quantity}×` : ''}</span>}
        <span className="disc-row-name">
          <span className="disc-row-line">
            <span className="disc-row-title">{disc.name}</span>
            {disc.edition && <>{' '}<span className="disc-row-edition">{disc.edition}</span></>}
          </span>
          {disc.manufacturer && <span className="disc-row-maker">{disc.manufacturer}</span>}
        </span>
        <span className="disc-row-flight" aria-hidden="true">{flight}</span>
        {flight && <span className="sr-only">{`Speed ${disc.speed}, glide ${disc.glide}, turn ${disc.turn}, fade ${disc.fade}`}</span>}
        <span className="disc-row-photo">
          {disc.photo_url && <>
            <svg {...icon}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            <span className="sr-only">Personal photo</span>
          </>}
        </span>
      </button>
      {onEdit && <button type="button" className="disc-row-edit" aria-label={`Edit ${disc.name}`} onClick={() => onEdit(disc)}>
        <svg {...icon}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
      </button>}
    </li>
  )
})
