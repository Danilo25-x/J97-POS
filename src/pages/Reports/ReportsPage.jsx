// src/pages/Reports/ReportsPage.jsx
import { useEffect, useState, useCallback } from 'react'
import PageContainer from '../../components/UI/PageContainer'
import StatsCard from '../../components/UI/StatsCard'
import PrimaryButton from '../../components/UI/PrimaryButton'
import StatusBadge from '../../components/UI/StatusBadge'
import EmptyState from '../../components/UI/EmptyState'
import { Wallet, Receipt, ChartColumn, Ban, ChartNoAxesCombined } from 'lucide-react'
import { fmt, fmtDate } from '../../utils/format'


const FILTERS = [
  { key:'today',    label:'Hoy' },
  { key:'week',     label:'7 días' },
  { key:'month',    label:'Este mes' },
  { key:'prevMonth',label:'Mes anterior' },
  { key:'custom',   label:'Personalizado' },
]

function getDateRange(filter) {
  const now  = new Date()
  const pad  = n => String(n).padStart(2,'0')
  const ymd  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const today = ymd(now)

  if (filter === 'today') return { from: today, to: today }
  if (filter === 'week') {
    const d = new Date(now); d.setDate(d.getDate()-6)
    return { from: ymd(d), to: today }
  }
  if (filter === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: ymd(d), to: today }
  }
  if (filter === 'prevMonth') {
    const first = new Date(now.getFullYear(), now.getMonth()-1, 1)
    const last  = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: ymd(first), to: ymd(last) }
  }
  return null
}

export default function ReportsPage() {
  const [activeFilter, setActiveFilter] = useState('month')
  const [customFrom, setCustomFrom]     = useState('')
  const [customTo, setCustomTo]         = useState('')
  const [activeTab, setActiveTab]       = useState('ventas')

  const [dashboard, setDashboard] = useState(null)
  const [sales, setSales]         = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading]     = useState(false)

  const getRange = useCallback(() => {
    if (activeFilter === 'custom') {
      if (customFrom && customTo) return { from: customFrom, to: customTo }
      return null
    }
    return getDateRange(activeFilter)
  }, [activeFilter, customFrom, customTo])

  const loadData = useCallback(async () => {
    setLoading(true)
    const range = getRange()

    const [dash, salesRes, topRes, invRes] = await Promise.all([
      window.electronAPI.reports.getDashboard(),
      window.electronAPI.reports.getSalesReport(range ? { ...range, limit:100 } : { limit:100 }),
      window.electronAPI.reports.getTopProducts(range ? { ...range, limit:10 } : { limit:10 }),
      window.electronAPI.reports.getInventoryReport(),
    ])

    if (dash.ok)    setDashboard(dash.data)
    if (salesRes.ok) setSales(salesRes.data.items || [])
    if (topRes.ok)  setTopProducts(topRes.data || [])
    if (invRes.ok)  setInventory(invRes.data || [])
    setLoading(false)
  }, [getRange])

  useEffect(() => { loadData() }, [activeFilter])

  const totalVentas   = sales.filter(s=>s.status==='completed').reduce((a,s)=>a+s.total,0)
  const countVentas   = sales.filter(s=>s.status==='completed').length
  const avgVenta      = countVentas ? totalVentas/countVentas : 0
  const canceladas    = sales.filter(s=>s.status==='cancelled').length

  const sinStock  = inventory.filter(p=>p.total_stock===0).length
  const bajStock  = inventory.filter(p=>p.total_stock>0&&p.total_stock<=5).length
  const valInv    = inventory.reduce((s,p)=>s+p.value,0)

  return (
    <PageContainer title="Reportes" subtitle="Análisis de ventas e inventario">

      <div className="card filters">
        <span className="filters__label">Período</span>
        <div className="chips">
          {FILTERS.map(f => <button key={f.key} type="button" className="chip" aria-pressed={activeFilter === f.key} onClick={() => setActiveFilter(f.key)}>{f.label}</button>)}
        </div>
        {activeFilter === 'custom' && (
          <>
            <input type="date" className="input input--sm" aria-label="Desde" style={{ width: 160 }} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span style={{ color: 'var(--muted)' }}>a</span>
            <input type="date" className="input input--sm" aria-label="Hasta" style={{ width: 160 }} value={customTo} onChange={e => setCustomTo(e.target.value)} />
            <PrimaryButton size="sm" onClick={loadData} disabled={!customFrom || !customTo}>Aplicar</PrimaryButton>
          </>
        )}
      </div>

      <div className="kpis">
        <StatsCard accent title="Ventas del período" value={fmt(totalVentas)} icon={<Wallet size={22} />} />
        <StatsCard title="N.° de ventas" value={countVentas} icon={<Receipt size={22} />} />
        <StatsCard title="Promedio por venta" value={fmt(avgVenta)} icon={<ChartColumn size={22} />} />
        <StatsCard title="Canceladas" value={canceladas} icon={<Ban size={22} />} />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '0 22px' }}>
          <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
            {[['ventas', 'Ventas'], ['productos', 'Productos'], ['inventario', 'Inventario']].map(([k, l]) => (
              <button key={k} type="button" role="tab" className="tab" aria-selected={activeTab === k} onClick={() => setActiveTab(k)}>{l}</button>
            ))}
          </div>
        </div>

        {loading && <div className="loading" role="status"><div className="spinner" />Cargando datos...</div>}

        {!loading && activeTab === 'ventas' && (
          sales.length === 0 ? <EmptyState icon={<ChartNoAxesCombined size={28} />} title="Sin ventas en este período" /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Factura</th><th>Fecha</th><th>Cajero</th><th className="r">Total</th><th>Estado</th></tr></thead>
              <tbody>{sales.map(s => (
                <tr key={s.id}>
                  <td className="cell-link">{s.invoice_number}</td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(s.created_at)}</td>
                  <td>{s.cajero}</td>
                  <td className="r num cell-main">{fmt(s.total)}</td>
                  <td><StatusBadge status={s.status === 'completed' ? 'Completada' : 'Cancelada'} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        )}

        {!loading && activeTab === 'productos' && (
          topProducts.length === 0 ? <EmptyState icon={<ChartNoAxesCombined size={28} />} title="Sin datos de ventas en este período" /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Producto</th><th className="c">Unidades</th><th className="c">Ventas</th><th className="r">Ingresos</th></tr></thead>
              <tbody>{topProducts.map((p, i) => (
                <tr key={i}>
                  <td><div className="cell-main">{p.name}</div><div className="cell-sub">{p.sku}</div></td>
                  <td className="c num cell-main">{p.total_qty}</td>
                  <td className="c num" style={{ color: 'var(--muted)' }}>{p.num_sales}</td>
                  <td className="r num cell-main" style={{ color: 'var(--plum-700)' }}>{fmt(p.total_revenue)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        )}

        {!loading && activeTab === 'inventario' && (
          <>
            <div className="stat3" style={{ padding: '20px 22px 0' }}>
              <div className="s-bad"><strong>{sinStock}</strong><span>Sin stock</span></div>
              <div className="s-warn"><strong>{bajStock}</strong><span>Stock bajo</span></div>
              <div className="s-ok"><strong>{fmt(valInv)}</strong><span>Valor del inventario</span></div>
            </div>
            {inventory.length === 0 ? <EmptyState icon={<ChartNoAxesCombined size={28} />} title="Sin productos en inventario" /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Producto</th><th className="c">Variantes</th><th className="c">Stock</th><th className="r">P. venta</th><th className="r">Valor</th></tr></thead>
                <tbody>{inventory.map((p, i) => (
                  <tr key={i}>
                    <td><div className="cell-main">{p.name}</div><div className="cell-sub">{p.sku} · {p.category || 'Sin categoría'}</div></td>
                    <td className="c num" style={{ color: 'var(--muted)' }}>{p.variants}</td>
                    <td className="c"><span className={`stock-pill stock-pill--${p.total_stock === 0 ? 'bad' : p.total_stock <= 5 ? 'warn' : 'ok'}`}>{p.total_stock}</span></td>
                    <td className="r num">{fmt(p.sale_price)}</td>
                    <td className="r num cell-main" style={{ color: 'var(--plum-700)' }}>{fmt(p.value)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  )
}
