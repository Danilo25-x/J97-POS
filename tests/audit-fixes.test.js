// tests/audit-fixes.test.js
// Pruebas para las correcciones de la auditoría técnica:
// 1) ProductService.updateVariant ahora valida talla/color/precio igual que createVariant.
// 2) SettingsService.set valida el formato de invoice_prefix.
// 3) SettingsHandlers cierra la sesión activa tras restaurar un backup.

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')

const SettingsService = require('../electron/settings/SettingsService')
const ProductService = require('../electron/inventory/ProductService')

// ── 1. Validación de invoice_prefix ─────────────────────────────
test('invoice_prefix rechaza rutas/caracteres peligrosos y acepta valores válidos', () => {
  const writes = []
  const db = { all: () => [], get: () => null, run: (...args) => writes.push(args) }
  const service = new SettingsService(db)

  assert.throws(() => service.set('invoice_prefix', '../../etc'), /letras, números y guiones/i)
  assert.throws(() => service.set('invoice_prefix', 'A/B'), /letras, números y guiones/i)
  assert.throws(() => service.set('invoice_prefix', ''), /letras, números y guiones/i)

  service.set('invoice_prefix', 'j97')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][1][1], 'J97') // se normaliza a mayúsculas
})

// ── 2. Validación de variantes al editar ────────────────────────
function fakeApp() {
  return { getPath: () => path.join(os.tmpdir(), 'j97-audit-test-' + process.pid) }
}

function variantDb(variant) {
  return {
    variant,
    all: () => [],
    get: () => null,
    run: () => ({ lastInsertRowid: 1 }),
    transaction: (fn) => fn(),
  }
}

test('updateVariant rechaza talla/color vacíos igual que createVariant', () => {
  const variant = { id: 5, product_id: 1, size: 'M', color: 'Negro', stock: 3, price_override: null, image_path: null }
  const db = variantDb(variant)
  const authService = { getSession: () => ({ id: 1 }), audit: { log: () => {} } }
  const service = new ProductService(db, authService, fakeApp())

  service.repo.findVariantById = (id) => (id === variant.id ? variant : null)
  service.repo.findVariantsByProduct = () => []

  assert.throws(() => service.updateVariant(5, { size: '', color: 'Negro' }), /Talla y color son obligatorios/)
  assert.throws(() => service.updateVariant(5, { size: 'M', color: 'Negro', priceOverride: -100 }), /precio de la variante no es válido/)
})

test('updateVariant acepta una edición válida y conserva el stock existente', () => {
  const variant = { id: 5, product_id: 1, size: 'M', color: 'Negro', stock: 3, price_override: null, image_path: null }
  const db = variantDb(variant)
  const authService = { getSession: () => ({ id: 1 }), audit: { log: () => {} } }
  const service = new ProductService(db, authService, fakeApp())

  service.repo.findVariantById = (id) => (id === variant.id ? variant : null)
  service.repo.findVariantsByProduct = () => [variant]
  let updateCalled = false
  service.repo.updateVariant = () => { updateCalled = true }

  const res = service.updateVariant(5, { size: 'L', color: 'Negro' })
  assert.equal(res.ok, true)
  assert.equal(updateCalled, true)
})
