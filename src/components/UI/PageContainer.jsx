export default function PageContainer({ title, subtitle, action, children }) {
  return (
    <div className="page">
      {(title || subtitle || action) && (
        <header className="page__head">
          <div>
            {title && <h1 className="page__title">{title}</h1>}
            {subtitle && <p className="page__sub">{subtitle}</p>}
          </div>
          {action && <div className="page__actions">{action}</div>}
        </header>
      )}
      {children}
    </div>
  )
}
