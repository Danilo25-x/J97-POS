import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

// Menú de acciones secundarias. El panel se dibuja en <body> para no quedar recortado por tablas con scroll.
export default function ActionMenu({ label, items }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const listRef = useRef(null)
  const open = pos !== null

  useEffect(() => {
    if (!open) return undefined
    listRef.current?.querySelector('[role="menuitem"]')?.focus()
    const close = () => setPos(null)
    const onDoc = e => { if (!btnRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) close() }
    const onKey = e => {
      if (e.key === 'Escape') { close(); btnRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const toggle = () => {
    if (open) return setPos(null)
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
  }

  const choose = item => { setPos(null); item.onSelect() }

  return (
    <>
      <button ref={btnRef} type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={toggle}>
        <MoreHorizontal size={18} />
      </button>
      {open && createPortal(
        <div ref={listRef} className="actmenu" role="menu" aria-label={label} style={{ top: pos.top, right: pos.right }}>
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" className={`actmenu__item${it.danger ? ' actmenu__item--danger' : ''}`} onClick={() => choose(it)}>
              <it.icon size={16} aria-hidden="true" /> {it.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
