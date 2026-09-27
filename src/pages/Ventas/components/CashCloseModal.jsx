// src/pages/Ventas/components/CashCloseModal.jsx
import { useState, useEffect } from 'react'
import { Check, TriangleAlert, FileDown } from 'lucide-react'
import Modal from '../../../components/UI/Modal'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import { fmt, fmtDateMedium } from '../../../utils/format'

const METODOS = [
  { key: 'cash_sales',     label: 'Efectivo' },
  { key: 'transfer_sales', label: 'Transferencia' },
  { key: 'credit_sales',   label: 'Crédito interno' },
  { key: 'sistecredito_sales', label: 'Sistecrédito' },
]

export default function CashCloseModal({ isOpen, onClose, onClosed }) {
  const [step, setStep]             = useState(1)
  const [preview, setPreview]       = useState(null)
  const [closingAmount, setClosing] = useState('')
  const [notes, setNotes]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [closing, setClosingAction] = useState(false)
  const [closed, setClosed]         = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfMsg, setPdfMsg]         = useState('')

  useEffect(() => {
    if (isOpen) {
      setStep(1); setClosing(''); setNotes(''); setClosed(null); setPdfMsg(''); setLoading(true)
      window.electronAPI.cash.getClosePreview().then(r => {
        if (r.ok) setPreview(r.data)
        setLoading(false)
      })
    }
  }, [isOpen])

  const closingNum = parseFloat(closingAmount) || 0
  const expected   = preview?.expected_cash || 0
  const difference = closingNum - expected
  const tone       = difference < 0 ? 'bad' : difference > 0 ? 'warn' : 'ok'
  const diffLabel  = difference > 0 ? `Sobrante: ${fmt(difference)}` : difference < 0 ? `Faltante: ${fmt(Math.abs(difference))}` : 'Cuadre exacto'

  const handleClose = async () => {
    setClosingAction(true)
    const r = await window.electronAPI.cash.closeRegister({ closingAmount: closingNum, notes })
    setClosingAction(false)
    if (r.ok) { setClosed(r.data); setStep(3); onClosed() }
  }

  const handlePdf = async () => {
    if (!closed) return
    setPdfLoading(true)
    const r = await window.electronAPI.documents.cashPdf({ ...closed, expenses: closed.expenses_list || [], notes: notes || '' })
    setPdfLoading(false)
    setPdfMsg(r.ok ? `PDF guardado en: ${r.path}` : `Error: ${r.error}`)
  }

  return (
    <Modal isOpen={isOpen} onClose={step === 3 ? onClose : undefined} title="Cierre de caja" width={620}>
      {loading ? (
        <div className="loading" role="status"><div className="spinner" />Calculando totales...</div>
      ) : !preview && step < 3 ? (
        <div className="notice notice--bad">No hay caja abierta.</div>
      ) : (
        <>
          {step === 1 && (
            <>
              <div className="kv">
                <div><small>Cajero</small><b>{preview.caja.cajero}</b></div>
                <div><small>Apertura</small><b>{fmtDateMedium(preview.caja.opened_at)}</b></div>
                <div><small>Monto inicial</small><b>{fmt(preview.caja.opening_amount)}</b></div>
                <div><small>N.° de ventas</small><b>{preview.totales.num_sales}</b></div>
              </div>

              <div className="mini-table">
                <h4>Ventas por método de pago</h4>
                {METODOS.map(m => (
                  <div className="mini-row" key={m.key} style={{ color: preview.totales[m.key] > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                    <span>{m.label}</span><b>{fmt(preview.totales[m.key])}</b>
                  </div>
                ))}
                <div className="mini-row mini-row--total"><span>Total ventas</span><b>{fmt(preview.totales.total_sales)}</b></div>
              </div>

              {preview.totales.total_credit_collections > 0 && (
                <div className="mini-table">
                  <h4>Cobros de crédito interno</h4>
                  {[['Efectivo','credit_collection_cash'],['Transferencia','credit_collection_transfer']].map(([label,key]) => (
                    <div className="mini-row" key={key}><span>{label}</span><b>{fmt(preview.totales[key])}</b></div>
                  ))}
                  <div className="mini-row mini-row--total"><span>Total cobros</span><b>{fmt(preview.totales.total_credit_collections)}</b></div>
                </div>
              )}

              {preview.expenses_list?.length > 0 && (
                <div className="mini-table">
                  <h4>Gastos registrados</h4>
                  {preview.expenses_list.map((g, i) => (
                    <div className="mini-row" key={i}>
                      <span>{g.description}{g.category && g.category !== 'Otros' && <small style={{ color: 'var(--muted)', marginLeft: 6 }}>({g.category})</small>}</span>
                      <b style={{ color: 'var(--bad)' }}>{fmt(g.amount)}</b>
                    </div>
                  ))}
                  <div className="mini-row mini-row--bad"><span>Total gastos</span><b>{fmt(preview.total_expenses)}</b></div>
                </div>
              )}

              <div className="expected">
                <small>Efectivo esperado en caja</small>
                <strong>{fmt(expected)}</strong>
                <span>Apertura + ventas en efectivo − gastos</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="counted">Dinero contado en caja *</label>
                <input id="counted" className="input input--money" type="number" min="0" value={closingAmount} onChange={e => setClosing(e.target.value)} placeholder="0" />
              </div>

              {closingAmount !== '' && (
                <div className={`diff diff--${tone}`}><small>Diferencia de caja</small><strong>{diffLabel}</strong></div>
              )}

              <div className="field" style={{ marginBottom: 22 }}>
                <label className="field__label" htmlFor="close-notes">Observaciones (opcional)</label>
                <textarea id="close-notes" className="textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas del cierre..." />
              </div>

              <div className="modal__foot">
                <PrimaryButton variant="ghost" onClick={onClose}>Cancelar</PrimaryButton>
                <PrimaryButton disabled={!closingAmount} onClick={() => setStep(2)}>Continuar</PrimaryButton>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="center">
                <div className="big-check big-check--warn"><TriangleAlert size={34} /></div>
                <h3>¿Confirmas el cierre de caja?</h3>
                <p>Esta acción no se puede deshacer y se generará el informe del día.</p>
              </div>
              <div className="sumbox">
                <div className="sumrow"><span>Total ventas</span><b>{fmt(preview.totales.total_sales)}</b></div>
                <div className="sumrow"><span>Efectivo esperado</span><b>{fmt(expected)}</b></div>
                <div className="sumrow"><span>Efectivo contado</span><b>{fmt(closingNum)}</b></div>
                <div className={`sumrow ${difference < 0 ? 'sumrow--bad' : difference > 0 ? '' : 'sumrow--ok'}`}><span>Diferencia</span><b>{fmt(difference)}</b></div>
              </div>
              <div className="modal__foot modal__foot--split">
                <PrimaryButton variant="ghost" onClick={() => setStep(1)}>Volver</PrimaryButton>
                <PrimaryButton variant="danger" onClick={handleClose} disabled={closing}>{closing ? 'Cerrando...' : 'Confirmar cierre'}</PrimaryButton>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="center">
                <div className="big-check"><Check size={36} strokeWidth={2.4} /></div>
                <h3>Caja cerrada correctamente</h3>
                <p>La jornada quedó registrada. Puedes descargar el informe del cierre.</p>
              </div>
              {pdfMsg && <div className="notice notice--info" style={{ marginBottom: 16, wordBreak: 'break-all' }}>{pdfMsg}</div>}
              <div className="modal__foot modal__foot--split">
                <PrimaryButton variant="soft" onClick={handlePdf} disabled={pdfLoading}><FileDown size={18} /> {pdfLoading ? 'Generando PDF...' : 'Descargar cierre PDF'}</PrimaryButton>
                <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
