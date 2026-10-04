// tests/supabase-sync.test.js
// Verifica, con un cliente de Supabase simulado (sin red real), que:
// 1) Un producto/variante con stock > 0 sube su imagen normalmente.
// 2) Un producto/variante con stock = 0 BORRA la imagen en la nube pero
//    mantiene la fila (no se elimina de la tabla), para no romper el
//    historial de ventas ni los reportes de una futura página web.
// 3) Si Supabase no está configurado o la sincronización está apagada,
//    no intenta conectarse a nada.

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const SupabaseSync = require('../electron/sync/SupabaseSync')

function fakeImages(existingFiles) {
  return {
    getAbsolutePath: (relativePath) => existingFiles[relativePath] || null,
  }
}

function fakeSettingsService(overrides = {}) {
  const base = { sync_enabled: '1', supabase_url: 'https://demo.supabase.co', supabase_anon_key: 'anon-key', ...overrides }
  return { getAll: () => base }
}

function fakeSupabaseClient(log) {
  const table = (name) => ({
    upsert: async (row) => { log.upserts.push({ table: name, row }); return { error: null } },
  })
  return {
    from: table,
    storage: {
      from: () => ({
        upload: async (relPath) => { log.uploads.push(relPath); return { error: null } },
        remove: async (paths) => { log.removals.push(...paths); return { error: null } },
        getPublicUrl: (relPath) => ({ data: { publicUrl: `https://demo.supabase.co/storage/v1/object/public/product-images/${relPath}` } }),
      }),
    },
  }
}

function fakeDb(products, variants) {
  return {
    all: (sql) => {
      if (/FROM products p/.test(sql)) return products
      if (/FROM product_variants\s+WHERE synced_at/.test(sql)) return variants
      if (/FROM sales WHERE synced_at/.test(sql)) return []
      return []
    },
    get: () => null,
    run: () => {},
  }
}

test('producto con stock 0: borra la imagen en la nube pero mantiene la fila', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j97-sync-'))
  const imgPath = path.join(tmp, 'fake.webp')
  fs.writeFileSync(imgPath, 'contenido-de-prueba')

  const products = [{
    id: 1, sku: 'SIN-STOCK', name: 'Agotado', description: null,
    category_id: null, brand_id: null, cost_price: 1000, sale_price: 2000,
    image_path: 'products/fake.webp', is_active: 1, updated_at: '2026-01-01', total_stock: 0,
  }]
  const db = fakeDb(products, [])
  const log = { upserts: [], uploads: [], removals: [] }

  const sync = new SupabaseSync(db, {}, fakeImages({ 'products/fake.webp': imgPath }))
  sync._getClient = () => fakeSupabaseClient(log)

  const result = await sync.runSync(fakeSettingsService())

  assert.equal(result.ok, true)
  assert.equal(log.uploads.length, 0, 'no debe subir imagen de un producto sin stock')
  assert.deepEqual(log.removals, ['products/fake.webp'], 'debe borrar la imagen existente')
  assert.equal(log.upserts.length, 1, 'la fila del producto SÍ debe seguir enviándose')
  assert.equal(log.upserts[0].row.image_url, null, 'el campo image_url debe quedar en null')
  assert.equal(log.upserts[0].row.sku, 'SIN-STOCK')
})

test('producto con stock > 0: sube la imagen y guarda su URL pública', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j97-sync-'))
  const imgPath = path.join(tmp, 'fake.webp')
  fs.writeFileSync(imgPath, 'contenido-de-prueba')

  const products = [{
    id: 2, sku: 'CON-STOCK', name: 'Disponible', description: null,
    category_id: null, brand_id: null, cost_price: 1000, sale_price: 2000,
    image_path: 'products/fake.webp', is_active: 1, updated_at: '2026-01-01', total_stock: 5,
  }]
  const db = fakeDb(products, [])
  const log = { upserts: [], uploads: [], removals: [] }

  const sync = new SupabaseSync(db, {}, fakeImages({ 'products/fake.webp': imgPath }))
  sync._getClient = () => fakeSupabaseClient(log)

  const result = await sync.runSync(fakeSettingsService())

  assert.equal(result.ok, true)
  assert.deepEqual(log.uploads, ['products/fake.webp'])
  assert.equal(log.removals.length, 0)
  assert.ok(log.upserts[0].row.image_url?.includes('fake.webp'))
})

test('sin credenciales de Supabase configuradas, no intenta sincronizar', async () => {
  const db = fakeDb([], [])
  const sync = new SupabaseSync(db, {}, fakeImages({}))
  const result = await sync.runSync(fakeSettingsService({ supabase_url: '', supabase_anon_key: '' }))
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
})

test('con la sincronización desactivada en Ajustes, no intenta sincronizar', async () => {
  const db = fakeDb([], [])
  const sync = new SupabaseSync(db, {}, fakeImages({}))
  const result = await sync.runSync(fakeSettingsService({ sync_enabled: '0' }))
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
})
