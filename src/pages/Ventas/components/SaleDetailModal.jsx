// src/pages/Ventas/components/SaleDetailModal.jsx
import { useState, useEffect } from 'react'
import { FileDown } from 'lucide-react'
import Modal from '../../../components/UI/Modal'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import StatusBadge from '../../../components/UI/StatusBadge'
import ProductThumb from '../../../components/UI/ProductThumb'
import ProductImageViewer from '../../../components/UI/ProductImageViewer'
import { fmt, fmtDateMedium } from '../../../utils/format'

const STATUS = { completed: 'Completada', cancelled: 'Cancelada', refunded: 'Reembolsada' }

export default function SaleDetailModal({ saleId, onClose, onCancelled }) {
  const [sale, setSale]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfMsg, setPdfMsg]         = useState('')
  const [imageToView, setImageToView] = useState(null)

  useEffect(() => {
    if (!saleId) return
    setLoading(true); setSale(null); setPdfMsg(''); setShowCancel(false)
    window.electronAPI.sales.getSale(saleId).then(r => {
      if (r.ok) setSale(r.data)
      setLoading(false)
    })
  }, [saleId])

  const totalPagado = sale?.payments?.reduce((s, p) => s + p.amount, 0) || 0
  const cambio = Math.max(0, totalPagado - (sale?.total || 0))

  const handleCancel = async () => {
    setCancelling(true)
    const r = await window.electronAPI.sales.cancelSale({ id: saleId, reason: cancelReason })
    setCancelling(false)
    if (r.ok) { onCancelled?.(); onClose() }
  }

  const handlePdf = async () => {
    setPdfLoading(true)
    const r = await window.electronAPI.documents.invoicePdf(saleId)
    setPdfLoading(false)
    setPdfMsg(r.ok ? `PDF guardado en: ${r.path}` : `Error: ${r.error}`)
  }

  return (
    <Modal isOpen={!!saleId} onClose={onClose} title="Detalle de venta" width={640}>
      {loading ? (
        <div className="loading" role="status"><div className="spinner" />Cargando...</div>
      ) : !sale ? (
        <div className="notice notice--bad">Venta no encontrada.</div>
      ) : (
        <>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
            <div>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--plum-600)' }}>{sale.invoice_number}</b>
              <small style={{ marginTop: 4 }}>{fmtDateMedium(sale.created_at)} · Cajero: {sale.cajero}</small>
            </div>
            <StatusBadge status={STATUS[sale.status] || sale.status} />
          </div>

          <div className="card card--flush tbl-wrap" style={{ marginBottom: 18 }}>
            <table className="tbl items-tbl">
              <thead><tr><th>Producto</th><th className="c">Cant.</th><th className="r">Precio</th><th className="r">Total</th></tr></thead>
              <tbody>
                {sale.items?.map((item, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ProductThumb name={item.product_name} src={item.image_path ? `j97-image:///${item.image_path}` : ''} size="sm" onClick={() => item.image_path && setImageToView({ src: `j97-image:///${item.image_path}`, name: item.product_name })} />
                        <div>
                          <div className="cell-main">{item.product_name}</div>
                          <div className="cell-sub">{item.size} / {item.color}{item.discount_pct > 0 && ` · Dto: ${item.discount_pct}%`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="c num">{item.qty}</td>
                    <td className="r num">{fmt(item.unit_price)}</td>
                    <td className="r num cell-main">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sumbox">
            <div className="sumrow"><span>Subtotal</span><b>{fmt(sale.subtotal)}</b></div>
            {sale.tax_amt > 0 && <div className="sumrow"><span>Impuesto</span><b>{fmt(sale.tax_amt)}</b></div>}
            <div className="sumrow sumrow--total"><span>Total</span><b>{fmt(sale.total)}</b></div>
            {sale.payments?.map((p, i) => (
              <div className="sumrow" key={i}><span style={{ textTransform: 'capitalize' }}>Pago ({p.method})</span><b>{fmt(p.amount)}</b></div>
            ))}
            {cambio > 0 && <div className="sumrow sumrow--ok"><span>Cambio entregado</span><b>{fmt(cambio)}</b></div>}
          </div>

          {sale.status === 'cancelled' && sale.cancel_reason && (
            <div className="notice notice--bad" style={{ marginBottom: 16 }}><span><strong>Motivo de cancelación:</strong> {sale.cancel_reason}</span></div>
          )}
          {pdfMsg && <div className="notice notice--info" style={{ marginBottom: 16, wordBreak: 'break-all' }}>{pdfMsg}</div>}

          <div className="modal__foot" style={{ flexWrap: 'wrap' }}>
            {sale.status === 'completed' && (
              <>
                <PrimaryButton variant="soft" onClick={handlePdf} disabled={pdfLoading}>
                  <FileDown size={18} /> {pdfLoading ? 'Generando...' : 'Descargar PDF'}
                </PrimaryButton>
                {!showCancel && <PrimaryButton variant="ghost" className="btn--sm-danger" onClick={() => setShowCancel(true)} style={{ color: 'var(--bad)' }}>Cancelar venta</PrimaryButton>}
              </>
            )}
            <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
          </div>

          {showCancel && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 18, marginTop: 18 }}>
              <label className="field__label" htmlFor="cancel-reason">Motivo de cancelación (opcional)</label>
              <textarea id="cancel-reason" className="textarea" rows={3} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Describe el motivo..." style={{ marginBottom: 12 }} />
              <div className="modal__foot">
                <PrimaryButton variant="ghost" onClick={() => setShowCancel(false)}>Atrás</PrimaryButton>
                <PrimaryButton variant="danger" onClick={handleCancel} disabled={cancelling}>{cancelling ? 'Cancelando...' : 'Confirmar cancelación'}</PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
      {imageToView && <ProductImageViewer src={imageToView.src} name={imageToView.name} onClose={() => setImageToView(null)} />}
    </Modal>
  )
}
