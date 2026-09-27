// electron/inventory/ProductService.js

const ProductRepository = require('./ProductRepository')
const ProductImageService = require('../media/ProductImageService')
const { cop } = require('../lib/validation')

class ProductService {
  constructor(db, authService, app) {
    this.repo = new ProductRepository(db)
    this.auth = authService
    this.images = new ProductImageService(app)
  }

  // ─── Productos ────────────────────────────────────────────

  getProducts(filters) {
    return { ok: true, data: this.repo.findAll(filters) }
  }

  getProduct(id) {
    const product = this.repo.findById(id)
    if (!product) return { ok: false, error: 'Producto no encontrado' }
    return { ok: true, data: product }
  }

  createProduct(data = {}) {
    const normalizedProduct = this._validateProduct(data)
    const sku = normalizedProduct.sku

    if (this.repo.findBySku(sku)) {
      return { ok: false, error: `Ya existe un producto con el SKU "${sku}"` }
    }

    let imagePath = null
    const variantImagePaths = []

    try {
      // Primero validamos y guardamos los archivos fuera de la transacción SQLite.
      // Así evitamos mantener la transacción abierta mientras se escriben imágenes
      // y, si algo falla, podemos limpiar los archivos antes de informar el error.
      if (data.imageData) {
        imagePath = this.images.saveDataUrl(data.imageData)
      }

      const preparedVariants = []
      const seenVariants = new Set()
      const seenBarcodes = new Set()

      if (Array.isArray(data.variants) && data.variants.length) {
        for (const v of data.variants) {
          const normalizedVariant = this._validateVariant(v)
          const size = normalizedVariant.size
          const color = normalizedVariant.color
          const variantKey = `${size.toLocaleLowerCase()}::${color.toLocaleLowerCase()}`

          if (seenVariants.has(variantKey)) {
            throw new Error(`Talla y color duplicados: ${size} / ${color}`)
          }
          seenVariants.add(variantKey)

          const barcode = normalizedVariant.barcode
          if (barcode) {
            if (seenBarcodes.has(barcode)) {
              throw new Error(`El código de barras ${barcode} está repetido entre las variantes`)
            }
            seenBarcodes.add(barcode)
            const barcodeConflict = this.repo.findByBarcode(barcode)
            if (barcodeConflict) {
              throw new Error(`Ya existe un producto o variante con el código de barras "${barcode}"`)
            }
          }

          let variantImagePath = null
          if (v.imageData) {
            variantImagePath = this.images.saveDataUrl(v.imageData)
            variantImagePaths.push(variantImagePath)
          }
          preparedVariants.push({
            ...v,
            ...normalizedVariant,
            imagePath: variantImagePath
          })
        }
      }

      const id = this.repo.db.transaction(() => {
        const productId = this.repo.create({ ...data, ...normalizedProduct, sku, imagePath })

        for (const v of preparedVariants) {
          this._createVariantInternal(productId, sku, v)
        }

        this._audit('create_product', 'product', productId, {
          sku,
          name: data.name,
          variantCount: preparedVariants.length,
          variantsWithImages: preparedVariants.filter(v => Boolean(v.imagePath)).length
        })
        return productId
      })

      // La creación del producto puede ejecutarse correctamente en SQLite
      // aunque el renderer necesite una respuesta explícita para cerrar el
      // formulario y limpiar su estado. Sin este retorno, el frontend recibe
      // undefined y el usuario puede intentar guardar de nuevo el mismo SKU,
      // provocando el mensaje de SKU duplicado aunque el producto ya exista.
      return { ok: true, id }
    } catch (error) {
      if (imagePath) this.images.delete(imagePath)
      for (const path of variantImagePaths) this.images.delete(path)
      throw error
    }
  }

  updateProduct(id, data) {
    const existing = this.repo.findById(id)
    if (!existing) return { ok: false, error: 'Producto no encontrado' }

    const normalizedProduct = this._validateProduct(data)

    if (data.sku !== existing.sku) {
      const dup = this.repo.findBySku(data.sku)
      if (dup && dup.id !== id) {
        return { ok: false, error: `Ya existe otro producto con el SKU "${data.sku}"` }
      }
    }

    let newImagePath = existing.image_path || null
    let createdNewImage = false

    try {
      if (data.removeImage) {
        newImagePath = null
      }

      if (data.imageData) {
        newImagePath = this.images.saveDataUrl(data.imageData)
        createdNewImage = true
      }

      this.repo.db.transaction(() => {
        this.repo.update(id, { ...data, ...normalizedProduct, imagePath: newImagePath })
        this._audit('update_product', 'product', id, {
          sku: data.sku,
          imageChanged: Boolean(data.imageData || data.removeImage)
        })
      })

      if (createdNewImage && existing.image_path) {
        this.images.delete(existing.image_path)
      } else if (data.removeImage && existing.image_path) {
        this.images.delete(existing.image_path)
      }

      return { ok: true }
    } catch (error) {
      if (createdNewImage && newImagePath) this.images.delete(newImagePath)
      throw error
    }
  }

  deleteProduct(id) {
    const existing = this.repo.findById(id)
    if (!existing) return { ok: false, error: 'Producto no encontrado' }

    this.repo.db.transaction(() => {
      this.repo.softDelete(id)
      this._audit('delete_product', 'product', id, { sku: existing.sku, imageDeleted: Boolean(existing.image_path) })
    })
    if (existing.image_path) this.images.delete(existing.image_path)
    return { ok: true }
  }

  searchByBarcode(barcode) {
    const result = this.repo.findByBarcode(barcode)
    if (!result) return { ok: false, error: 'Código no encontrado' }
    return { ok: true, data: result }
  }

  // ─── Variantes ────────────────────────────────────────────

  getVariants(productId) {
    return { ok: true, data: this.repo.findVariantsByProduct(productId) }
  }

  createVariant(data = {}) {
    const normalizedVariant = this._validateVariant(data)
    const product = this.repo.findById(data.productId)
    if (!product) return { ok: false, error: 'Producto no encontrado' }

    if (!data.size || !data.color) {
      return { ok: false, error: 'Talla y color son obligatorios' }
    }

    const dup = product.variants?.find(
      v => v.size === data.size && v.color === data.color
    )
    if (dup) {
      return { ok: false, error: `Ya existe la variante ${data.size} / ${data.color}` }
    }

    let imagePath = null
    try {
      if (data.imageData) imagePath = this.images.saveDataUrl(data.imageData)

      const variantId = this.repo.db.transaction(() => {
        const createdId = this._createVariantInternal(data.productId, product.sku, { ...data, ...normalizedVariant, imagePath })
        this._audit('create_variant', 'product_variant', createdId, { skuVariant: data.skuVariant, size: data.size, color: data.color, imageChanged: Boolean(imagePath) })
        return createdId
      })
      return { ok: true, id: variantId }
    } catch (error) {
      if (imagePath) this.images.delete(imagePath)
      throw error
    }
  }

  updateVariant(id, data) {
    const variant = this.repo.findVariantById(id)
    if (!variant) return { ok: false, error: 'Variante no encontrada' }

    // La edición debe validarse igual que la creación: de lo contrario
    // es posible guardar una variante con talla/color vacíos o un
    // precio inválido, generando datos inconsistentes en inventario y ventas.
    const normalizedVariant = this._validateVariant({ ...variant, ...data })

    const dupSizeColor = data.size && data.color
      ? this.repo.findVariantsByProduct(variant.product_id)
          .find(v => v.id !== id && v.size === data.size && v.color === data.color)
      : null
    if (dupSizeColor) {
      return { ok: false, error: `Ya existe la variante ${data.size} / ${data.color}` }
    }

    let newImagePath = variant.image_path || null
    let createdNewImage = false

    try {
      if (data.removeImage) newImagePath = null
      if (data.imageData) {
        newImagePath = this.images.saveDataUrl(data.imageData)
        createdNewImage = true
      }

      this.repo.db.transaction(() => {
        this.repo.updateVariant(id, { ...data, ...normalizedVariant, imagePath: newImagePath })
        this._audit('update_variant', 'product_variant', id, { size: data.size, color: data.color, imageChanged: Boolean(data.imageData || data.removeImage) })
      })

      if (variant.image_path && (createdNewImage || data.removeImage)) {
        this.images.delete(variant.image_path)
      }

      return { ok: true }
    } catch (error) {
      if (createdNewImage && newImagePath) this.images.delete(newImagePath)
      throw error
    }
  }

  deleteVariant(id) {
    const variant = this.repo.findVariantById(id)
    if (!variant) return { ok: false, error: 'Variante no encontrada' }

    this.repo.db.transaction(() => {
      this.repo.softDeleteVariant(id)
      this._audit('delete_variant', 'product_variant', id, {})
    })
    if (variant.image_path) this.images.delete(variant.image_path)
    return { ok: true }
  }

  adjustStock({ variantId, type, qty, reference, notes } = {}) {
    const variant = this.repo.findVariantById(variantId)
    if (!variant) return { ok: false, error: 'Variante no encontrada' }

    if (!['entrada', 'salida', 'ajuste'].includes(type)) {
      return { ok: false, error: 'Tipo de movimiento inválido' }
    }

    const numericQty = Number(qty)
    if (!Number.isInteger(numericQty) || numericQty < 0) {
      return { ok: false, error: 'La cantidad debe ser un entero no negativo' }
    }

    const stockBefore = variant.stock
    let stockAfter

    if (type === 'entrada') {
      stockAfter = stockBefore + numericQty
    } else if (type === 'salida') {
      stockAfter = stockBefore - numericQty
      if (stockAfter < 0) return { ok: false, error: 'El stock no puede quedar negativo' }
    } else {
      stockAfter = numericQty
      if (stockAfter < 0) return { ok: false, error: 'El stock no puede ser negativo' }
    }

    const userId = this.auth.getSession()?.id
    this.repo.db.transaction(() => {
      this.repo.setVariantStock(variantId, stockAfter)
      this.repo.recordMovement({
        variantId,
        userId,
        type,
        qty: stockAfter - stockBefore,
        stockBefore,
        stockAfter,
        reference,
        notes
      })
      this._audit('adjust_stock', 'product_variant', variantId, { type, qty, stockBefore, stockAfter })
    })
    return { ok: true, stockBefore, stockAfter }
  }

  getMovements(variantId) {
    return { ok: true, data: this.repo.getMovements(variantId) }
  }

  getLowStock() {
    return { ok: true, data: this.repo.getLowStockVariants() }
  }

  getStats() {
    return { ok: true, data: this.repo.getStats() }
  }

  // ─── Catálogos ────────────────────────────────────────────

  getCategories() { return { ok: true, data: this.repo.getCategories() } }
  getBrands()     { return { ok: true, data: this.repo.getBrands() } }
  getSuppliers()  { return { ok: true, data: this.repo.getSuppliers() } }

  createCategory(name) {
    if (!name?.trim()) return { ok: false, error: 'Nombre requerido' }
    const id = this.repo.createCategory(name.trim())
    return { ok: true, id }
  }

  createBrand(name) {
    if (!name?.trim()) return { ok: false, error: 'Nombre requerido' }
    const id = this.repo.createBrand(name.trim())
    return { ok: true, id }
  }

  // ─── Helpers privados ────────────────────────────────────────

  _createVariantInternal(productId, productSku, v) {
    const skuVariant = v.skuVariant ||
      `${productSku}-${v.size}-${v.color}`.replace(/\s+/g, '-').toUpperCase()

    return this.repo.createVariant({
      productId,
      skuVariant,
      size: v.size,
      color: v.color,
      stock: v.stock || 0,
      priceOverride: v.priceOverride,
      barcode: v.barcode,
      imagePath: v.imagePath || null
    })
  }

  _validateProduct(data = {}) {
    const name = String(data.name ?? '').trim()
    const sku = String(data.sku ?? '').trim()
    if (!name) throw new Error('El nombre del producto es obligatorio')
    if (!sku) throw new Error('El SKU es obligatorio')
    if (sku.length > 100) throw new Error('El SKU es demasiado largo')
    if (name.length > 200) throw new Error('El nombre del producto es demasiado largo')

    const salePrice = cop(data.salePrice ?? 0, 'El precio de venta')
    const costPrice = cop(data.costPrice ?? 0, 'El precio de costo')

    return { name, sku, salePrice, costPrice }
  }

  _validateVariant(data = {}) {
    const size = String(data.size ?? '').trim()
    const color = String(data.color ?? '').trim()
    if (!size || !color) throw new Error('Talla y color son obligatorios')
    if (size.length > 50 || color.length > 80) throw new Error('La talla o el color son demasiado largos')

    const barcode = data.barcode == null ? null : String(data.barcode).trim()
    if (barcode && !/^[0-9]+$/.test(barcode)) {
      throw new Error('El código de barras solo puede contener números')
    }

    const stock = Number(data.stock ?? 0)
    if (!Number.isSafeInteger(stock) || stock < 0) {
      throw new Error('El stock debe ser un entero no negativo')
    }

    let priceOverride = data.priceOverride
    if (priceOverride != null && priceOverride !== '') {
      try {
        priceOverride = cop(priceOverride, 'Precio de la variante')
      } catch {
        throw new Error('El precio de la variante no es válido')
      }
    } else {
      priceOverride = null
    }

    return { size, color, stock, priceOverride, barcode: barcode || null }
  }

  _audit(action, entity, entityId, details) {
    const userId = this.auth.getSession()?.id
    this.auth.audit.log(userId, action, entity, entityId, details)
  }
}

module.exports = ProductService
