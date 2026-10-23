import { useState } from 'react'
import { DiscPhoto } from './DiscPhoto'
import {
  ClientDisc,
  ClientBag,
  colorSlug,
  condLabel,
  stabilityLabel,
  formatTurn,
  hasFlightNumbers,
  tagColor,
  getBagsForDisc,
  isDiscInBag,
} from '../utils/disc'

interface DiscCardProps {
  disc: ClientDisc
  bags: ClientBag[]
  onEdit: () => void
  onDelete: () => void
  onToggleBag: (bagId: string) => void
  onTagClick: (tag: string) => void
  onQtyChange: (delta: number) => void
  activeTagFilter: string
  badge?: 'core' | 'scramble' | null
}

export function DiscCard({
  disc,
  bags,
  onEdit,
  onDelete,
  onToggleBag,
  onTagClick,
  onQtyChange,
  activeTagFilter,
  badge,
}: DiscCardProps) {
  const [showBagMenu, setShowBagMenu] = useState(false)
  const discBags = getBagsForDisc(disc.id, bags)

  // Avatar: photo or colored circle
  const avatarBg = disc.color
    ? `var(--disc-${colorSlug(disc.color)})`
    : `var(--${disc.type || 'putter'})`

  return (
    <div
      style={{
        background: 'var(--clr-surface)',
        border: '1px solid var(--clr-border)',
        borderRadius: 'var(--radius)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      {disc.photo_url && <div className="disc-card-photo"><DiscPhoto src={disc.photo_url} name={disc.name} /></div>}
      {/* Header: avatar + name + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        {/* Avatar */}
        {!disc.photo_url && <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            flexShrink: 0,
            background: avatarBg,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '1.25rem',
          }}
        >
          {disc.name.charAt(0).toUpperCase()}
        </div>}

        {/* Name + manufacturer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--clr-text)' }}>
            {disc.name}
          </div>
          {disc.edition && <div className="disc-edition">{disc.edition}</div>}
          {disc.manufacturer && (
            <div style={{ fontSize: '0.8rem', color: 'var(--clr-muted)', marginTop: '0.15rem' }}>
              {disc.manufacturer}
            </div>
          )}
          {badge && (
            <span
              style={{
                display: 'inline-block',
                marginTop: '0.25rem',
                padding: '0.15rem 0.4rem',
                background: badge === 'core' ? 'var(--clr-accent)' : 'var(--clr-accent2)',
                color: '#fff',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>

      {/* Details row: weight, plastic, color dot, condition */}
      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--clr-muted)', flexWrap: 'wrap' }}>
        {disc.weight && <span>{disc.weight}g</span>}
        {disc.plastic && <span>{disc.plastic}</span>}
        {disc.color && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: `var(--disc-${colorSlug(disc.color)})`,
                border: '1px solid var(--clr-border)',
              }}
            />
            {disc.color}
          </span>
        )}
        {disc.condition && <span>{condLabel(disc.condition)}</span>}
      </div>

      {/* Flight numbers */}
      {hasFlightNumbers(disc) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Speed', value: disc.speed, color: 'var(--distance)' },
              { label: 'Glide', value: disc.glide, color: 'var(--fairway)' },
              { label: 'Turn', value: disc.turn, color: 'var(--midrange)', format: true },
              { label: 'Fade', value: disc.fade, color: 'var(--putter)' },
            ].map(({ label, value, color, format }) => (
              <div
                key={label}
                style={{
                  padding: '0.25rem 0.5rem',
                  background: color,
                  color: '#fff',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                {label}: {format ? formatTurn(value) : value}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--clr-muted)', fontStyle: 'italic' }}>
            {stabilityLabel(disc.turn, disc.fade)}
          </div>
        </div>
      )}

      {/* Bags badge */}
      {discBags.length > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--clr-accent)' }}>
          📦 In {discBags.length} bag{discBags.length !== 1 ? 's' : ''}:{' '}
          {discBags.map(b => b.name).join(', ')}
        </div>
      )}

      {/* Tags */}
      {disc.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {disc.tags.map(tag => (
            <button
              key={tag}
              onClick={() => onTagClick(tag)}
              style={{
                padding: '0.2rem 0.5rem',
                background: activeTagFilter === tag ? `var(--${tagColor(tag)})` : 'var(--clr-surface2)',
                color: activeTagFilter === tag ? '#fff' : 'var(--clr-text)',
                border: '1px solid var(--clr-border)',
                borderRadius: '4px',
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Notes */}
      {disc.notes && (
        <div style={{ fontSize: '0.8rem', color: 'var(--clr-muted)', fontStyle: 'italic' }}>
          {disc.notes}
        </div>
      )}

      {/* Actions row: qty stepper + edit + bag menu + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
        {/* Quantity stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <button
            onClick={() => onQtyChange(-1)}
            disabled={disc.quantity <= 1}
            style={{
              width: '24px',
              height: '24px',
              background: 'var(--clr-surface2)',
              border: '1px solid var(--clr-border)',
              borderRadius: '4px',
              cursor: disc.quantity > 1 ? 'pointer' : 'not-allowed',
              color: 'var(--clr-text)',
              fontSize: '0.9rem',
              opacity: disc.quantity <= 1 ? 0.5 : 1,
            }}
          >
            −
          </button>
          <span style={{ fontSize: '0.85rem', minWidth: '30px', textAlign: 'center' }}>
            {disc.quantity}
          </span>
          <button
            onClick={() => onQtyChange(1)}
            style={{
              width: '24px',
              height: '24px',
              background: 'var(--clr-surface2)',
              border: '1px solid var(--clr-border)',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--clr-text)',
              fontSize: '0.9rem',
            }}
          >
            +
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Edit button */}
        <button
          onClick={onEdit}
          style={{
            padding: '0.35rem 0.65rem',
            background: 'var(--clr-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Edit
        </button>

        {/* Bag menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowBagMenu(!showBagMenu)}
            style={{
              padding: '0.35rem 0.65rem',
              background: 'var(--clr-surface2)',
              border: '1px solid var(--clr-border)',
              borderRadius: '4px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              color: 'var(--clr-text)',
            }}
          >
            🎒
          </button>
          {showBagMenu && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '0.25rem',
                background: 'var(--clr-surface)',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius)',
                padding: '0.5rem',
                minWidth: '150px',
                zIndex: 10,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {bags.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--clr-muted)', padding: '0.25rem' }}>
                  No bags yet
                </div>
              ) : (
                bags.map(bag => (
                  <label
                    key={bag.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.35rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isDiscInBag(bag.id, disc.id, bags)}
                      onChange={() => onToggleBag(bag.id)}
                    />
                    <span>{bag.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={onDelete}
          style={{
            padding: '0.35rem 0.65rem',
            background: 'transparent',
            border: '1px solid var(--clr-danger)',
            borderRadius: '4px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            color: 'var(--clr-danger)',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
