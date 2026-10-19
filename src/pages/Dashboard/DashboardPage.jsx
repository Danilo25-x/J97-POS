// src/pages/Dashboard/DashboardPage.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, CalendarDays, Banknote, Shirt, ShoppingBag, PackagePlus, Vault, Boxes, ChevronRight, TriangleAlert, PackageX, ChartLine, CircleCheck, Lock } from 'lucide-react'
import PageContainer from '../../components/UI/PageContainer'
import StatsCard from '../../components/UI/StatsCard'
import AreaChart from '../../components/UI/AreaChart'
import EmptyState from '../../components/UI/EmptyState'
import { useAuthStore } from '../../store/authStore'
import { fmt, cap } from '../../utils/format'

const fmtShort = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' }).replace('.', '') : ''
const METODO_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Crédito interno', sistecredito: 'Sistecrédito' }

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { user, hasPermission } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    window.electronAPI.reports.getDashboard().then(r => {
      if (r.ok) setData(r.data)
      setLoading(false)
    })
  }, [])

  if (loading) return <PageContainer title="Inicio"><div className="loading" role="status"><div className="spinner" />Cargando...</div></PageContainer>
  if (!data) return <PageContainer title="Inicio"><div className="notice notice--bad">No se pudieron cargar los datos. Cierra y vuelve a abrir la aplicación.</div></PageContainer>

  const firstName = (user?.name || '').split(' ')[0]
  const today = cap(new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
  const caja = data.cajaAbierta
  const chart = (data.ventas7dias || []).map(d => ({ label: fmtShort(d.dia), value: d.total || 0 }))
  const hayVentas = chart.some(d => d.value > 0)

  const actions = [
    { perm: 'sales',     icon: ShoppingBag, title: 'Nueva venta',      sub: 'Registrar una venta rápida', to: '/ventas' },
    { perm: 'inventory', icon: PackagePlus, title: 'Agregar producto', sub: 'Crear un producto nuevo',    to: '/inventory?new=1' },
    { perm: 'sales',     icon: Vault,       title: caja ? 'Ver caja' : 'Abrir caja', sub: caja ? 'Movimientos y cierre' : 'Iniciar la jornada', to: '/cash' },
    { perm: 'inventory', icon: Boxes,       title: 'Ver inventario',   sub: 'Consultar stock',            to: '/inventory' },
  ].filter(a => hasPermission(a.perm))

  return (
    <PageContainer
      title={<>Hola, {firstName} <span aria-hidden="true"></span></>}
      subtitle="Aquí tienes un resumen de tu tienda hoy."
      action={<span className="hello__date">{today}</span>}
    >
      <div className={`notice ${caja ? 'notice--ok' : 'notice--warn'}`} style={{ marginBottom: 22 }}>
        {caja ? <CircleCheck size={18} /> : <Lock size={18} />}
        {caja
          ? <span><strong>Caja abierta.</strong> Apertura {fmt(caja.opening_amount)} · {caja.num_sales || 0} venta(s) por {fmt(caja.total_sales)}</span>
          : <span><strong>No hay caja abierta.</strong> Ábrela en Ventas › Caja para empezar a vender.</span>}
      </div>

      <div className="kpis">
        <StatsCard accent title="Ventas de hoy" value={fmt(data.ventasHoy.total)} sub={`${data.ventasHoy.count} venta(s)`} icon={<Wallet size={22} />} />
        <StatsCard title="Ventas del mes" value={fmt(data.ventasMes.total)} sub="Acumulado del mes" icon={<CalendarDays size={22} />} />
        <StatsCard title="Apertura de caja" value={caja ? fmt(caja.opening_amount) : 'Cerrada'} sub={caja ? 'Efectivo inicial de hoy' : 'Sin jornada activa'} icon={<Banknote size={22} />} />
        <StatsCard title="Productos activos" value={data.inventarioStats?.total_products || 0} sub="En el catálogo" icon={<Shirt size={22} />} />
      </div>

      {(data.stockBajo > 0 || data.sinStock > 0) && (
        <div className="alerts">
          {data.sinStock > 0 && <div className="notice notice--bad"><PackageX size={18} /><span><strong>{data.sinStock}</strong> variante(s) sin stock</span></div>}
          {data.stockBajo > 0 && <div className="notice notice--warn"><TriangleAlert size={18} /><span><strong>{data.stockBajo}</strong> variante(s) con stock bajo</span></div>}
        </div>
      )}

      <div className="dash-grid">
        <section className="card">
          <div className="section-title"><h2>Ventas de la semana</h2><span className="page__sub" style={{ margin: 0 }}>Últimos 7 días</span></div>
          {hayVentas
            ? <AreaChart data={chart} label="Ventas de los últimos 7 días" />
            : <EmptyState small icon={<ChartLine size={26} />} title="Aún no hay ventas esta semana" text="Cuando registres ventas, verás aquí cómo evolucionan." />}
        </section>

        <div className="dash-side">
          {actions.length > 0 && (
            <section className="card">
              <div className="section-title"><h2>Acciones rápidas</h2></div>
              <div className="actions-list">
                {actions.map(a => (
                  <button key={a.title} type="button" className="action" onClick={() => navigate(a.to)}>
                    <span className="action__icon"><a.icon size={20} /></span>
                    <span><span className="action__title" style={{ display: 'block' }}>{a.title}</span><span className="action__sub">{a.sub}</span></span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="section-title"><h2>Métodos de pago</h2><span className="page__sub" style={{ margin: 0 }}>Este mes</span></div>
            {!data.ventasPorMetodo?.length ? (
              <p className="dashed">Sin datos este mes</p>
            ) : (
              <div className="meter">
                {data.ventasPorMetodo.map(m => {
                  const pct = Math.round((m.total / (data.ventasMes.total || 1)) * 100)
                  return (
                    <div key={m.method}>
                      <div className="meter__row"><span>{METODO_LABELS[m.method] || m.method}</span><b className="num">{fmt(m.total)}</b></div>
                      <div className="meter__track" role="img" aria-label={`${pct}%`}><div className="meter__fill" style={{ width: `${pct}%` }} /></div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  )
}
