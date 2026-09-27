const V = {
  Disponible: 'ok', Activo: 'ok', Completada: 'ok', Abierta: 'ok', Pagada: 'ok',
  Bajo: 'warn', Pendiente: 'warn', Reembolsada: 'warn',
  Agotado: 'bad', Inactivo: 'bad', Cancelada: 'bad',
  Cerrada: 'neutral',
}
export default function StatusBadge({ status }) {
  return <span className={`badge badge--${V[status] || 'neutral'}`}>{status}</span>
}
