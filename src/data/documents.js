// src/data/documents.js — facturas y cierres de caja para imprimir / guardar como PDF.
// En el navegador no se escribe un archivo: se abre el diálogo de impresión (elige "Guardar como PDF").
import { db } from './db.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]))
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0)
const when = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '')

const CSS = `<style>body{font-family:Arial,sans-serif;color:#111827;padding:32px;font-size:12px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#6b7280}.row{display:flex;justify-content:space-between;padding:5px 0}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.box{border:1px solid #e5e7eb;border-radius:8px;padding:10px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px;border-bottom:1px solid #eee}th{background:#f9fafb;font-size:12px;text-transform:uppercase}.total{font-size:16px;font-weight:800}.good{color:#166534}.bad{color:#b91c1c}@page{margin:14mm}</style>`

async function setting(key) { return (await db.settings.get(key))?.value || '' }

function printHtml(html, title) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${html}</body></html>`
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print() } catch (e) { console.error('[print]', e) }
    setTimeout(() => frame.remove(), 60000)
  }
  document.body.appendChild(frame)
}

export async function invoicePdf(saleId) {
  const sale = await db.sales.get(String(saleId))
  if (!sale) throw new Error('Venta no encontrada')
  const [items, pays, profile, name, nit, addr, phone] = await Promise.all([
    db.sale_items.where('sale_id').equals(sale.id).toArray(), db.payments.where('sale_id').equals(sale.id).toArray(),
    db.profiles.get(sale.user_id), setting('store_name'), setting('store_nit'), setting('store_address'), setting('store_phone'),
  ])
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const html = CSS +
    `<h1>${esc(name || 'J97')}</h1><div class="muted">NIT: ${esc(nit)} · ${esc(addr)} · ${esc(phone)}</div>` +
    `<h2>Factura ${esc(sale.invoice_number)}</h2><div class="grid"><div class="box"><b>Fecha</b><br>${esc(when(sale.created_at))}</div><div class="box"><b>Cajero</b><br>${esc(profile?.name)}</div></div>` +
    `<h2>Detalle</h2><table><tr><th>Producto</th><th>Variante</th><th>Cant.</th><th>Precio</th><th>Total</th></tr>` +
    items.map((i) => `<tr><td>${esc(i.product_name)}</td><td>${esc(i.size)} / ${esc(i.color)}</td><td>${i.qty}</td><td>${money(i.unit_price)}</td><td>${money(i.line_total)}</td></tr>`).join('') + `</table>` +
    `<h2>Totales</h2><div class="row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div><div class="row"><span>Impuestos</span><b>${money(sale.tax_amt)}</b></div>` +
    `<div class="row total"><span>Total</span><b>${money(sale.total)}</b></div><div class="row"><span>Pago</span><b>${esc(pays.map((p) => p.method).join(', '))}</b></div>`
  printHtml(html, sale.invoice_number)
  return { ok: true, path: 'Ventana de impresión (elige "Guardar como PDF")' }
}

export async function cashPdf(data = {}) {
  const [name, nit, addr] = await Promise.all([setting('store_name'), setting('store_nit'), setting('store_address')])
  const id = String(data.id ?? '').slice(0, 8).toUpperCase()
  const diff = Number(data.difference) || 0
  const expenses = data.expenses || data.expenses_list || []
  const html = CSS +
    `<h1>${esc(name || 'J97')} · Cierre de caja</h1><div class="muted">NIT: ${esc(nit)} · ${esc(addr)}</div>` +
    `<h2>Información del cierre</h2><div class="grid"><div class="box">Caja #${esc(id)}<br>Cajero: ${esc(data.cajero)}</div><div class="box">Apertura: ${esc(when(data.opened_at))}<br>Cierre: ${esc(when(data.closed_at))}</div></div>` +
    `<h2>Resumen financiero</h2>` +
    [['Monto inicial', data.opening_amount], ['Total ventas', data.total_sales], ['Total gastos', data.total_expenses], ['Efectivo esperado', data.expected_amount], ['Efectivo contado', data.closing_amount]]
      .map(([k, v]) => `<div class="row"><span>${k}</span><b>${money(v)}</b></div>`).join('') +
    `<div class="row total ${diff === 0 ? 'good' : 'bad'}"><span>Diferencia</span><b>${money(diff)}</b></div>` +
    `<h2>Ventas por método</h2><table><tr><th>Método</th><th>Total</th></tr>` +
    [['Efectivo', data.cash_sales], ['Transferencia', data.transfer_sales], ['Crédito interno', data.credit_sales], ['Sistecrédito', data.sistecredito_sales]]
      .map(([k, v]) => `<tr><td>${k}</td><td>${money(v)}</td></tr>`).join('') + `</table>` +
    `<h2>Gastos detallados</h2>` +
    (expenses.length
      ? `<table><tr><th>Fecha</th><th>Descripción</th><th>Usuario</th><th>Valor</th></tr>${expenses.map((e) => `<tr><td>${esc(when(e.created_at))}</td><td>${esc(e.description)}</td><td>${esc(e.user_name)}</td><td>${money(e.amount)}</td></tr>`).join('')}</table>`
      : '<div class="muted">Sin gastos registrados.</div>') +
    `<h2>Observaciones</h2><div class="box">${esc(data.notes || 'Sin observaciones.')}</div>` +
    `<p style="margin-top:40px">Responsable: ${esc(data.cajero)}<br><br>Firma: ______________________________</p>`
  printHtml(html, `Cierre de caja ${id}`)
  return { ok: true, path: 'Ventana de impresión (elige "Guardar como PDF")' }
}
