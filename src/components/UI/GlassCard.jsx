// Nombre conservado por compatibilidad: ahora es una tarjeta limpia.
export default function GlassCard({ children, style, className = '' }) {
  return <div className={`card ${className}`} style={style}>{children}</div>
}
