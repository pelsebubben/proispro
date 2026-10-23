import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CatalogDisc, searchCatalog } from '../hooks/useDiscCatalog'

interface Props {
  value: string
  onChange: (value: string) => void
  onSelect: (disc: CatalogDisc) => void
}

export function DiscSearch({ value, onChange, onSelect }: Props) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 })
  const matches = useMemo(() => searchCatalog(value), [value])
  const visible = open && !!value.trim()
  const close = () => setOpen(false)

  useLayoutEffect(() => {
    if (!visible || !input.current) return
    const rect = input.current.getBoundingClientRect()
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const below = viewportHeight - rect.bottom - 12
    const above = rect.top - 12
    const upwards = below < 160 && above > below
    const maxHeight = Math.max(80, Math.min(280, upwards ? above : below))
    setPosition({ top: upwards ? rect.top - maxHeight - 4 : rect.bottom + 4,
      left: rect.left, width: rect.width, maxHeight })
  }, [visible, value])

  useEffect(() => {
    if (!visible) return
    const dismiss = (event: Event) => {
      const target = event.target
      if (target instanceof Node && (menu.current?.contains(target) || target === input.current)) return
      close()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', close)
    window.visualViewport?.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', close)
      window.visualViewport?.removeEventListener('resize', close)
    }
  }, [visible])

  useEffect(() => {
    if (visible) menu.current?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, visible, id])

  const choose = (index: number) => {
    if (matches[index]) onSelect(matches[index])
    close()
  }

  return <div className="disc-search">
    <label htmlFor={id}>Disc Name <span aria-hidden="true">*</span></label>
    <input id={id} ref={input} required autoFocus maxLength={200} value={value}
      placeholder="Search mold, manufacturer or edition..."
      autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={visible}
      aria-controls={visible ? `${id}-list` : undefined}
      aria-activedescendant={visible ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help`}
      onChange={event => { onChange(event.target.value); setActive(0); setOpen(true) }}
      onFocus={() => { setActive(0); setOpen(true) }}
      onClick={() => setOpen(true)}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget)) close() }}
      onKeyDown={event => {
        if (event.key === 'Escape' && visible) { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key === 'Tab') close()
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && value.trim()) {
          event.preventDefault()
          setOpen(true)
          setActive(previous => !visible ? 0 : (previous + (event.key === 'ArrowDown' ? 1 : -1) + matches.length + 1) % (matches.length + 1))
        }
        if (event.key === 'Enter' && visible) { event.preventDefault(); choose(active) }
      }} />
    <small id={`${id}-help`}>Find a mold or special edition, or enter your own disc.</small>
    {visible && createPortal(
      <div ref={menu} className="disc-search-menu" style={{ ...position, position: 'fixed' }}>
        <div id={`${id}-list`} role="listbox" aria-label="Matching discs">
          {matches.map((disc, index) => <button type="button" role="option" tabIndex={-1}
            id={`${id}-option-${index}`} key={disc.id} aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}
            onPointerMove={() => setActive(index)} className="disc-search-option">
            <span className="disc-search-description">
              <strong>{disc.edition || disc.name}</strong>
              <small>{disc.brand}{disc.edition ? ` / ${disc.name}` : ''}{disc.plastic ? ` / ${disc.plastic}` : ''}</small>
            </span>
            <span className="disc-search-flight" aria-label={`Flight: ${disc.speed}, ${disc.glide}, ${disc.turn}, ${disc.fade}`}>
              {disc.speed} / {disc.glide} / {disc.turn} / {disc.fade}
            </span>
          </button>)}
          <button type="button" role="option" tabIndex={-1} id={`${id}-option-${matches.length}`}
            aria-selected={active === matches.length} className="disc-search-option disc-search-manual"
            onMouseDown={event => event.preventDefault()} onClick={() => choose(matches.length)}
            onPointerMove={() => setActive(matches.length)}>
            <span className="disc-search-description"><strong>Use "{value.trim()}" as a custom disc</strong>
              <small>{matches.length ? 'Not the right version? Fill in the details yourself.' : 'No matching disc. You can still add it manually.'}</small>
            </span>
          </button>
        </div>
        <div className="disc-search-help">Arrow keys to browse / Enter to select / Esc to dismiss</div>
      </div>, document.body)}
  </div>
}
