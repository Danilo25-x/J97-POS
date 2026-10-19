// src/data/inventory.js — port de ProductRepository + ProductService (electron/inventory).
import { db, uuid, nowIso, save, strip } from './db.js'
import { getUser } from './session.js'
import { audit } from './audit.js'
import { cop } from './validation.js'
import * as images from './images.js'

const TX = () => [db.products, db.product_variants, db.inventory_movements, db.audit_logs]
const eqi = (a, b) => String(a).toLocaleLowerCase() === String(b).toLocaleLowerCase()
const has = (v, q) => String(v ?? '').toLowerCase().includes(q)
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es')

async function lowStockThreshold() {
  const r = await db.settings.get('low_stock_threshold')
  return r ? Number(r.value) : 5
}

async function nameMaps() {
  const [c, b, s] = await Promise.all([db.categories.toArray(), db.brands.toArray(), db.suppliers.toArray()])
  const m = (rows) => new Map(rows.map((x) => [x.id, x.name]))
  return { cat: m(c), brand: m(b), sup: m(s) }
}

async function barcodeTaken(code, exceptVariantId = null) {
  if (!code) return false
  const v = await db.product_variants.where('barcode').equals(code)
    .filter((x) => x.is_active && x.id !== exceptVariantId).first()
  if (v) return true
  return !!(await db.products.where('barcode').equals(code).filter((x) => x.is_active).first())
}

async function activeVariants(productId) {
  return (await db.product_variants.where('product_id').equals(productId).toArray())
    .filter((v) => v.is_active)
}

function withDisplayImage(variants, product) {
  return variants
    .map((v) => ({ ...strip(v), display_image_path: v.image_path || product.image_path || null }))
    .sort((a, b) => a.size.localeCompare(b.size, 'es') || a.color.localeCompare(b.color, 'es'))
}

// ─── Validación ─────────────────────────────────────────────

function validateProduct(data = {}) {
  const name = String(data.name ?? '').trim()
  const sku = String(data.sku ?? '').trim()
  if (!name) throw new Error('El nombre del producto es obligatorio')
  if (!sku) throw new Error('El SKU es obligatorio')
  if (sku.length > 100) throw new Error('El SKU es demasiado largo')
  if (name.length > 200) throw new Error('El nombre del producto es demasiado largo')
  return {
    name, sku,
    salePrice: cop(data.salePrice ?? 0, 'El precio de venta'),
    costPrice: cop(data.costPrice ?? 0, 'El precio de costo'),
  }
}

function validateVariant(data = {}) {
  const size = String(data.size ?? '').trim()
  const color = String(data.color ?? '').trim()
  if (!size || !color) throw new Error('Talla y color son obligatorios')
  if (size.length > 50 || color.length > 80) throw new Error('La talla o el color son demasiado largos')

  const barcode = data.barcode == null ? null : String(data.barcode).trim()
  if (barcode && !/^[0-9]+$/.test(barcode)) throw new Error('El código de barras solo puede contener números')

  const stock = Number(data.stock ?? 0)
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('El stock debe ser un entero no negativo')

  let priceOverride = data.priceOverride
  if (priceOverride != null && priceOverride !== '') {
    try { priceOverride = cop(priceOverride, 'Precio de la variante') }
    catch { throw new Error('El precio de la variante no es válido') }
  } else priceOverride = null

  return { size, color, stock, priceOverride, barcode: barcode || null }
}

// ─── Productos ──────────────────────────────────────────────

export async function getProducts({ search, categoryId, brandId, lowStock, page = 1, pageSize = 20 } = {}) {
  page = Math.max(1, Number(page) || 1)
  pageSize = Math.max(1, Number(pageSize) || 20)
  const [prods, variants, nm, thr] = await Promise.all([
    db.products.toArray(), db.product_variants.toArray(), nameMaps(), lowStockThreshold(),
  ])
  const stock = new Map(), count = new Map()
  for (const v of variants) if (v.is_active) {
    stock.set(v.product_id, (stock.get(v.product_id) || 0) + v.stock)
    count.set(v.product_id, (count.get(v.product_id) || 0) + 1)
  }
  const q = String(search || '').trim().toLowerCase()
  let rows = prods.filter((p) => p.is_active)
  if (q) rows = rows.filter((p) => has(p.name, q) || has(p.sku, q) || has(p.barcode, q))
  if (categoryId) rows = rows.filter((p) => p.category_id === categoryId)
  if (brandId) rows = rows.filter((p) => p.brand_id === brandId)

  rows = rows.map((p) => ({
    ...strip(p),
    category_name: nm.cat.get(p.category_id) ?? null,
    brand_name: nm.brand.get(p.brand_id) ?? null,
    supplier_name: nm.sup.get(p.supplier_id) ?? null,
    total_stock: stock.get(p.id) || 0,
    variant_count: count.get(p.id) || 0,
  }))
  if (lowStock) rows = rows.filter((p) => p.total_stock <= thr)
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  return { ok: true, data: { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize } }
}

async function findById(id) {
  const p = await db.products.get(id)
  if (!p) return null
  const nm = await nameMaps()
  return {
    ...strip(p),
    category_name: nm.cat.get(p.category_id) ?? null,
    brand_name: nm.brand.get(p.brand_id) ?? null,
    supplier_name: nm.sup.get(p.supplier_id) ?? null,
    variants: withDisplayImage(await activeVariants(id), p),
  }
}

export async function getProduct(id) {
  const product = await findById(id)
  return product ? { ok: true, data: product } : { ok: false, error: 'Producto no encontrado' }
}

async function createVariantInternal(productId, productSku, v) {
  const skuVariant = v.skuVariant ||
    `${productSku}-${v.size}-${v.color}`.replace(/\s+/g, '-').toUpperCase()
  if (await db.product_variants.where('sku_variant').equals(skuVariant).filter((x) => x.is_active).first()) {
    throw new Error(`Ya existe una variante con el SKU "${skuVariant}"`)
  }
  const id = uuid()
  await save('product_variants', {
    id, product_id: productId, sku_variant: skuVariant, size: v.size, color: v.color,
    stock: v.stock || 0, price_override: v.priceOverride ?? null,
    barcode: v.barcode || null, image_path: v.imagePath || null,
    is_active: true, created_at: nowIso(),
  })
  // El stock es siempre la suma de sus movimientos: así dos dispositivos pueden sincronizarse sin perder ventas.
  if ((v.stock || 0) > 0) {
    await save('inventory_movements', {
      id: uuid(), variant_id: id, user_id: getUser()?.id ?? null, type: 'entrada', qty: v.stock,
      stock_before: 0, stock_after: v.stock, reference: 'Stock inicial', notes: null, created_at: nowIso(),
    })
  }
  return id
}

export async function createProduct(data = {}) {
  const np = validateProduct(data)
  const sku = np.sku
  if (await db.products.where('sku').equals(sku).first()) {
    return { ok: false, error: `Ya existe un producto con el SKU "${sku}"` }
  }

  let imagePath = null
  const variantImagePaths = []
  try {
    if (data.imageData) imagePath = await images.saveDataUrl(data.imageData)

    const prepared = []
    const seenVariants = new Set(), seenBarcodes = new Set()
    for (const v of Array.isArray(data.variants) ? data.variants : []) {
      const nv = validateVariant(v)
      const key = `${nv.size.toLocaleLowerCase()}::${nv.color.toLocaleLowerCase()}`
      if (seenVariants.has(key)) throw new Error(`Talla y color duplicados: ${nv.size} / ${nv.color}`)
      seenVariants.add(key)

      if (nv.barcode) {
        if (seenBarcodes.has(nv.barcode)) throw new Error(`El código de barras ${nv.barcode} está repetido entre las variantes`)
        seenBarcodes.add(nv.barcode)
        if (await barcodeTaken(nv.barcode)) throw new Error(`Ya existe un producto o variante con el código de barras "${nv.barcode}"`)
      }
      let vp = null
      if (v.imageData) { vp = await images.saveDataUrl(v.imageData); variantImagePaths.push(vp) }
      prepared.push({ ...v, ...nv, imagePath: vp })
    }

    const productId = uuid()
    await db.transaction('rw', TX(), async () => {
      await save('products', {
        id: productId, sku, name: np.name, description: data.description || null,
        category_id: data.categoryId || null, brand_id: data.brandId || null, supplier_id: data.supplierId || null,
        barcode: null, cost_price: np.costPrice, sale_price: np.salePrice, stock_min: 0,
        image_path: imagePath, is_active: true, created_at: nowIso(),
      })
      for (const v of prepared) await createVariantInternal(productId, sku, v)
      await audit('create_product', 'product', productId, {
        sku, name: data.name, variantCount: prepared.length,
        variantsWithImages: prepared.filter((v) => v.imagePath).length,
      })
    })
    return { ok: true, id: productId }
  } catch (error) {
    if (imagePath) await images.deleteImage(imagePath)
    for (const p of variantImagePaths) await images.deleteImage(p)
    throw error
  }
}

export async function updateProduct(id, data = {}) {
  const existing = await db.products.get(id)
  if (!existing) return { ok: false, error: 'Producto no encontrado' }
  const np = validateProduct(data)

  if (np.sku !== existing.sku) {
    const dup = await db.products.where('sku').equals(np.sku).first()
    if (dup && dup.id !== id) return { ok: false, error: `Ya existe otro producto con el SKU "${np.sku}"` }
  }

  let newImagePath = existing.image_path || null
  let createdNew = false
  try {
    if (data.removeImage) newImagePath = null
    if (data.imageData) { newImagePath = await images.saveDataUrl(data.imageData); createdNew = true }

    await db.transaction('rw', TX(), async () => {
      await save('products', {
        ...existing, sku: np.sku, name: np.name, description: data.description || null,
        category_id: data.categoryId || null, brand_id: data.brandId || null, supplier_id: data.supplierId || null,
        cost_price: np.costPrice, sale_price: np.salePrice, image_path: newImagePath,
      })
      await audit('update_product', 'product', id, { sku: np.sku, imageChanged: Boolean(data.imageData || data.removeImage) })
    })
    if (existing.image_path && (createdNew || data.removeImage)) await images.deleteImage(existing.image_path)
    return { ok: true }
  } catch (error) {
    if (createdNew && newImagePath) await images.deleteImage(newImagePath)
    throw error
  }
}

export async function deleteProduct(id) {
  const existing = await db.products.get(id)
  if (!existing) return { ok: false, error: 'Producto no encontrado' }
  await db.transaction('rw', TX(), async () => {
    await save('products', { ...existing, is_active: false, image_path: null })
    await audit('delete_product', 'product', id, { sku: existing.sku, imageDeleted: Boolean(existing.image_path) })
  })
  if (existing.image_path) await images.deleteImage(existing.image_path)
  return { ok: true }
}

export async function searchByBarcode(barcode) {
  const v = await db.product_variants.where('barcode').equals(String(barcode)).filter((x) => x.is_active).first()
  if (v) {
    const p = await db.products.get(v.product_id)
    return { ok: true, data: { type: 'variant', data: { ...strip(v), product_name: p?.name, sku: p?.sku, product_price: p?.sale_price } } }
  }
  const p = await db.products.where('barcode').equals(String(barcode)).filter((x) => x.is_active).first()
  if (p) return { ok: true, data: { type: 'product', data: strip(p) } }
  return { ok: false, error: 'Código no encontrado' }
}

// ─── Variantes ──────────────────────────────────────────────

export async function getVariants(productId) {
  const p = await db.products.get(productId)
  return { ok: true, data: p ? withDisplayImage(await activeVariants(productId), p) : [] }
}

export async function createVariant(data = {}) {
  const nv = validateVariant(data)
  const product = await db.products.get(data.productId)
  if (!product) return { ok: false, error: 'Producto no encontrado' }

  const dup = (await activeVariants(product.id)).find((v) => eqi(v.size, nv.size) && eqi(v.color, nv.color))
  if (dup) return { ok: false, error: `Ya existe la variante ${nv.size} / ${nv.color}` }
  if (nv.barcode && await barcodeTaken(nv.barcode)) {
    return { ok: false, error: `Ya existe un producto o variante con el código de barras "${nv.barcode}"` }
  }

  let imagePath = null
  try {
    if (data.imageData) imagePath = await images.saveDataUrl(data.imageData)
    const id = await db.transaction('rw', TX(), async () => {
      const createdId = await createVariantInternal(product.id, product.sku, { ...data, ...nv, imagePath })
      await audit('create_variant', 'product_variant', createdId, { skuVariant: data.skuVariant, size: nv.size, color: nv.color, imageChanged: Boolean(imagePath) })
      return createdId
    })
    return { ok: true, id }
  } catch (error) {
    if (imagePath) await images.deleteImage(imagePath)
    throw error
  }
}

export async function updateVariant(id, data = {}) {
  const variant = await db.product_variants.get(id)
  if (!variant) return { ok: false, error: 'Variante no encontrada' }
  const nv = validateVariant({ ...variant, ...data })

  const dup = (await activeVariants(variant.product_id))
    .find((v) => v.id !== id && eqi(v.size, nv.size) && eqi(v.color, nv.color))
  if (dup) return { ok: false, error: `Ya existe la variante ${nv.size} / ${nv.color}` }
  if (nv.barcode && await barcodeTaken(nv.barcode, id)) {
    return { ok: false, error: `Ya existe un producto o variante con el código de barras "${nv.barcode}"` }
  }

  let newImagePath = variant.image_path || null
  let createdNew = false
  try {
    if (data.removeImage) newImagePath = null
    if (data.imageData) { newImagePath = await images.saveDataUrl(data.imageData); createdNew = true }

    await db.transaction('rw', TX(), async () => {
      await save('product_variants', {
        ...variant, size: nv.size, color: nv.color,
        price_override: nv.priceOverride ?? null, barcode: nv.barcode || null, image_path: newImagePath,
      })
      await audit('update_variant', 'product_variant', id, { size: nv.size, color: nv.color, imageChanged: Boolean(data.imageData || data.removeImage) })
    })
    if (variant.image_path && (createdNew || data.removeImage)) await images.deleteImage(variant.image_path)
    return { ok: true }
  } catch (error) {
    if (createdNew && newImagePath) await images.deleteImage(newImagePath)
    throw error
  }
}

export async function deleteVariant(id) {
  const variant = await db.product_variants.get(id)
  if (!variant) return { ok: false, error: 'Variante no encontrada' }
  await db.transaction('rw', TX(), async () => {
    await save('product_variants', { ...variant, is_active: false, image_path: null })
    await audit('delete_variant', 'product_variant', id, {})
  })
  if (variant.image_path) await images.deleteImage(variant.image_path)
  return { ok: true }
}

// ─── Stock ──────────────────────────────────────────────────

export async function adjustStock({ variantId, type, qty, reference, notes } = {}) {
  const variant = await db.product_variants.get(variantId)
  if (!variant) return { ok: false, error: 'Variante no encontrada' }
  if (!['entrada', 'salida', 'ajuste'].includes(type)) return { ok: false, error: 'Tipo de movimiento inválido' }

  const n = Number(qty)
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'La cantidad debe ser un entero no negativo' }

  const stockBefore = variant.stock
  let stockAfter
  if (type === 'entrada') stockAfter = stockBefore + n
  else if (type === 'salida') {
    stockAfter = stockBefore - n
    if (stockAfter < 0) return { ok: false, error: 'El stock no puede quedar negativo' }
  } else stockAfter = n

  await db.transaction('rw', TX(), async () => {
    await save('product_variants', { ...variant, stock: stockAfter })
    await save('inventory_movements', {
      id: uuid(), variant_id: variantId, user_id: getUser()?.id ?? null, type,
      qty: stockAfter - stockBefore, stock_before: stockBefore, stock_after: stockAfter,
      reference: reference || null, notes: notes || null, created_at: nowIso(),
    })
    await audit('adjust_stock', 'product_variant', variantId, { type, qty, stockBefore, stockAfter })
  })
  return { ok: true, stockBefore, stockAfter }
}

export async function getMovements(variantId, limit = 50) {
  const [rows, profiles] = await Promise.all([
    db.inventory_movements.where('variant_id').equals(variantId).toArray(), db.profiles.toArray(),
  ])
  const names = new Map(profiles.map((p) => [p.id, p.name]))
  const data = rows
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((m) => ({ ...strip(m), user_name: names.get(m.user_id) ?? null }))
  return { ok: true, data }
}

async function activePairs() {
  const [variants, prods] = await Promise.all([db.product_variants.toArray(), db.products.toArray()])
  const pm = new Map(prods.filter((p) => p.is_active).map((p) => [p.id, p]))
  return variants.filter((v) => v.is_active && pm.has(v.product_id)).map((v) => ({ v, p: pm.get(v.product_id) }))
}

export async function getLowStock() {
  const thr = await lowStockThreshold()
  const data = (await activePairs())
    .filter(({ v }) => v.stock <= thr)
    .sort((a, b) => a.v.stock - b.v.stock)
    .map(({ v, p }) => ({ ...strip(v), product_name: p.name, sku: p.sku }))
  return { ok: true, data }
}

export async function getStats() {
  const [pairs, threshold, totalProducts] = await Promise.all([
    activePairs(), lowStockThreshold(), db.products.filter((p) => p.is_active).count(),
  ])
  return {
    ok: true,
    data: {
      totalProducts,
      lowStock: pairs.filter(({ v }) => v.stock > 0 && v.stock <= threshold).length,
      outOfStock: pairs.filter(({ v }) => v.stock === 0).length,
      inventoryValue: pairs.reduce((s, { v, p }) => s + v.stock * p.cost_price, 0),
      threshold,
    },
  }
}

// ─── Catálogos ──────────────────────────────────────────────

const activeSorted = async (table) => (await db.table(table).toArray()).filter((r) => r.is_active).sort(byName).map(strip)
export const getCategories = async () => ({ ok: true, data: await activeSorted('categories') })
export const getBrands = async () => ({ ok: true, data: await activeSorted('brands') })
export const getSuppliers = async () => ({ ok: true, data: await activeSorted('suppliers') })

async function createNamed(table, label, name) {
  const clean = String(name ?? '').trim()
  if (!clean) return { ok: false, error: 'Nombre requerido' }
  if ((await db.table(table).toArray()).some((r) => eqi(r.name, clean))) {
    return { ok: false, error: `Ya existe ${label} con ese nombre` }
  }
  const id = uuid()
  await save(table, { id, name: clean, is_active: true, created_at: nowIso() })
  return { ok: true, id }
}
export const createCategory = (name) => createNamed('categories', 'una categoría', name)
export const createBrand = (name) => createNamed('brands', 'una marca', name)
