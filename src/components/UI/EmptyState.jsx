export default function EmptyState({ icon, title, text, small, children }) {
  return (
    <div className={`empty ${small ? 'empty--sm' : ''}`}>
      {icon && <div className="empty__icon" aria-hidden="true">{icon}</div>}
      <div className="empty__title">{title}</div>
      {text && <p>{text}</p>}
      {children}
    </div>
  )
}
