import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { db, uuid } from '../src/data/db.js'
import { setUser, ADMIN_PERMISSIONS } from '../src/data/session.js'
import * as inv from '../src/data/inventory.js'
import * as cust from '../src/data/customers.js'
import * as settings from '../src/data/settings.js'
import * as images from '../src/data/images.js'

setUser({ id: uuid(), name: 'Orito', permissions: ADMIN_PERMISSIONS })
const webp = (bad) => {
  const b = Buffer.alloc(40); b.write(bad ? 'JUNK' : 'RIFF', 0); b.write('WEBP', 8)
  return 'data:image/webp;base64,' + b.toString('base64')
}
const rejects = (p, re) => assert.rejects(p, re)

test('configuración: valores iniciales y validaciones', async () => {
  await settings.ensureDefaults()
  const all = await settings.getAll()
  assert.equal(all.store_name, 'Zona Fit Orito'); assert.equal(all.invoice_prefix, 'ZF')
  await settings.set('invoice_prefix', 'zf-1'); assert.equal(await settings.get('invoice_prefix'), 'ZF-1')
  await rejects(settings.set('invoice_prefix', '../../x'), /prefijo/)
  await rejects(settings.set('currency', 'USD'), /COP/)
  await rejects(settings.set('otra', 1), /no permitida/)
  assert.equal((await db.settings.get('invoice_prefix'))._dirty, 1)
})

test('imágenes: acepta WebP válido y rechaza lo demás', async () => {
  const p = await images.saveDataUrl(webp())
  assert.match(p, /^products\/[0-9a-f-]+\.webp$/)
  await rejects(images.saveDataUrl(webp(true)), /WebP válido/)
  await rejects(images.saveDataUrl('data:image/png;base64,AAAA'), /WebP/)
  assert.equal(await images.deleteImage(p), true)
})

let productId, variantId
test('crear producto con variantes e imagen', async () => {
  const r = await inv.createProduct({
    name: 'Camiseta dry-fit', sku: 'cam-01', salePrice: '35.000', costPrice: 20000, imageData: webp(),
    variants: [
      { size: 'M', color: 'Negro', stock: 5, barcode: '7701' },
      { size: 'L', color: 'Negro', stock: 0, priceOverride: '40.000' },
    ],
  })
  assert.equal(r.ok, true); productId = r.id
  const p = (await inv.getProduct(productId)).data
  assert.equal(p.variants.length, 2); assert.equal(p.sale_price, 35000)
  assert.equal(p.variants[0].display_image_path, p.image_path)
  variantId = p.variants.find((v) => v.size === 'M').id
})

test('SKU repetido y variantes repetidas se rechazan sin dejar nada guardado', async () => {
  assert.equal((await inv.createProduct({ name: 'x', sku: 'cam-01' })).ok, false)
  const before = await db.products.count(); const imgs = await db.images.count()
  await rejects(inv.createProduct({
    name: 'Jean', sku: 'jean-1', imageData: webp(),
    variants: [{ size: 'M', color: 'Azul' }, { size: 'm', color: 'azul' }],
  }), /duplicados/)
  assert.equal(await db.products.count(), before)
  assert.equal(await db.images.count(), imgs)
  await rejects(inv.createProduct({ name: 'Otro', sku: 'o-1', variants: [{ size: 'S', color: 'Rojo', barcode: '7701' }] }), /código de barras/)
  await rejects(inv.createProduct({ name: 'Otro', sku: 'o-2', salePrice: '12abc' }), /inválido/)
})

test('listado, búsqueda, filtro de stock bajo y KPIs', async () => {
  await inv.createProduct({ name: 'Proteína 2 lb', sku: 'pro-1', salePrice: 145000, costPrice: 100000, variants: [{ size: 'U', color: 'Vainilla', stock: 20 }] })
  const all = (await inv.getProducts({})).data
  assert.equal(all.total, 2); assert.equal(all.items[0].name, 'Proteína 2 lb')
  assert.equal((await inv.getProducts({ search: 'CAMI' })).data.items[0].total_stock, 5)
  assert.equal((await inv.getProducts({ lowStock: true })).data.total, 1)
  const s = (await inv.getStats()).data
  assert.equal(s.totalProducts, 2); assert.equal(s.outOfStock, 1); assert.equal(s.lowStock, 1)
  assert.equal(s.inventoryValue, 20 * 100000 + 5 * 20000)
  assert.equal((await inv.getLowStock()).data.length, 2)
  assert.equal((await inv.searchByBarcode('7701')).data.type, 'variant')
})

test('stock: entrada, salida, ajuste y movimientos', async () => {
  assert.deepEqual(await inv.adjustStock({ variantId, type: 'entrada', qty: 10 }), { ok: true, stockBefore: 5, stockAfter: 15 })
  assert.equal((await inv.adjustStock({ variantId, type: 'salida', qty: 99 })).ok, false)
  assert.equal((await inv.adjustStock({ variantId, type: 'ajuste', qty: 3 })).stockAfter, 3)
  assert.equal((await inv.adjustStock({ variantId, type: 'venta', qty: 1 })).ok, false)
  const m = (await inv.getMovements(variantId)).data
  assert.equal(m.length, 3); assert.equal(m[0].qty, -12)
})

test('variantes: crear, editar, eliminar y volver a crear la misma talla/color', async () => {
  const c = await inv.createVariant({ productId, size: 'XL', color: 'Negro', stock: 2 }); assert.equal(c.ok, true)
  assert.equal((await inv.createVariant({ productId, size: 'xl', color: 'negro' })).ok, false)
  assert.equal((await inv.updateVariant(c.id, { size: 'XXL', color: 'Negro' })).ok, true)
  assert.equal((await inv.updateVariant(c.id, { size: 'M', color: 'Negro' })).ok, false)
  await rejects(inv.updateVariant(c.id, { size: '', color: 'Negro' }), /obligatorios/)
  assert.equal((await inv.deleteVariant(c.id)).ok, true)
  assert.equal((await inv.createVariant({ productId, size: 'XXL', color: 'Negro' })).ok, true)
})

test('editar y eliminar producto (con cambio de imagen)', async () => {
  const before = (await inv.getProduct(productId)).data.image_path
  assert.equal((await inv.updateProduct(productId, { name: 'Camiseta', sku: 'CAM-01', salePrice: 38000, imageData: webp() })).ok, true)
  const after = (await inv.getProduct(productId)).data
  assert.notEqual(after.image_path, before); assert.equal(after.sale_price, 38000)
  assert.equal(await db.images.get(before), undefined)
  assert.equal((await inv.deleteProduct(productId)).ok, true)
  assert.equal((await inv.getProducts({ search: 'camiseta' })).data.total, 0)
})

test('catálogos', async () => {
  assert.equal((await inv.createCategory(' Ropa ')).ok, true)
  assert.equal((await inv.createCategory('ropa')).ok, false)
  assert.equal((await inv.createBrand('Nike')).ok, true)
  assert.equal((await inv.getCategories()).data[0].name, 'Ropa')
})

test('clientes: crear, duplicado, editar, listar y desactivar', async () => {
  const r = await cust.create({ name: 'Ana Pérez', document: '1061234567', phone: '3001234567' }); assert.equal(r.ok, true)
  assert.equal((await cust.create({ name: 'Otra', document: '1061234567', phone: '3001234567' })).ok, false)
  await rejects(cust.create({ name: 'X', document: '12', phone: '3001234567' }), /al menos 5/)
  await rejects(cust.create({ name: 'X', document: '1061234568', phone: 'abc' }), /solo puede contener números/)
  assert.equal((await cust.update(r.id, { name: 'Ana P.', document: '1061234567', phone: '3001234567' })).ok, true)
  assert.equal((await cust.list({ search: 'ana' })).data.items[0].name, 'Ana P.')
  await rejects(cust.get('no-es-uuid'), /Cliente inválido/)
})

test('crédito: abono exige caja abierta y actualiza saldo', async () => {
  const cid = (await cust.list()).data.items[0].id
  const creditId = uuid(), saleId = uuid()
  await db.sales.put({ id: saleId, invoice_number: 'ZF-1', status: 'completed', customer_id: cid, created_at: new Date().toISOString() })
  await db.credits.put({ id: creditId, customer_id: cid, sale_id: saleId, total_amount: 100000, installment_count: 4, installment_amount: 25000, paid_amount: 0, balance: 100000, status: 'pending', created_at: new Date().toISOString() })
  assert.match((await cust.registerCreditPayment(creditId, 30000)).error, /abrir la caja/)
  await db.cash_registers.put({ id: uuid(), status: 'open' })
  assert.equal((await cust.registerCreditPayment(creditId, 200000)).error, 'El abono supera el saldo pendiente')
  assert.equal((await cust.registerCreditPayment(creditId, '30.000')).balance, 70000)
  const row = (await cust.list()).data.items[0]
  assert.equal(row.pending_balance, 70000); assert.equal(row.purchase_count, 1)
  assert.match((await cust.deactivate(cid)).error, /saldo pendiente/)
  assert.equal((await cust.registerCreditPayment(creditId, 70000)).balance, 0)
  assert.equal((await cust.deactivate(cid)).ok, true)
  assert.equal((await cust.list()).data.total, 0)
  assert.equal(await db.cash_income.count(), 2)
})
