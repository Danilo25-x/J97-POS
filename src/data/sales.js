// src/data/sales.js — port de electron/ipc/SalesHandlers.js
import { db, uuid, nowIso, save, strip } from './db.js'
import { getUser } from './session.js'
import { audit } from './audit.js'
import { cop } from './validation.js'
import { localDay, tsAt } from './dates.js'

class Biz extends Error {}   // error de negocio: se muestra tal cual al cajero
const fail = (msg) => { throw new Biz(msg) }
const fmtCop = (n) => Number(n).toLocaleString('es-CO')
const TX = () => [db.sales, db.sale_items, db.payments, db.credits, db.invoices, db.product_variants,
  db.inventory_movements, db.settings, db.audit_logs, db.cash_registers, db.customers, db.products]

async function settingValue(key, fallback) {
  const r = await db.settings.get(key)
  return r?.value ?? fallback
}

export async function createSale(payload) {
  try {
    return await db.transaction('rw', TX(), async () => {
      const { items, payments: paymentsIn, notes, customerId, installments = 1 } = payload || {}
      if (!items || items.length === 0) fail('El carrito está vacío')

      const caja = await db.cash_registers.where('status').equals('open').first()
      if (!caja) fail('Debes abrir la caja antes de vender')
      const userId = getUser()?.id
      if (!userId) fail('Sesión inválida')

      // Número de factura
      const prefix = (await settingValue('invoice_prefix', 'ZF')) || 'ZF'
      let nextNum = parseInt(await settingValue('invoice_next', '1'), 10) || 1
      let invoice = `${prefix}-${String(nextNum).padStart(6, '0')}`
      while (await db.sales.where('invoice_number').equals(invoice).first()) {
        nextNum += 1
        invoice = `${prefix}-${String(nextNum).padStart(6, '0')}`
      }

      // Totales (la lógica de negocio es la fuente de verdad, no la pantalla)
      const taxRate = parseFloat(await settingValue('tax_rate', '0')) || 0
      let subtotal = 0
      const lineItems = []
      const reserved = new Map()

      for (const item of items) {
        const qty = Number(item.qty)
        if (!Number.isInteger(qty) || qty < 1) fail('Cantidad de venta inválida')

        const variant = await db.product_variants.get(String(item.variantId))
        const product = variant ? await db.products.get(variant.product_id) : null
        if (!variant?.is_active || !product?.is_active) fail(`Producto no encontrado (variante ${item.variantId})`)

        const already = reserved.get(variant.id) || 0
        if (variant.stock - already < qty) {
          fail(`Stock insuficiente: ${product.name} ${variant.size}/${variant.color} — disponible: ${variant.stock - already}`)
        }
        reserved.set(variant.id, already + qty)

        const unitPrice = variant.price_override ?? product.sale_price
        const discPct = Number(item.discountPct ?? 0)
        if (!Number.isFinite(discPct) || discPct < 0 || discPct > 100) fail('Descuento inválido')
        const lineTotal = Math.round(unitPrice * qty * (1 - discPct / 100))
        subtotal += lineTotal
        lineItems.push({ variantId: variant.id, productName: product.name, size: variant.size, color: variant.color, unitPrice, qty, discPct, lineTotal })
      }

            // Descuento en pesos sobre toda la venta: se reparte entre las líneas para que subtotal y reportes cuadren
      const grossSubtotal = subtotal
      const discountAmt = Math.round(Number(payload.discountAmt ?? 0))
      if (!Number.isFinite(discountAmt) || discountAmt < 0) fail('Descuento inválido')
      if (discountAmt > 0) {
        if (discountAmt >= grossSubtotal) fail('El descuento debe ser menor al subtotal de la venta')
        let left = discountAmt
        lineItems.forEach((li, idx) => {
          const part = idx === lineItems.length - 1
            ? left
            : Math.round(discountAmt * li.lineTotal / grossSubtotal)
          const applied = Math.min(part, li.lineTotal, left)
          li.lineTotal -= applied
          left -= applied
        })
        subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0)
      }

      const taxAmt = Math.round(subtotal * (taxRate / 100))
      const total = subtotal + taxAmt

      // Pagos
      if (!paymentsIn || paymentsIn.length === 0) fail('Debe seleccionar un método de pago')
      if (paymentsIn.length !== 1) fail('La venta debe tener un único método de pago')
      const validMethods = ['efectivo', 'transferencia', 'credito', 'sistecredito']
      const paymentsData = paymentsIn.map((p) => {
        if (!validMethods.includes(p.method)) fail(`Método de pago inválido: ${p.method}`)
        let amount
        try { amount = cop(p.amount, 'Monto de pago') } catch { fail('Monto de pago inválido') }
        if (amount <= 0) fail('Monto de pago inválido')
        return { method: p.method, amount, reference: p.reference || null }
      })

      const hasCredit = paymentsData.some((p) => p.method === 'credito')
      const hasSiste = paymentsData.some((p) => p.method === 'sistecredito')
      const financingMethod = hasCredit ? 'credito' : hasSiste ? 'sistecredito' : null
      const financingPct = Number(payload.financingPct ?? 0)
      if (!Number.isFinite(financingPct) || financingPct < 0 || financingPct > 100) fail('Porcentaje de financiación inválido')
      const chargedTotal = financingMethod ? Math.round(total * (1 + financingPct / 100)) : total

      const customer = customerId ? await db.customers.get(String(customerId)) : null
      if (customerId && !customer?.is_active) fail('Cliente no encontrado o inactivo')
      if (hasCredit && !customer) fail('Para una venta a crédito interno debes seleccionar un cliente')
      if (hasSiste && customerId) fail('Sistecrédito no se asocia a clientes')
      const installmentCount = hasCredit ? Number(installments) : null
      if (hasCredit && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120)) {
        fail('Número de cuotas inválido para crédito interno')
      }

      const paid = paymentsData[0].amount
      if (paymentsData[0].method !== 'efectivo' && Math.round(paid) !== Math.round(chargedTotal)) {
        fail(`El pago debe coincidir exactamente con el total: $${fmtCop(chargedTotal)}`)
      }
      if (paymentsData[0].method === 'efectivo' && Math.round(paid) !== Math.round(total)) {
        fail(`El valor registrado en efectivo debe ser $${fmtCop(total)}`)
      }

      // Escritura (todo o nada)
      const base = Date.now()
      const saleId = uuid()
      await save('sales', {
        id: saleId, invoice_number: invoice, user_id: userId, cash_register_id: caja.id,
        customer_id: customer?.id || null, subtotal, tax_amt: taxAmt, total: chargedTotal,
        status: 'completed', notes: notes || null, created_at: tsAt(base, 0),
        cancelled_at: null, cancelled_by: null, cancel_reason: null,
        financing_method: financingMethod || 'none', financing_pct: financingPct,
        financing_base: financingMethod ? total : 0, financing_total: financingMethod ? chargedTotal : 0,
        installment_count: hasCredit ? installmentCount : 1,
        installment_amount: hasCredit ? Math.round((chargedTotal / installmentCount) * 100) / 100 : 0,
        final_installment: 0,
      })

      let i = 0
      for (const li of lineItems) {
        i += 1
        await save('sale_items', {
          id: uuid(), sale_id: saleId, variant_id: li.variantId, product_name: li.productName,
          size: li.size, color: li.color, qty: li.qty, unit_price: li.unitPrice,
          discount_pct: li.discPct, line_total: li.lineTotal, created_at: tsAt(base, i),
        })
        const v = await db.product_variants.get(li.variantId)   // stock actual (por si repite variante)
        const newStock = v.stock - li.qty
        if (newStock < 0) fail(`Stock insuficiente: ${li.productName} ${li.size}/${li.color}`)
        await save('product_variants', { ...v, stock: newStock })
        await save('inventory_movements', {
          id: uuid(), variant_id: v.id, user_id: userId, type: 'venta', qty: -li.qty,
          stock_before: v.stock, stock_after: newStock, reference: invoice, notes: null, created_at: tsAt(base, i),
        })
      }

      for (const p of paymentsData) {
        i += 1
        await save('payments', { id: uuid(), sale_id: saleId, method: p.method, amount: p.amount, reference: p.reference, created_at: tsAt(base, i) })
      }

      if (hasCredit) {
        const creditAmount = paymentsData.filter((p) => p.method === 'credito').reduce((s, p) => s + p.amount, 0)
        if (creditAmount > 0) {
          await save('credits', {
            id: uuid(), customer_id: customer.id, sale_id: saleId, total_amount: creditAmount,
            installment_count: installmentCount,
            installment_amount: Math.ceil((creditAmount / installmentCount) * 100) / 100,
            paid_amount: 0, balance: creditAmount, status: 'pending', created_at: tsAt(base, 0),
          })
        }
      }

      await save('invoices', { id: uuid(), sale_id: saleId, created_at: tsAt(base, 0) })
      await save('settings', { key: 'invoice_next', value: String(nextNum + 1) })
      await audit('create_sale', 'sale', saleId, { invoice, total: chargedTotal, items: lineItems.length, discount: discountAmt })
      return { ok: true, saleId, invoice, total: chargedTotal, baseTotal: total, taxAmt, subtotal }
    })
  } catch (e) {
    if (e instanceof Biz) return { ok: false, error: e.message }
    console.error('[sales:createSale]', e)
    return { ok: false, error: `Error al registrar la venta: ${e?.message || 'Error desconocido'}` }
  }
}

// ─── Consultas ──────────────────────────────────────────────

const byDateDesc = (a, b) => String(b.created_at).localeCompare(String(a.created_at))
const byDateAsc = (a, b) => String(a.created_at).localeCompare(String(b.created_at))

async function profileNames() {
  return new Map((await db.profiles.toArray()).map((p) => [p.id, p.name]))
}

export async function getSales(params = {}) {
  const { from, to, status, search } = params
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 500)
  const offset = Math.max(Number(params.offset) || 0, 0)
  const names = await profileNames()
  const q = String(search || '').toLowerCase()

  let rows = await db.sales.toArray()
  if (from) rows = rows.filter((s) => localDay(s.created_at) >= from)
  if (to) rows = rows.filter((s) => localDay(s.created_at) <= to)
  if (status) rows = rows.filter((s) => s.status === status)
  if (q) rows = rows.filter((s) => s.invoice_number.toLowerCase().includes(q) || String(names.get(s.user_id) ?? '').toLowerCase().includes(q))
  rows = rows.sort(byDateDesc).slice(offset, offset + limit)

  const ids = rows.map((s) => s.id)
  const [pays, items, variants, products] = await Promise.all([
    db.payments.where('sale_id').anyOf(ids).toArray(),
    db.sale_items.where('sale_id').anyOf(ids).toArray(),
    db.product_variants.toArray(), db.products.toArray(),
  ])
  const vm = new Map(variants.map((v) => [v.id, v])), pm = new Map(products.map((p) => [p.id, p]))
  const firstPay = new Map(), firstItem = new Map()
  for (const p of pays.sort(byDateAsc)) if (!firstPay.has(p.sale_id)) firstPay.set(p.sale_id, p.method)
  for (const it of items.sort(byDateAsc)) if (!firstItem.has(it.sale_id)) firstItem.set(it.sale_id, it)

  const data = rows.map((s) => {
    const it = firstItem.get(s.id)
    const v = it ? vm.get(it.variant_id) : null
    const p = v ? pm.get(v.product_id) : null
    return {
      ...strip(s), cajero: names.get(s.user_id) ?? null,
      payment_method: firstPay.get(s.id) ?? null,
      image_path: v ? (v.image_path || p?.image_path || null) : null,
    }
  })
  return { ok: true, data }
}

export async function getSale(id) {
  const sale = await db.sales.get(String(id))
  if (!sale) return { ok: false, error: 'Venta no encontrada' }
  const [names, items, payments, variants, products, settings] = await Promise.all([
    profileNames(), db.sale_items.where('sale_id').equals(sale.id).toArray(),
    db.payments.where('sale_id').equals(sale.id).toArray(),
    db.product_variants.toArray(), db.products.toArray(), db.settings.toArray(),
  ])
  const vm = new Map(variants.map((v) => [v.id, v])), pm = new Map(products.map((p) => [p.id, p]))
  return {
    ok: true,
    data: {
      ...strip(sale), cajero: names.get(sale.user_id) ?? null,
      items: items.sort(byDateAsc).map((it) => {
        const v = vm.get(it.variant_id), p = v ? pm.get(v.product_id) : null
        return { ...strip(it), image_path: v?.image_path || p?.image_path || null }
      }),
      payments: payments.sort(byDateAsc).map(strip),
      settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
    },
  }
}

export async function cancelSale({ id, reason } = {}) {
  try {
    return await db.transaction('rw', TX(), async () => {
      const sale = await db.sales.get(String(id))
      if (!sale || sale.status !== 'completed') fail('Venta no encontrada o ya cancelada')
      const userId = getUser()?.id
      if (!userId) fail('Sesión inválida')

      const items = await db.sale_items.where('sale_id').equals(sale.id).toArray()
      const base = Date.now()
      let i = 0
      for (const item of items) {
        const v = await db.product_variants.get(item.variant_id)
        if (!v) continue
        const newStock = v.stock + item.qty
        await save('product_variants', { ...v, stock: newStock })
        await save('inventory_movements', {
          id: uuid(), variant_id: v.id, user_id: userId, type: 'devolucion', qty: item.qty,
          stock_before: v.stock, stock_after: newStock, reference: sale.invoice_number,
          notes: reason || 'Cancelación de venta', created_at: tsAt(base, i++),
        })
      }
      await save('sales', { ...sale, status: 'cancelled', cancel_reason: reason || null, cancelled_by: userId, cancelled_at: nowIso() })

      // Un crédito interno no puede seguir pendiente si la venta se canceló
      for (const c of await db.credits.where('sale_id').equals(sale.id).toArray()) {
        if (c.status === 'pending' || c.status === 'paid') await save('credits', { ...c, status: 'cancelled', balance: 0 })
      }
      const payments = (await db.payments.where('sale_id').equals(sale.id).toArray())
        .sort(byDateAsc).map(({ method, amount, reference }) => ({ method, amount, reference }))
      await audit('cancel_sale', 'sale', sale.id, {
        invoice: sale.invoice_number, reason: reason ? String(reason).trim().slice(0, 500) : null,
        cash_register_id: sale.cash_register_id, payments,
      })
      return { ok: true }
    })
  } catch (e) {
    if (e instanceof Biz) return { ok: false, error: e.message }
    console.error('[sales:cancelSale]', e)
    return { ok: false, error: 'Error al cancelar la venta' }
  }
}

export async function scanBarcode(barcode) {
  const code = String(barcode ?? '').trim()
  if (!code) return { ok: false, error: 'Código vacío' }

  const v = await db.product_variants.where('barcode').equals(code).filter((x) => x.is_active).first()
  const vp = v ? await db.products.get(v.product_id) : null
  if (v && vp?.is_active) {
    if (v.stock <= 0) return { ok: false, error: `Sin stock: ${vp.name} ${v.size}/${v.color}` }
    return {
      ok: true, type: 'variant',
      data: {
        variantId: v.id, productId: vp.id, productName: vp.name, sku: vp.sku, size: v.size, color: v.color,
        stock: v.stock, unitPrice: v.price_override ?? vp.sale_price, imagePath: v.image_path || vp.image_path || null,
      },
    }
  }

  const product = await db.products.where('barcode').equals(code).filter((x) => x.is_active).first()
  if (product) {
    const variants = (await db.product_variants.where('product_id').equals(product.id).toArray())
      .filter((x) => x.is_active && x.stock > 0)
      .map((x) => ({ ...strip(x), display_image_path: x.image_path || product.image_path || null }))
    return { ok: true, type: 'product_select', data: strip(product), variants }
  }
  return { ok: false, error: 'Código de barras no encontrado' }
}
