import { useCallback, useEffect, useState } from 'react'
import { Banknote, LockKeyhole, LockOpen, Plus, ReceiptText, WalletCards, ChevronRight, X } from 'lucide-react'
import PageContainer from '../../components/UI/PageContainer'
import PrimaryButton from '../../components/UI/PrimaryButton'
import StatsCard from '../../components/UI/StatsCard'
import Toast from '../../components/UI/Toast'
import Modal from '../../components/UI/Modal'
import CashCloseModal from './components/CashCloseModal'
import { fmt, fmtDate } from '../../utils/format'

export default function CashRegisterPage() {
  const [caja, setCaja] = useState(null)
  const [history, setHistory] = useState([])
  const [openingAmount, setOpeningAmount] = useState('')
  const [expense, setExpense] = useState({ description: '', amount: '', category: 'Otros' })
  const [showOpen, setShowOpen] = useState(false)
  const [showExpense, setShowExpense] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: 'ok' })
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const notify = useCallback((text, type = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: 'ok' }), 3500)
  }, [])
  const load = useCallback(async () => {
    const [open, hist] = await Promise.all([window.electronAPI.cash.getOpen(), window.electronAPI.cash.getHistory({ limit: 30 })])
    if (open.ok) setCaja(open.data)
    if (hist.ok) setHistory(hist.data)
  }, [])
  useEffect(() => { load() }, [load])

  const open = async () => {
    const r = await window.electronAPI.cash.openRegister({ openingAmount: Number(openingAmount) || 0 })
    if (!r.ok) return notify(r.error, 'error')
    setShowOpen(false); setOpeningAmount(''); notify('Caja abierta'); load()
  }
  const addExpense = async () => {
    if (!expense.description.trim() || Number(expense.amount) <= 0) return
    const r = await window.electronAPI.cash.addExpense({ description: expense.description.trim(), amount: Number(expense.amount), category: expense.category })
    if (!r.ok) return notify(r.error, 'error')
    setShowExpense(false); setExpense({ description: '', amount: '', category: 'Otros' }); notify('Egreso registrado'); load()
  }
  const closed = () => { setShowClose(false); notify('Caja cerrada correctamente'); load() }
  const openDetail = async (id) => {
    setDetailLoading(true)
    const r = await window.electronAPI.cash.getDetail(id)
    setDetailLoading(false)
    if (r.ok) setDetail(r.data)
    else notify(r.error, 'error')
  }

  const cash = Number(caja?.cash_sales || 0)
  const totalSales = Number(caja?.total_sales || 0)
  const expenses = Number(caja?.total_expenses || 0)
  const expected = Number(caja?.expected_cash || (caja?.opening_amount || 0) + cash - expenses)

  return (
    <PageContainer title="Caja" subtitle="Control independiente de apertura, movimientos y cierre de caja" action={caja ? <span className="badge badge--ok"><LockOpen size={14} /> Caja abierta</span> : <span className="badge badge--bad"><LockKeyhole size={14} /> Caja cerrada</span>}>
      <Toast msg={msg} />
      <div className="kpis">
        <StatsCard title="Efectivo esperado" value={fmt(expected)} icon={<Banknote size={21} />} sub={caja ? 'Apertura + efectivo − egresos' : 'Sin caja abierta'} />
        <StatsCard title="Ventas del turno" value={fmt(totalSales)} icon={<ReceiptText size={21} />} sub={`${caja?.num_sales || 0} venta(s)`} />
        <StatsCard title="Egresos" value={fmt(expenses)} icon={<WalletCards size={21} />} />
        <StatsCard title="Apertura" value={fmt(caja?.opening_amount || 0)} icon={<LockOpen size={21} />} />
      </div>

      {!caja ? (
        <div className="card">
          <div className="section-title"><div><h2>Iniciar jornada</h2><p className="page__sub">Abre la caja con el efectivo inicial antes de registrar ventas.</p></div><PrimaryButton onClick={() => setShowOpen(true)}><LockOpen size={18} /> Abrir caja</PrimaryButton></div>
        </div>
      ) : (
        <div className="card">
          <div className="section-title"><div><h2>Caja actual</h2><p className="page__sub">Cajero: {caja.cajero || 'Usuario'} · Abierta {fmtDate(caja.opened_at)}</p></div><div className="page__actions"><PrimaryButton variant="soft" onClick={() => setShowExpense(true)}><Plus size={18} /> Registrar egreso</PrimaryButton><PrimaryButton onClick={() => setShowClose(true)}><LockKeyhole size={18} /> Cerrar caja</PrimaryButton></div></div>
          <div className="mini-table">
            {[
              ['Efectivo', caja.cash_sales], ['Transferencia', caja.transfer_sales], ['Crédito interno', caja.credit_sales], ['Sistecrédito', caja.sistecredito_sales],
            ].map(([label, value]) => <div className="mini-row" key={label}><span>{label}</span><b>{fmt(value)}</b></div>)}
            <div className="mini-row mini-row--total"><span>Total ventas</span><b>{fmt(totalSales)}</b></div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="section-title"><div><h2>Historial de cajas</h2><p className="page__sub">Jornadas cerradas y sus resultados.</p></div></div>
        {!history.length ? <div className="empty--sm empty"><span>Aún no hay cierres registrados.</span></div> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Apertura</th><th>Cierre</th><th>Cajero</th><th className="r">Ventas</th><th className="r">Diferencia</th><th>Estado</th><th></th></tr></thead><tbody>{history.map(row => <tr key={row.id} onClick={() => openDetail(row.id)} style={{ cursor: 'pointer' }}><td>{fmtDate(row.opened_at)}</td><td>{fmtDate(row.closed_at)}</td><td>{row.cajero || '—'}</td><td className="r">{fmt(row.total_sales)}</td><td className="r">{fmt(row.difference)}</td><td><span className="badge badge--neutral">Cerrada</span></td><td className="r"><ChevronRight size={17} /></td></tr>)}</tbody></table></div>}
      </div>

      {detail && <Modal isOpen onClose={() => setDetail(null)} title={`Cierre de caja · ${fmtDate(detail.closed_at)}`} width={900}>
        {detailLoading ? <div className="loading">Cargando detalle...</div> : <>
          <div className="kv">
            <div><small>Cajero</small><b>{detail.cajero || '—'}</b></div>
            <div><small>Apertura</small><b>{fmtDate(detail.opened_at)}</b></div>
            <div><small>Cierre</small><b>{fmtDate(detail.closed_at)}</b></div>
            <div><small>Ventas</small><b>{fmt(detail.total_sales)}</b></div>
            <div><small>Efectivo esperado</small><b>{fmt(detail.expected_amount)}</b></div>
            <div><small>Efectivo contado</small><b>{fmt(detail.closing_amount)}</b></div>
            <div><small>Diferencia</small><b>{fmt(detail.difference)}</b></div>
          </div>
          <div className="mini-table" style={{ marginTop: 18 }}>
            <h4>Ventas de la jornada ({detail.sales_list?.length || 0})</h4>
            {!detail.sales_list?.length ? <div className="empty--sm empty"><span>No hubo ventas registradas.</span></div> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Factura</th><th>Fecha</th><th>Cajero</th><th>Medio(s)</th><th>Estado</th><th className="r">Total</th></tr></thead><tbody>{detail.sales_list.map(sale => <tr key={sale.id}><td>{sale.invoice_number}</td><td>{fmtDate(sale.created_at)}</td><td>{sale.cajero || '—'}</td><td>{sale.payments_summary || '—'}</td><td>{sale.status === 'completed' ? 'Completada' : 'Cancelada'}</td><td className="r">{fmt(sale.total)}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <div className="mini-table"><h4>Egresos ({detail.expenses_list?.length || 0})</h4>{detail.expenses_list?.length ? detail.expenses_list.map(e => <div className="mini-row" key={e.id}><span>{e.description}</span><b>{fmt(e.amount)}</b></div>) : <div className="empty--sm empty"><span>Sin egresos.</span></div>}</div>
            <div className="mini-table"><h4>Cobros de crédito ({detail.collections_list?.length || 0})</h4>{detail.collections_list?.length ? detail.collections_list.map(c => <div className="mini-row" key={c.id}><span>{c.description} · {c.payment_method}</span><b>{fmt(c.amount)}</b></div>) : <div className="empty--sm empty"><span>Sin cobros.</span></div>}</div>
          </div>
          {detail.notes && <div className="notice notice--info" style={{ marginTop: 18 }}><b>Observaciones:</b>&nbsp;{detail.notes}</div>}
        </>}
      </Modal>}
      {showOpen && <Modal isOpen onClose={() => setShowOpen(false)} title="Abrir caja" width={460}><div className="field"><label className="field__label" htmlFor="opening">Efectivo inicial</label><input id="opening" className="input input--money" type="number" min="0" value={openingAmount} onChange={e => setOpeningAmount(e.target.value)} placeholder="0" autoFocus /></div><div className="modal__foot modal__foot--split"><PrimaryButton variant="ghost" onClick={() => setShowOpen(false)}>Cancelar</PrimaryButton><PrimaryButton onClick={open}>Abrir caja</PrimaryButton></div></Modal>}
      {showExpense && <Modal isOpen onClose={() => setShowExpense(false)} title="Registrar egreso" width={500}><div className="field"><label className="field__label" htmlFor="expense-desc">Descripción *</label><input id="expense-desc" className="input" value={expense.description} onChange={e => setExpense({ ...expense, description: e.target.value })} placeholder="Ej. Compra de papelería" /></div><div className="form-grid"><div className="field"><label className="field__label" htmlFor="expense-amount">Monto *</label><input id="expense-amount" className="input input--money" type="number" min="1" value={expense.amount} onChange={e => setExpense({ ...expense, amount: e.target.value })} /></div><div className="field"><label className="field__label" htmlFor="expense-cat">Categoría</label><select id="expense-cat" className="select" value={expense.category} onChange={e => setExpense({ ...expense, category: e.target.value })}>{['Transporte', 'Compras', 'Servicios', 'Papelería', 'Mantenimiento', 'Otros'].map(x => <option key={x}>{x}</option>)}</select></div></div><div className="modal__foot modal__foot--split"><PrimaryButton variant="ghost" onClick={() => setShowExpense(false)}>Cancelar</PrimaryButton><PrimaryButton disabled={!expense.description.trim() || Number(expense.amount) <= 0} onClick={addExpense}>Registrar egreso</PrimaryButton></div></Modal>}
      <CashCloseModal isOpen={showClose} onClose={() => setShowClose(false)} onClosed={closed} />
    </PageContainer>
  )
}
