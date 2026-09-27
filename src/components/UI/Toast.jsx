import { CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react'
const ICON = { ok: CircleCheck, error: CircleAlert, warning: TriangleAlert }
export default function Toast({ msg }) {
  if (!msg?.text) return null
  const type = msg.type || 'ok'
  const Icon = ICON[type] || CircleCheck
  return (
    <div className={`toast toast--${type}`} role="status" aria-live="polite">
      <Icon size={20} /> <span>{msg.text}</span>
    </div>
  )
}
