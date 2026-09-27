// tests/migrations-and-variants.test.js
// Corrección aplicada en esta ronda:
// 1) `001_initial_clean.sql` chocaba con `001_init.sql` + `002_pos_core.sql`
//    (creaba las mismas tablas sin IF NOT EXISTS) y rompía el arranque de
//    la base de datos, tanto en una instalación nueva como en la máquina
//    del usuario en el siguiente arranque. Se eliminó ese archivo.
//    Verificado manualmente ejecutando las migraciones reales con el
//    runtime de Electron (ELECTRON_RUN_AS_NODE=1): antes de la corrección
//    fallaban con "table users already exists"; después, las 14 migraciones
//    se aplican limpio sobre una base de datos nueva.
// 2) Crear un producto con dos variantes de la misma talla+color ahora
//    devuelve un mensaje claro en vez del error crudo de SQLite
//    ("UNIQUE constraint failed: product_variants.sku_variant").
//
// Nota: igual que el resto de la suite, estas pruebas no abren una base de
// datos SQLite real (better-sqlite3 está compilado para el ABI de Electron,
// no el de Node del sistema, así que `node --test` fallaría con un error de
// NODE_MODULE_VERSION). Se usan los mismos mocks livianos que ya usa
// `backend-hardening.test.js`.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ProductService = require('../electron/inventory/ProductService')

test('no existen dos archivos de migración "001" en conflicto', () => {
  const dir = path.join(__dirname, '..', 'electron', 'database', 'migrations')
  const files = fs.readdirSync(dir).filter(f => f.startsWith('001'))
  assert.equal(files.length, 1, `solo debe existir una migración 001, se encontraron: ${files.join(', ')}`)
})

function fakeProductDb() {
  const products = []
  const variants = []
  return {
    products, variants,
    all: () => [],
    get: (sql, params) => {
      if (/FROM products WHERE sku/.test(sql)) return products.find(p => p.sku === params[0]) || null
      return null
    },
    run: (sql, params) => {
      if (/INSERT INTO products/.test(sql)) {
        const id = products.length + 1
        products.push({ id, sku: params[0] })
        return { lastInsertRowid: id }
      }
      if (/INSERT INTO product_variants/.test(sql)) {
        const key = `${params[2]}__${params[3]}` // size, color
        if (variants.some(v => v.key === key)) {
          throw new Error('UNIQUE constraint failed: product_variants.sku_variant')
        }
        variants.push({ key })
        return { lastInsertRowid: variants.length }
      }
      return { lastInsertRowid: 0 }
    },
    transaction: (fn) => fn(),
  }
}

test('crear un producto con variantes de talla/color repetidos da un error claro y no deja nada guardado', () => {
  const db = fakeProductDb()
  const authService = { getSession: () => ({ id: 1 }), audit: { log: () => {} } }
  const service = new ProductService(db, authService, { getPath: () => os.tmpdir() })

  assert.throws(
    () => service.createProduct({
      sku: 'DUP-1', name: 'Producto duplicado', salePrice: 1000, costPrice: 500,
      variants: [
        { size: 'M', color: 'Negro', stock: 1 },
        { size: 'm', color: 'negro', stock: 2 },
      ]
    }),
    /Talla y color duplicados/
  )
  assert.equal(db.products.length, 0)
  assert.equal(db.variants.length, 0)
})

test('crear un producto con variantes válidas (talla/color distintos) funciona de punta a punta', () => {
  const db = fakeProductDb()
  const authService = { getSession: () => ({ id: 1 }), audit: { log: () => {} } }
  const service = new ProductService(db, authService, { getPath: () => os.tmpdir() })

  const r = service.createProduct({
    sku: 'OK-1', name: 'Producto ok', salePrice: 1000, costPrice: 500,
    variants: [
      { size: 'M', color: 'Negro', stock: 5 },
      { size: 'L', color: 'Negro', stock: 3 },
    ]
  })
  assert.equal(r.ok, true)
  assert.equal(db.variants.length, 2)
})
