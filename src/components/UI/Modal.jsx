import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, children, width = 560 }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose?.() }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h3 className="modal__title">{title}</h3>
          {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>}
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}
