import { useCallback, useEffect, useState } from 'react'
import { Eye, Pencil, Plus, WalletCards, UserRound, UserX, Search, CreditCard } from 'lucide-react'
import PageContainer from '../../components/UI/PageContainer'
import StatsCard from '../../components/UI/StatsCard'
import PrimaryButton from '../../components/UI/PrimaryButton'
import Modal from '../../components/UI/Modal'
import Toast from '../../components/UI/Toast'
import EmptyState from '../../components/UI/EmptyState'
import { fmt, fmtDateMedium } from '../../utils/format'

const EMPTY = { name: '', document: '', phone: '', email: '', address: '', notes: '' }

function CustomerForm({ value, onChange, onSubmit, onClose, saving, edit }) {
  return (
    <Modal isOpen onClose={onClose} title={edit ? 'Editar cliente' : 'Nuevo cliente'} width={620}>
      <div className="form-grid">
        {[
          ['name', 'Nombre completo *'], ['document', 'Documento *'], ['phone', 'Teléfono *'], ['email', 'Correo electrónico'],
          ['address', 'Dirección'],
        ].map(([key, label]) => (
          <div className="field" key={key}>
            <label className="field__label" htmlFor={`customer-${key}`}>{label}</label>
            <input
              id={`customer-${key}`}
              className="input"
              value={value[key]}
              inputMode={key === 'document' || key === 'phone' ? 'numeric' : undefined}
              autoComplete={key === 'document' ? 'off' : key === 'phone' ? 'tel' : undefined}
              maxLength={key === 'document' ? 15 : key === 'phone' ? 15 : undefined}
              onChange={e => {
                const next = key === 'document' || key === 'phone'
                  ? e.target.value.replace(/\D/g, '')
                  : e.target.value
                onChange({ ...value, [key]: next })
              }}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="customer-notes">Notas</label>
        <textarea id="customer-notes" className="textarea" rows={3} value={value.notes} onChange={e => onChange({ ...value, notes: e.target.value })} />
      </div>
      <div className="modal__foot modal__foot--split">
        <PrimaryButton variant="ghost" onClick={onClose}>Cancelar</PrimaryButton>
        <PrimaryButton disabled={saving || !value.name.trim() || !value.document.trim() || !value.phone.trim()} onClick={onSubmit}>{saving ? 'Guardando...' : edit ? 'Guardar cambios' : 'Crear cliente'}</PrimaryButton>
      </div>
    </Modal>
  )
}

export default function CustomersPage() {
  const [items, setItems] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, debt: 0 })
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [detail, setDetail] = useState(null)
  const [payment, setPayment] = useState(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: 'ok' })

  const notify = useCallback((text, type = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: 'ok' }), 3500)
  }, [])

  const load = useCallback(async () => {
    const r = await window.electronAPI.customers.list({ search, page: 1, pageSize: 100 })
    if (!r.ok) return notify(r.error || 'No se pudieron cargar los clientes', 'error')
    setItems(r.data.items)
    setStats({
      total: r.data.total,
      active: r.data.items.length,
      debt: r.data.items.reduce((sum, c) => sum + Number(c.pending_balance || 0), 0),
    })
  }, [search, notify])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm(EMPTY); setModal('create') }
  const openEdit = async id => {
    const r = await window.electronAPI.customers.get(id)
    if (!r.ok) return notify(r.error, 'error')
    setForm({ ...EMPTY, ...r.data }); setModal('edit')
  }
  const submit = async () => {
    setSaving(true)
    const r = modal === 'edit'
      ? await window.electronAPI.customers.update(form)
      : await window.electronAPI.customers.create(form)
    setSaving(false)
    if (!r.ok) return notify(r.error || 'No se pudo guardar el cliente', 'error')
    setModal(null); notify(modal === 'edit' ? 'Cliente actualizado' : 'Cliente creado'); load()
  }

  const openDetail = async id => {
    const r = await window.electronAPI.customers.get(id)
    if (r.ok) setDetail(r.data)
    else notify(r.error, 'error')
  }

  const deactivate = async id => {
    if (!window.confirm('¿Desactivar este cliente? Solo es posible si no tiene saldo pendiente.')) return
    const r = await window.electronAPI.customers.deactivate(id)
    if (!r.ok) return notify(r.error, 'error')
    notify('Cliente desactivado'); load()
  }

  const registerPayment = async () => {
    const amount = Number(paymentAmount)
    if (!payment || !Number.isFinite(amount) || amount <= 0) return
    setSaving(true)
    const r = await window.electronAPI.customers.registerPayment({ creditId: payment.id, amount, notes: paymentNotes, paymentMethod })
    setSaving(false)
    if (!r.ok) return notify(r.error, 'error')
    setPayment(null); setPaymentAmount(''); setPaymentNotes(''); setPaymentMethod('efectivo'); notify('Abono registrado');
    if (detail?.id) openDetail(detail.id)
    load()
  }

  return (
    <PageContainer title="Clientes" subtitle="Clientes, crédito interno y saldos pendientes" action={<PrimaryButton onClick={openCreate}><Plus size={18} /> Nuevo cliente</PrimaryButton>}>
      <Toast msg={msg} />
      <div className="kpis">
        <StatsCard title="Clientes" value={stats.total} icon={<UserRound size={21} />} />
        <StatsCard title="Clientes activos" value={stats.active} icon={<UserRound size={21} />} />
        <StatsCard title="Saldo por cobrar" value={fmt(stats.debt)} icon={<WalletCards size={21} />} sub="Crédito interno pendiente" />
      </div>

      <div className="card card--flush">
        <div className="card__head">
          <div className="search" style={{ flex: 1, maxWidth: 520 }}>
            <Search size={18} />
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, documento o teléfono..." />
          </div>
        </div>
        {!items.length ? <EmptyState icon={<UserRound size={28} />} title="No hay clientes" text={search ? 'No encontramos coincidencias.' : 'Crea el primer cliente para habilitar el crédito interno.'} /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Cliente</th><th>Contacto</th><th className="r">Compras</th><th className="r">Saldo crédito</th><th>Estado</th><th className="r">Acciones</th></tr></thead>
              <tbody>{items.map(c => (
                <tr key={c.id}>
                  <td><div className="cell-main">{c.name}</div><div className="cell-sub">{c.document || 'Sin documento'}</div></td>
                  <td><div>{c.phone || '—'}</div><div className="cell-sub">{c.email || 'Sin correo'}</div></td>
                  <td className="r">{c.purchase_count}</td>
                  <td className="r"><strong>{fmt(c.pending_balance)}</strong></td>
                  <td><span className={`badge ${Number(c.pending_balance) > 0 ? 'badge--warn' : 'badge--ok'}`}>{Number(c.pending_balance) > 0 ? 'Con saldo' : 'Al día'}</span></td>
                  <td><div className="row-actions">
                    <button className="icon-btn" title="Ver detalle" onClick={() => openDetail(c.id)}><Eye size={17} /></button>
                    <button className="icon-btn" title="Editar" onClick={() => openEdit(c.id)}><Pencil size={17} /></button>
                    <button className="icon-btn icon-btn--danger" title="Desactivar" onClick={() => deactivate(c.id)}><UserX size={17} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {(modal === 'create' || modal === 'edit') && <CustomerForm value={form} onChange={setForm} onSubmit={submit} onClose={() => setModal(null)} saving={saving} edit={modal === 'edit'} />}

      {detail && (
        <Modal isOpen onClose={() => setDetail(null)} title={detail.name} width={720}>
          <div className="kv">
            <div><small>Documento</small><b>{detail.document || '—'}</b></div>
            <div><small>Teléfono</small><b>{detail.phone || '—'}</b></div>
            <div><small>Correo</small><b>{detail.email || '—'}</b></div>
            <div><small>Dirección</small><b>{detail.address || '—'}</b></div>
          </div>
          <div className="section-title"><h2>Créditos internos</h2><span className="badge badge--warn">{fmt(detail.credits.reduce((s, c) => s + Number(c.balance || 0), 0))} pendiente</span></div>
          {!detail.credits.length ? <EmptyState small icon={<CreditCard size={24} />} title="Sin créditos" text="Este cliente todavía no tiene ventas a crédito." /> : (
            <div className="mini-table">
              {detail.credits.map(c => <div className="mini-row" key={c.id}>
                <span><b>{c.invoice_number}</b><small style={{ display: 'block', color: 'var(--muted)' }}>{fmtDateMedium(c.created_at)} · {c.installment_count} cuota(s)</small></span>
                <span style={{ textAlign: 'right' }}><b>{fmt(c.balance)}</b>{c.status === 'pending' && <button className="btn btn--soft btn--sm" style={{ marginLeft: 10 }} onClick={() => { setPayment(c); setPaymentAmount(String(c.balance)); setPaymentNotes('') }}>Registrar abono</button>}</span>
              </div>)}
            </div>
          )}
          <div className="modal__foot"><PrimaryButton variant="ghost" onClick={() => setDetail(null)}>Cerrar</PrimaryButton></div>
        </Modal>
      )}

      {payment && (
        <Modal isOpen onClose={() => setPayment(null)} title="Registrar abono" width={500}>
          <div className="total-block"><small>Saldo pendiente</small><strong>{fmt(payment.balance)}</strong></div>
          <div className="field"><label className="field__label" htmlFor="payment-amount">Monto del abono *</label><input id="payment-amount" className="input input--money" type="number" min="1" max={payment.balance} value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} /></div>
          <div className="field"><label className="field__label" htmlFor="payment-method">Método de abono</label><select id="payment-method" className="select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>{[['efectivo','Efectivo'],['transferencia','Transferencia']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div><div className="field"><label className="field__label" htmlFor="payment-notes">Nota (opcional)</label><textarea id="payment-notes" className="textarea" rows={3} value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} /></div>
          <div className="modal__foot modal__foot--split"><PrimaryButton variant="ghost" onClick={() => setPayment(null)}>Cancelar</PrimaryButton><PrimaryButton disabled={saving || Number(paymentAmount) <= 0 || Number(paymentAmount) > Number(payment.balance)} onClick={registerPayment}>{saving ? 'Registrando...' : 'Registrar abono'}</PrimaryButton></div>
        </Modal>
      )}
    </PageContainer>
  )
}
