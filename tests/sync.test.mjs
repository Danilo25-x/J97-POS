import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { db, uuid } from '../src/data/db.js'
import { setUser, ADMIN_PERMISSIONS } from '../src/data/session.js'
import * as inv from '../src/data/inventory.js'
import * as sales from '../src/data/sales.js'
import * as cash from '../src/data/cash.js'
import * as settings from '../src/data/settings.js'
import { runSync, syncNow, autoSync, countPending, ensureStockLedger, installWriteHook, getSyncStatus } from '../src/data/sync.js'

class FakeRemote {
  constructor() { this.t = {}; this.images = new Map(); this.session = true; this.clock = Date.parse('2026-10-03T12:00:00Z'); this.upserts = []; this.failTable = null; this.profileChecks = 0 }
  rows(table) { return (this.t[table] ||= new Map()) }
  tick() { this.clock += 1000; return new Date(this.clock).toISOString().replace('Z', '+00:00') }   // formato de Supabase
  async hasSession() { return this.session }
  async ensureProfile() { this.profileChecks += 1 }
  async select(table, { since, limit }) {
    const s = Date.parse(since)
    return [...this.rows(table).values()].filter((r) => Date.parse(r.updated_at) >= s)
      .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).slice(0, limit).map((r) => ({ ...r }))
  }
  async upsert(table, rows, pk) {
    if (table === this.failTable) throw { message: 'insert or update on table "cash_registers" violates foreign key constraint', details: 'Key (user_id) is not present in table "profiles".', code: '23503' }
    for (const r of rows) {
      if (table === 'products' && r.category_id && !this.rows('categories').has(r.category_id)) {
        throw { message: 'insert or update on table "products" violates foreign key constraint "products_category_id_fkey"', details: 'Key is not present in table "categories".', code: '23503' }
      }
    }
    this.upserts.push([table, rows.length]); const now = this.tick(); const out = []
    for (const r of rows) {
      if (table === 'sales' && [...this.rows('sales').values()].some((x) => x.invoice_number === r.invoice_number && x.id !== r.id)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint (invoice_number)'), { code: '23505' })
      }
      const row = { ...r, updated_at: now }; this.rows(table).set(r[pk], row); out.push({ ...row })
    }
    return out
  }
  async findInvoices(nums) { return [...this.rows('sales').values()].filter((s) => nums.includes(s.invoice_number)).map((s) => ({ id: s.id, invoice_number: s.invoice_number })) }
  async maxInvoice(prefix) { return [...this.rows('sales').values()].map((s) => s.invoice_number).filter((n) => n.startsWith(prefix + '-')).sort().at(-1) ?? null }
  async uploadImage(path, blob) { this.images.set(path, blob) }
  async removeImage(path) { this.images.delete(path) }
  async downloadImage(path) { return this.images.get(path) ?? null }
}

const me = uuid(), remote = new FakeRemote()
setUser({ id: me, name: 'Orito', permissions: ADMIN_PERMISSIONS })
await db.profiles.put({ id: me, name: 'Orito', role: 'admin', is_active: true, _dirty: 0 })
await settings.ensureDefaults()
const webp = () => { const b = Buffer.alloc(40); b.write('RIFF', 0); b.write('WEBP', 8); return 'data:image/webp;base64,' + b.toString('base64') }
const sellOne = () => sales.createSale({ items: [{ variantId: vid, qty: 1 }], payments: [{ method: 'efectivo', amount: 50000 }] })
let vid, customerId

test('primera sincronización: sube todo y no queda nada pendiente', async () => {
  const p = await inv.createProduct({ name: 'Proteína', sku: 'P1', salePrice: 50000, costPrice: 30000, imageData: webp(), variants: [{ size: 'U', color: 'Choc', stock: 10 }] })
  vid = (await inv.getProduct(p.id)).data.variants[0].id
  await cash.openRegister({ openingAmount: 100000 })
  assert.equal((await sales.createSale({ items: [{ variantId: vid, qty: 2 }], payments: [{ method: 'efectivo', amount: 100000 }] })).invoice, 'ZF-000001')
  assert.ok(await countPending() > 5)

  assert.equal((await runSync(remote)).ok, true)
  assert.equal(await countPending(), 0)
  for (const [t, n] of [['products', 1], ['product_variants', 1], ['sales', 1], ['sale_items', 1], ['payments', 1], ['cash_registers', 1], ['inventory_movements', 2]]) {
    assert.equal(remote.rows(t).size, n, t)
  }
  assert.equal(remote.images.size, 1)
  assert.equal((await db.images.toArray())[0].uploaded, 1)
  assert.match((await db.sales.toArray())[0].updated_at, /Z$/)   // fechas siempre en formato ISO con Z
})

test('sincronizar de nuevo sin cambios no sube nada', async () => {
  remote.upserts = []
  assert.equal((await runSync(remote)).ok, true)
  assert.deepEqual(remote.upserts, [])
})

test('lo que crea otro dispositivo se descarga', async () => {
  customerId = uuid()
  remote.rows('customers').set(customerId, { id: customerId, name: 'Remota', document: '1099999999', phone: '3009999999', email: null, address: null, notes: null, is_active: true, created_at: remote.tick(), updated_at: remote.tick() })
  await runSync(remote)
  const c = await db.customers.get(customerId)
  assert.equal(c.name, 'Remota'); assert.equal(c._dirty, 0)
})

test('un cambio local pendiente gana sobre el dato remoto y se sube', async () => {
  await db.customers.put({ ...(await db.customers.get(customerId)), name: 'Editada aquí', _dirty: 1, updated_at: new Date().toISOString() })
  remote.rows('customers').get(customerId).name = 'Editada allá'; remote.rows('customers').get(customerId).updated_at = remote.tick()
  await runSync(remote)
  assert.equal((await db.customers.get(customerId)).name, 'Editada aquí')
  assert.equal(remote.rows('customers').get(customerId).name, 'Editada aquí')
})

test('número de factura repetido entre dispositivos: se renumera sin perder la venta', async () => {
  const other = uuid()
  remote.rows('sales').set(other, { id: other, invoice_number: 'ZF-000002', status: 'completed', total: 1, subtotal: 1, created_at: remote.tick(), updated_at: remote.tick() })
  const mine = await sellOne(); assert.equal(mine.invoice, 'ZF-000002')   // este dispositivo no sabía de la otra venta
  assert.equal((await runSync(remote)).ok, true)
  const local = await db.sales.get(mine.saleId)
  assert.equal(local.invoice_number, 'ZF-000003')
  assert.equal(remote.rows('sales').get(mine.saleId).invoice_number, 'ZF-000003')
  assert.equal(remote.rows('sales').get(other).invoice_number, 'ZF-000002')
  assert.equal((await db.inventory_movements.filter((m) => m.reference === 'ZF-000003').count()), 1)
  assert.equal(await db.inventory_movements.filter((m) => m.reference === 'ZF-000002' && m.variant_id === vid).count(), 0)
  assert.ok(Number(await settings.get('invoice_next')) >= 4)
  assert.equal(await countPending(), 0)
})

test('stock: las ventas de dos dispositivos se suman, no se pisan', async () => {
  assert.equal((await db.product_variants.get(vid)).stock, 7)         // 10 − 2 − 1
  const mv = uuid()
  remote.rows('inventory_movements').set(mv, { id: mv, variant_id: vid, user_id: me, type: 'venta', qty: -3, stock_before: 8, stock_after: 5, reference: 'ZF-000002', notes: null, created_at: remote.tick(), updated_at: remote.tick() })
  const rv = remote.rows('product_variants').get(vid); rv.stock = 5; rv.updated_at = remote.tick()   // el otro dispositivo veía 8 − 3
  await runSync(remote)
  assert.equal((await db.product_variants.get(vid)).stock, 4)          // 10 − 2 − 1 − 3
  assert.equal(remote.rows('product_variants').get(vid).stock, 4)
  assert.equal(await countPending(), 0)
})

test('fotos de otros dispositivos se descargan', async () => {
  const pid = uuid(), path = 'products/remota.webp'
  remote.images.set(path, new Blob(['x'], { type: 'image/webp' }))
  remote.rows('products').set(pid, { id: pid, name: 'Remoto', sku: 'R1', barcode: null, description: null, category_id: null, brand_id: null, supplier_id: null, cost_price: 1, sale_price: 2, stock_min: 0, image_path: path, is_active: true, created_at: remote.tick(), updated_at: remote.tick() })
  await runSync(remote)
  const rec = await db.images.get(path)
  assert.ok(rec?.blob); assert.equal(rec.uploaded, 1)
})

test('datos anteriores a la Fase 4 reciben su saldo inicial', async () => {
  const id = uuid()
  await db.product_variants.put({ id, product_id: uuid(), sku_variant: 'LEG', size: 'S', color: 'Rojo', stock: 5, is_active: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', _dirty: 0 })
  await db.meta.delete('ledger_v1')
  await ensureStockLedger()
  const m = await db.inventory_movements.where('variant_id').equals(id).toArray()
  assert.deepEqual([m.length, m[0].qty, m[0].reference], [1, 5, 'Saldo inicial'])
})

test('sin sesión no se sincroniza nada', async () => {
  remote.session = false; remote.upserts = []
  assert.deepEqual(await runSync(remote), { ok: false, reason: 'signedout' })
  assert.deepEqual(remote.upserts, [])
})

test('un fallo al subir no impide bajar datos, y el error dice qué tabla falló', async () => {
  remote.session = true; remote.failTable = 'cash_registers'
  await db.cash_registers.put({ ...(await db.cash_registers.toArray())[0], _dirty: 1, updated_at: new Date().toISOString() })
  const cid = uuid()
  remote.rows('customers').set(cid, { id: cid, name: 'Llegó igual', document: '1088888888', phone: '3008888888', email: null, address: null, notes: null, is_active: true, created_at: remote.tick(), updated_at: remote.tick() })

  await assert.rejects(runSync(remote), (e) => /subir cash_registers/.test(e.message) && /23503/.test(e.message) && /profiles/.test(e.message))
  assert.equal((await db.customers.get(cid))?.name, 'Llegó igual')   // se bajó pese al fallo
  assert.ok(await countPending() > 0)                               // y lo pendiente sigue pendiente

  remote.failTable = null
  assert.equal((await runSync(remote)).ok, true)
  assert.equal(await countPending(), 0)
  assert.ok(remote.profileChecks >= 2)
})

test('el gancho de escritura no rompe las transacciones (error NotFoundError del navegador)', async () => {
  const errs = []
  const onRej = (e) => errs.push(e?.name || String(e)); process.on('unhandledRejection', onRej)
  const origError = console.error; console.error = (...a) => errs.push(String(a[0]))
  installWriteHook()
  const r = await inv.createProduct({ name: 'Con gancho', sku: 'GAN-1', variants: [{ size: 'M', color: 'Azul', stock: 3 }] })
  await new Promise((res) => setTimeout(res, 150))
  console.error = origError; process.off('unhandledRejection', onRej)
  assert.equal(r.ok, true)
  assert.deepEqual(errs, [])
  assert.ok(getSyncStatus().pending > 0)    // el contador de pendientes sí se actualizó
})

test('sin red o con sesión vencida no se muestra como error de sincronización', async () => {
  remote.session = true; remote.failTable = null
  await db.customers.put({ ...(await db.customers.toArray())[0], _dirty: 1, updated_at: new Date().toISOString() })
  const realUpsert = remote.upsert.bind(remote)

  remote.upsert = async () => { throw Object.assign(new Error('Sin conexión'), { code: 'OFFLINE' }) }
  assert.deepEqual(await syncNow(() => remote), { ok: false, reason: 'offline' })
  assert.equal(getSyncStatus().state, 'offline'); assert.equal(getSyncStatus().error, null)

  remote.upsert = async () => { throw Object.assign(new Error('Tu sesión venció. Inicia sesión de nuevo.'), { code: 'SESSION_EXPIRED' }) }
  assert.deepEqual(await syncNow(() => remote), { ok: false, reason: 'signedout' })
  assert.equal(getSyncStatus().state, 'signedout'); assert.match(getSyncStatus().error, /sesión venció/)

  remote.upsert = realUpsert
  assert.equal((await syncNow(() => remote)).ok, true)
  assert.equal(getSyncStatus().state, 'idle'); assert.equal(await countPending(), 0)
})

test('categoría borrada en el servidor: se vuelve a subir y el producto sincroniza', async () => {
  const { uuid: id } = await import('../src/data/db.js')
  const catId = id()
  await db.categories.put({ id: catId, name: 'Camisas', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _dirty: 0 })   // "ya sincronizada"
  const p = await inv.createProduct({ name: 'Con categoría', sku: 'CAT-1', categoryId: catId })
  assert.equal((await runSync(remote)).ok, true)
  assert.ok(remote.rows('categories').has(catId))                       // se reenvió la categoría que faltaba
  assert.equal(remote.rows('products').get(p.id).category_id, catId)
  assert.equal(await countPending(), 0)
})

test('referencia opcional que no existe ni en el dispositivo se anula y no bloquea', async () => {
  const p = await inv.createProduct({ name: 'Categoría fantasma', sku: 'FAN-1', categoryId: uuid() })
  assert.equal((await runSync(remote)).ok, true)
  assert.equal(remote.rows('products').get(p.id).category_id, null)
  assert.equal((await db.products.get(p.id)).category_id, null)
  assert.equal(await countPending(), 0)
})

test('tras un error, la sincronización automática espera antes de reintentar', async () => {
  remote.session = true
  remote.upsert = async () => { throw { message: 'boom', code: 'XX000' } }
  await db.customers.put({ ...(await db.customers.toArray())[0], _dirty: 1, updated_at: new Date().toISOString() })
  await syncNow(() => remote)
  assert.equal(getSyncStatus().state, 'error')
  assert.deepEqual(await autoSync(), { ok: false, reason: 'cooldown' })   // no repite en bucle
})

test('fotos: no se piden las de productos eliminados y las que faltan no se piden en bucle', async () => {
  remote.session = true; remote.upsert = FakeRemote.prototype.upsert.bind(remote); remote.failTable = null
  let calls = []
  const realDownload = remote.downloadImage.bind(remote)
  remote.downloadImage = async (path) => { calls.push(path); return realDownload(path) }
  const mkProduct = (sku, path, active) => { const id = uuid(); remote.rows('products').set(id, { id, name: sku, sku, barcode: null, description: null, category_id: null, brand_id: null, supplier_id: null, cost_price: 1, sale_price: 2, stock_min: 0, image_path: path, is_active: active, created_at: remote.tick(), updated_at: remote.tick() }) }
  mkProduct('INACT', 'products/eliminado.webp', false)
  mkProduct('FALTA', 'products/no-subida.webp', true)

  await runSync(remote); await runSync(remote); await runSync(remote)
  assert.equal(calls.filter((p) => p.includes('eliminado')).length, 0)    // producto eliminado: ni se intenta
  assert.equal(calls.filter((p) => p.includes('no-subida')).length, 1)    // la que falta se pide una sola vez, no en cada ciclo
})

test('las fotos pendientes se suben aunque falle la subida de una tabla', async () => {
  const path = 'products/pendiente-' + uuid() + '.webp'
  await db.images.put({ path, blob: new Blob(['x'], { type: 'image/webp' }), uploaded: 0, deleted: 0, updated_at: new Date().toISOString() })
  await db.cash_registers.put({ ...(await db.cash_registers.toArray())[0], _dirty: 1, updated_at: new Date().toISOString() })
  remote.failTable = 'cash_registers'
  await assert.rejects(runSync(remote), /subir cash_registers/)
  assert.ok(remote.images.has(path))
  remote.failTable = null
  assert.equal((await runSync(remote)).ok, true)
})

test('al eliminar un producto su fila deja de apuntar a una foto borrada', async () => {
  const p = await inv.createProduct({ name: 'Con foto', sku: 'FOTO-DEL', imageData: webp() })
  assert.ok((await db.products.get(p.id)).image_path)
  await inv.deleteProduct(p.id)
  const row = await db.products.get(p.id)
  assert.deepEqual([row.is_active, row.image_path], [false, null])
})
