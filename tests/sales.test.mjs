import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { db, uuid } from '../src/data/db.js'
import { setUser, ADMIN_PERMISSIONS } from '../src/data/session.js'
import * as inv from '../src/data/inventory.js'
import * as cust from '../src/data/customers.js'
import * as settings from '../src/data/settings.js'
import * as sales from '../src/data/sales.js'
import * as cash from '../src/data/cash.js'
import * as rep from '../src/data/reports.js'
import { buildApi } from '../src/data/api.js'

const me = uuid()
setUser({ id: me, name: 'Orito', permissions: ADMIN_PERMISSIONS })
await db.profiles.put({ id: me, name: 'Orito', role: 'admin', is_active: true, _dirty: 0 })
await settings.ensureDefaults()

let vid, vid2, customerId
const sell = (extra = {}) => sales.createSale({ items: [{ variantId: vid, qty: 2, discountPct: 10 }], payments: [{ method: 'efectivo', amount: 90000 }], ...extra })

test('preparación: producto con stock', async () => {
  const p = await inv.createProduct({ name: 'Proteína', sku: 'P1', salePrice: 50000, costPrice: 30000, variants: [{ size: 'U', color: 'Choc', stock: 10 }, { size: 'U', color: 'Vain', stock: 1, priceOverride: 20000 }] })
  const v = (await inv.getProduct(p.id)).data.variants
  vid = v.find((x) => x.color === 'Choc').id; vid2 = v.find((x) => x.color === 'Vain').id
  customerId = (await cust.create({ name: 'Ana', document: '1061234567', phone: '3001234567' })).id
})

test('no se puede vender sin caja abierta ni con carrito vacío', async () => {
  assert.equal((await sell()).error, 'Debes abrir la caja antes de vender')
  assert.equal((await sales.createSale({ items: [] })).error, 'El carrito está vacío')
})

test('abrir caja: una sola abierta y monto válido', async () => {
  assert.equal((await cash.openRegister({ openingAmount: '12abc' })).ok, false)
  assert.equal((await cash.openRegister({ openingAmount: '100.000' })).ok, true)
  assert.equal((await cash.openRegister({ openingAmount: 5 })).error, 'Ya hay una caja abierta')
})

test('venta en efectivo: totales, stock, movimiento, factura y caja', async () => {
  const r = await sell()
  assert.deepEqual([r.ok, r.invoice, r.total, r.subtotal], [true, 'ZF-000001', 90000, 90000])
  assert.equal((await db.product_variants.get(vid)).stock, 8)
  const mov = (await inv.getMovements(vid)).data[0]
  assert.deepEqual([mov.type, mov.qty, mov.stock_after, mov.reference], ['venta', -2, 8, 'ZF-000001'])
  assert.equal(await settings.get('invoice_next'), '2')
  const open = (await cash.getOpen()).data
  assert.equal(open.cash_sales, 90000); assert.equal(open.expected_cash, 190000); assert.equal(open.num_sales, 1)
  assert.equal(open.cajero, 'Orito')
})

test('validaciones de venta', async () => {
  assert.match((await sell({ items: [{ variantId: vid, qty: 99 }] })).error, /Stock insuficiente/)
  assert.equal((await sell({ items: [{ variantId: vid, qty: 1, discountPct: 150 }] })).error, 'Descuento inválido')
  assert.equal((await sell({ payments: [{ method: 'efectivo', amount: 1 }] })).error, 'El valor registrado en efectivo debe ser $90.000')
  assert.match((await sell({ payments: [{ method: 'transferencia', amount: 5 }] })).error, /debe coincidir exactamente/)
  assert.equal((await sell({ payments: [{ method: 'bitcoin', amount: 90000 }] })).error, 'Método de pago inválido: bitcoin')
  assert.equal((await sell({ payments: [{ method: 'credito', amount: 90000 }] })).error, 'Para una venta a crédito interno debes seleccionar un cliente')
  assert.equal((await sell({ payments: [{ method: 'sistecredito', amount: 99000 }], customerId })).error, 'Sistecrédito no se asocia a clientes')
  assert.equal((await sell({ customerId: uuid() })).error, 'Cliente no encontrado o inactivo')
  assert.equal((await db.sales.count()), 1)   // ninguna venta rechazada dejó rastro
})

test('misma variante repetida no puede exceder el stock', async () => {
  const r = await sales.createSale({ items: [{ variantId: vid2, qty: 1 }, { variantId: vid2, qty: 1 }], payments: [{ method: 'transferencia', amount: 40000 }] })
  assert.match(r.error, /Stock insuficiente/)
  assert.equal((await db.product_variants.get(vid2)).stock, 1)
})

test('dos ventas simultáneas con 1 unidad: solo una se registra', async () => {
  const mk = () => sales.createSale({ items: [{ variantId: vid2, qty: 1 }], payments: [{ method: 'transferencia', amount: 20000 }] })
  const [a, b] = await Promise.all([mk(), mk()])
  assert.deepEqual([a.ok, b.ok].sort(), [false, true])
  assert.equal((await db.product_variants.get(vid2)).stock, 0)
  assert.equal(new Set((await db.sales.toArray()).map((s) => s.invoice_number)).size, await db.sales.count())
})

let creditSale
test('venta a crédito interno con financiación', async () => {
  const r = await sales.createSale({ items: [{ variantId: vid, qty: 1 }], payments: [{ method: 'credito', amount: 55000 }], customerId, installments: 4, financingPct: 10 })
  assert.deepEqual([r.ok, r.baseTotal, r.total], [true, 50000, 55000]); creditSale = r.saleId
  const credit = await db.credits.where('sale_id').equals(creditSale).first()
  assert.deepEqual([credit.total_amount, credit.balance, credit.installment_amount, credit.status], [55000, 55000, 13750, 'pending'])
  assert.equal((await cust.list()).data.items[0].pending_balance, 55000)
  assert.equal((await cash.getOpen()).data.credit_sales, 55000)
  assert.equal((await cash.getOpen()).data.expected_cash, 190000)   // el crédito no entra al efectivo
})

test('historial, detalle y escaneo', async () => {
  const list = (await sales.getSales({})).data
  assert.equal(list[0].payment_method, 'credito'); assert.equal(list[0].cajero, 'Orito')
  assert.equal((await sales.getSales({ search: 'zf-000001' })).data.length, 1)
  const d = (await sales.getSale(list.at(-1).id)).data
  assert.equal(d.items[0].product_name, 'Proteína'); assert.equal(d.payments[0].method, 'efectivo'); assert.equal(d.settings.invoice_prefix, 'ZF')
  await db.product_variants.update(vid, { barcode: '7700' })
  assert.equal((await sales.scanBarcode(' 7700 ')).data.unitPrice, 50000)
  assert.equal((await sales.scanBarcode('9999')).error, 'Código de barras no encontrado')
  assert.equal((await sales.scanBarcode('')).error, 'Código vacío')
})

test('gasto de caja', async () => {
  assert.equal((await cash.addExpense({ description: '', amount: 5000 })).ok, false)
  assert.equal((await cash.addExpense({ description: 'Hielo', amount: '5.000', category: 'Insumos' })).ok, true)
  const o = (await cash.getOpen()).data
  assert.equal(o.total_expenses, 5000); assert.equal(o.expected_cash, 185000); assert.equal(o.expenses_list[0].user_name, 'Orito')
})

test('cancelar venta: devuelve stock, anula crédito y la saca de la caja', async () => {
  const stockBefore = (await db.product_variants.get(vid)).stock
  assert.equal((await sales.cancelSale({ id: creditSale, reason: 'Error' })).ok, true)
  assert.equal((await db.product_variants.get(vid)).stock, stockBefore + 1)
  const credit = await db.credits.where('sale_id').equals(creditSale).first()
  assert.deepEqual([credit.status, credit.balance], ['cancelled', 0])
  assert.equal((await sales.cancelSale({ id: creditSale })).error, 'Venta no encontrada o ya cancelada')
  assert.equal((await cash.getOpen()).data.credit_sales, 0)
  assert.equal((await cust.list()).data.items[0].pending_balance, 0)
})

test('reportes y dashboard', async () => {
  const d = (await rep.getDashboard()).data
  assert.equal(d.ventasHoy.count, 2); assert.equal(d.ventasHoy.total, 110000)
  assert.equal(d.cajaAbierta.total_sales, 110000); assert.equal(d.ventas7dias.length, 1)
  assert.deepEqual(d.ventasPorMetodo.map((m) => m.method).sort(), ['efectivo', 'transferencia'])
  assert.equal(d.sinStock, 1); assert.equal(d.inventarioStats.total_products, 1)
  const s = (await rep.getSalesReport({})).data
  assert.equal(s.items.length, 3); assert.equal(s.total_count, 2); assert.equal(s.grand_total, 110000)
  assert.equal((await rep.getSalesReport({ from: '2000-01-01', to: '2000-01-02' })).data.items.length, 0)
  const top = (await rep.getTopProducts({})).data
  assert.deepEqual([top[0].name, top[0].total_qty, top[0].total_revenue, top[0].num_sales], ['Proteína', 3, 110000, 2])
  const ir = await rep.getInventoryReport()
  assert.equal(ir.threshold, 5); assert.equal(ir.data[0].variants, 2)
})

test('cierre de caja: diferencia, historial, detalle y nueva apertura', async () => {
  const prev = (await cash.getClosePreview()).data
  assert.equal(prev.expected_cash, 185000); assert.equal(prev.caja.cajero, 'Orito')
  assert.equal((await cash.closeRegister({ closingAmount: 'abc' })).ok, false)
  const r = await cash.closeRegister({ closingAmount: 180000, notes: 'Faltó cambio' })
  assert.equal(r.ok, true); assert.equal(r.data.difference, -5000); assert.equal(r.data.status, 'closed'); assert.equal(r.data.settings.store_name, 'Zona Fit Orito')
  assert.equal((await cash.getOpen()).data, null)
  assert.equal((await sell()).error, 'Debes abrir la caja antes de vender')
  const h = (await cash.getHistory({})).data[0]
  assert.deepEqual([h.status, h.difference, h.cash_sales, h.total_expenses], ['closed', -5000, 90000, 5000])
  const det = (await cash.getDetail(h.id)).data
  assert.equal(det.sales_list.length, 3); assert.match(det.sales_list[0].payments_summary, /^efectivo:90000\.00$/); assert.equal(det.expenses_list.length, 1)
  assert.equal((await cash.openRegister({ openingAmount: 0 })).ok, true)
})

test('api: permisos y forma de respuesta como en Electron', async () => {
  const api = buildApi()
  assert.equal((await api.cash.getOpen()).ok, true)
  assert.equal((await api.reports.getDashboard()).ok, true)
  setUser({ id: me, permissions: ['inventory'] })
  assert.equal((await api.sales.getSales({})).error, 'Sin permiso: sales')
  assert.equal((await api.cash.getOpen()).error, 'Sin permiso: cash_register')
  setUser({ id: me, permissions: ADMIN_PERMISSIONS })
})
