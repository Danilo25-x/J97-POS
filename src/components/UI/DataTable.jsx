import { Inbox } from 'lucide-react'
import EmptyState from './EmptyState'

// columns: string[]; data: array de filas (cada fila, array de celdas)
export default function DataTable({ columns, data }) {
  if (!data?.length) {
    return <EmptyState icon={<Inbox size={28} />} title="No hay registros" text="Los datos aparecerán aquí cuando existan registros." />
  }
  return (
    <div className="tbl-wrap card card--flush">
      <table className="tbl">
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
