const test = require('node:test')
const assert = require('node:assert/strict')
const ProductService = require('../electron/inventory/ProductService')

function makeService() {
  const calls = { product: [], variants: [], deletedImages: [] }
  const db = { transaction: fn => fn() }
  const auth = { getSession: () => ({ id: 1 }), audit: { log: () => {} } }
  const service = new ProductService(db, auth, { getPath: () => require('node:os').tmpdir() })

  service.images = {
    saveDataUrl: data => `products/${data.slice(-8)}.webp`,
    delete: path => calls.deletedImages.push(path),
  }
  service.repo.findBySku = () => null
  service.repo.findByBarcode = () => null
  service.repo.create = data => { calls.product.push(data); return 77 }
  service.repo.createVariant = data => { calls.variants.push(data); return calls.variants.length }
  return { service, calls }
}

test('createProduct guarda un producto y todas sus variantes en una sola operación', () => {
  const { service, calls } = makeService()
  const result = service.createProduct({
    sku: 'CAM-001',
    name: 'Camisa',
    costPrice: '25.000',
    salePrice: '32.000',
    variants: [
      { size: 'S', color: 'Rojo', stock: 5, imageData: 'IMG-ROJO' },
      { size: 'M', color: 'Azul', stock: 2, imageData: 'IMG-AZUL' },
    ],
  })

  assert.deepEqual(result, { ok: true, id: 77 })
  assert.equal(calls.product.length, 1)
  assert.equal(calls.variants.length, 2)
  assert.equal(calls.variants[0].productId, 77)
  assert.equal(calls.variants[1].productId, 77)
  assert.equal(calls.variants[0].imagePath, 'products/IMG-ROJO.webp')
  assert.equal(calls.variants[1].imagePath, 'products/IMG-AZUL.webp')
})

test('createProduct rechaza variantes duplicadas antes de crear el producto', () => {
  const { service, calls } = makeService()
  assert.throws(
    () => service.createProduct({
      sku: 'CAM-002',
      name: 'Camisa 2',
      salePrice: 32000,
      variants: [
        { size: 'S', color: 'Rojo', stock: 1 },
        { size: 's', color: 'rojo', stock: 2 },
      ],
    }),
    /Talla y color duplicados: S \/ rojo/i
  )
  assert.equal(calls.product.length, 0)
  assert.equal(calls.variants.length, 0)
})
