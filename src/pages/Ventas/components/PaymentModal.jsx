import { useEffect, useState } from 'react'
import { Banknote, Smartphone, NotebookPen, TriangleAlert, UserRound, Landmark } from 'lucide-react'
import Modal from '../../../components/UI/Modal'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import { fmt, parseCopInput, formatCopInput } from '../../../utils/format'

const METODOS = [
  { key: 'efectivo',      label: 'Efectivo',      icon: Banknote },
  { key: 'transferencia', label: 'Transferencia', icon: Smartphone },
  { key: 'credito',       label: 'Crédito interno', icon: NotebookPen },
  { key: 'sistecredito', label: 'Sistecrédito', icon: Landmark },
]

export default function PaymentModal({ total, onConfirm, onClose }) {
  const [method, setMethod] = useState('efectivo')
  const [paid, setPaid]     = useState('')
  const [ref, setRef]       = useState('')
  const [notes, setNotes]   = useState('')
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [installments, setInstallments] = useState('1')
  const [sisteRate, setSisteRate] = useState('0')
  const financingRate = Math.max(0, Number(sisteRate) || 0)
  const financedTotal = ['credito', 'sistecredito'].includes(method) ? Math.round(total * (1 + financingRate / 100)) : total
  const [loadingCustomers, setLoadingCustomers] = useState(false)

  useEffect(() => {
    if (method !== 'credito') return
    setLoadingCustomers(true)
    window.electronAPI.customers.list({ page: 1, pageSize: 100 }).then(r => {
      if (r.ok) setCustomers(r.data.items)
    }).finally(() => setLoadingCustomers(false))
  }, [method])

  const paidNum = parseCopInput(paid)
  const rate = financingRate
  const change  = method === 'efectivo' ? Math.max(0, paidNum - total) : 0
  const isValid = method === 'credito'
    ? Boolean(customerId) && Number.isInteger(Number(installments)) && Number(installments) >= 1
    : method === 'sistecredito'
      ? rate >= 0 && rate <= 100
      : method !== 'efectivo' || paidNum >= total

  const handleConfirm = () => {
    if (!isValid) return
    // El efectivo recibido puede ser mayor por el cambio; la venta y la caja registran solo el valor real de la venta.
    const amount = method === 'efectivo' ? total : financedTotal
    onConfirm({
      payments: [{ method, amount, reference: ref || null }],
      notes,
      customerId: method === 'credito' ? Number(customerId) : null,
      installments: method === 'credito' ? Number(installments) : null,
      financingPct: ['credito', 'sistecredito'].includes(method) ? rate : 0,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Cobrar venta" width={540}>
      <div className="total-block">
        <small>Total a cobrar</small>
        <strong>{fmt(total)}</strong>
      </div>

      <div className="field__label">Método de pago</div>
      <div className="methods" role="group" aria-label="Método de pago">
        {METODOS.map(m => (
          <button key={m.key} type="button" className="method" aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>
            <m.icon size={22} /> {m.label}
          </button>
        ))}
      </div>

      {method === 'efectivo' && (
        <div className="field">
          <label className="field__label" htmlFor="paid">Monto recibido</label>
          <input
            id="paid"
            className={`input input--money input--high-contrast ${paid && paidNum < total ? 'input--error' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={paid}
            onChange={e => setPaid(formatCopInput(e.target.value))}
            placeholder={`Mínimo ${fmt(total)}`}
            autoFocus
          />
          {paid && paidNum < total && <p className="field__error">Monto insuficiente. Faltan {fmt(total - paidNum)}.</p>}
          {change > 0 && (
            <div className="notice notice--ok" style={{ marginTop: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Cambio a entregar</strong>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{fmt(change)}</strong>
            </div>
          )}
        </div>
      )}

      {method === 'transferencia' && (
        <div className="field">
          <label className="field__label" htmlFor="ref">Número de referencia (opcional)</label>
          <input id="ref" className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="Ej. 123456789" />
        </div>
      )}

      {method === 'sistecredito' && (
        <>
          <div className="notice notice--warn" style={{ marginBottom: 16 }}>
            <TriangleAlert size={18} /> <span>Sistecrédito se registra de forma independiente y no requiere asociarlo a un cliente.</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="siste-rate">Porcentaje adicional *</label>
            <input id="siste-rate" className="input" type="number" min="0" max="100" step="0.01" value={sisteRate} onChange={e => setSisteRate(e.target.value)} />
          </div>
          <div className="notice notice--ok">
            <span>Valor real: <strong>{fmt(total)}</strong> · Total Sistecrédito: <strong>{fmt(financedTotal)}</strong></span>
          </div>
        </>
      )}

      {method === 'credito' && (
        <>
          <div className="notice notice--warn" style={{ marginBottom: 16 }}>
            <TriangleAlert size={18} /> <span>La venta quedará registrada como crédito interno y el saldo quedará asociado al cliente.</span>
          </div>
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="credit-customer"><UserRound size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Cliente *</label>
              <select id="credit-customer" className="select" value={customerId} onChange={e => setCustomerId(e.target.value)} disabled={loadingCustomers}>
                <option value="">{loadingCustomers ? 'Cargando clientes...' : 'Selecciona un cliente'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}{Number(c.pending_balance) > 0 ? ` · Saldo ${fmt(c.pending_balance)}` : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="credit-rate">Porcentaje adicional *</label>
              <input id="credit-rate" className="input" type="number" min="0" max="100" step="0.01" value={sisteRate} onChange={e => setSisteRate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="installments">Número de cuotas *</label>
              <input id="installments" className="input" type="number" min="1" max="120" value={installments} onChange={e => setInstallments(e.target.value)} />
            </div>
          </div>
          <div className="notice notice--ok">Valor real: <strong>{fmt(total)}</strong> · Total crédito: <strong>{fmt(financedTotal)}</strong> · Cuota aprox.: <strong>{fmt(financedTotal / Math.max(1, Number(installments) || 1))}</strong></div>
        </>
      )}

      <div className="field" style={{ marginBottom: 22 }}>
        <label className="field__label" htmlFor="notes">Nota de venta (opcional)</label>
        <input id="notes" className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..." />
      </div>

      <div className="modal__foot modal__foot--split">
        <PrimaryButton variant="ghost" onClick={onClose}>Cancelar</PrimaryButton>
        <PrimaryButton disabled={!isValid} onClick={handleConfirm}>Confirmar {fmt(financedTotal)}</PrimaryButton>
      </div>
    </Modal>
  )
}
