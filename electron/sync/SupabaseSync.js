// electron/sync/SupabaseSync.js
//
// Respaldo de un solo sentido: local (SQLite) → nube (Supabase).
// Nunca al revés. Si algo falla (sin internet, credenciales mal puestas,
// Supabase caído), simplemente no sincroniza esta vez y la app sigue
// funcionando normal — nunca bloquea una venta ni ninguna operación local.
//
// Cuando un producto o variante se queda en stock 0, no se borra la fila
// en Supabase (eso rompería el historial de ventas/reportes a futuro),
// solo se borra su imagen del almacenamiento en la nube para liberar
// espacio, y el campo image_url queda en null.

const fs = require('fs')
const path = require('path')

const BUCKET = 'product-images'

// Electron empaqueta una versión de Node que no trae WebSocket nativo
// (eso solo es estándar desde Node 22+). El cliente de Supabase lo busca
// al crearse (para su parte de "tiempo real", que aquí no usamos) y, si
// no lo encuentra, falla toda la sincronización con un error que no tiene
// nada que ver con las credenciales. Se completa con el paquete "ws".
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws')
}

class SupabaseSync {
  constructor(db, app, productImageService) {
    this.db = db
    this.app = app
    this.images = productImageService
    this.client = null
    this.lastResult = null
  }

  _getClient(settings) {
    const url = settings.supabase_url
    const key = settings.supabase_anon_key
    if (!url || !key) return null

    // Se crea una vez por sincronización (las credenciales pueden cambiar
    // entre una corrida y otra si el usuario las edita en Ajustes).
    const { createClient } = require('@supabase/supabase-js')
    return createClient(url, key, { auth: { persistSession: false } })
  }

  async runSync(settingsService) {
    const settings = settingsService.getAll()

    if (settings.sync_enabled !== '1') {
      return { ok: false, skipped: true, reason: 'Sincronización desactivada en Ajustes' }
    }

    const client = this._getClient(settings)
    if (!client) {
      return { ok: false, skipped: true, reason: 'Faltan la URL o la llave de Supabase en Ajustes' }
    }

    const result = { ok: true, products: 0, variants: 0, sales: 0, imagesDeleted: 0, errors: [] }

    try {
      result.products = await this._syncProducts(client)
      result.variants = await this._syncVariants(client)
      result.sales = await this._syncSales(client)
    } catch (error) {
      // Un fallo de red o de credenciales no debe tumbar la app: se informa
      // y se reintenta en la próxima corrida (nada quedó marcado como
      // sincronizado si no se confirmó la subida).
      result.ok = false
      result.errors.push(error.message)
    }

    this.lastResult = { ...result, at: new Date().toISOString() }
    return this.lastResult
  }

  // ─── Productos ──────────────────────────────────────────────

  async _syncProducts(client) {
    const pending = this.db.all(`
      SELECT p.*, COALESCE(SUM(v.stock), 0) AS total_stock
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE p.synced_at IS NULL OR p.synced_at < p.updated_at
      GROUP BY p.id
    `)

    let count = 0
    for (const p of pending) {
      let imageUrl = null

      if (p.total_stock <= 0) {
        // Sin existencias: se libera el espacio de la imagen en la nube.
        if (p.image_path) await this._deleteImage(client, p.image_path)
        imageUrl = null
      } else if (p.image_path) {
        imageUrl = await this._uploadImage(client, p.image_path)
      }

      const { error } = await client.from('products').upsert({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        category_name: this._categoryName(p.category_id),
        brand_name: this._brandName(p.brand_id),
        cost_price: p.cost_price,
        sale_price: p.sale_price,
        image_url: imageUrl,
        is_active: !!p.is_active,
        updated_at: p.updated_at,
      })
      if (error) throw new Error(`products: ${error.message}`)

      this.db.run(`UPDATE products SET synced_at = datetime('now') WHERE id = ?`, [p.id])
      count++
    }
    return count
  }

  // ─── Variantes ──────────────────────────────────────────────

  async _syncVariants(client) {
    const pending = this.db.all(`
      SELECT * FROM product_variants
      WHERE synced_at IS NULL OR synced_at < updated_at
    `)

    let count = 0
    for (const v of pending) {
      let imageUrl = null

      if (v.stock <= 0) {
        if (v.image_path) await this._deleteImage(client, v.image_path)
        imageUrl = null
      } else if (v.image_path) {
        imageUrl = await this._uploadImage(client, v.image_path)
      }

      const { error } = await client.from('product_variants').upsert({
        id: v.id,
        product_id: v.product_id,
        sku_variant: v.sku_variant,
        size: v.size,
        color: v.color,
        stock: v.stock,
        price_override: v.price_override,
        barcode: v.barcode,
        image_url: imageUrl,
        is_active: !!v.is_active,
        updated_at: v.updated_at,
      })
      if (error) throw new Error(`product_variants: ${error.message}`)

      this.db.run(`UPDATE product_variants SET synced_at = datetime('now') WHERE id = ?`, [v.id])
      count++
    }
    return count
  }

  // ─── Ventas ─────────────────────────────────────────────────

  async _syncSales(client) {
    const pending = this.db.all(`
      SELECT * FROM sales WHERE synced_at IS NULL
    `)

    let count = 0
    for (const s of pending) {
      const { error } = await client.from('sales').upsert({
        id: s.id,
        invoice_number: s.invoice_number,
        customer_id: s.customer_id,
        subtotal: s.subtotal,
        tax_amt: s.tax_amt,
        total: s.total,
        status: s.status,
        financing_method: s.financing_method,
        financing_total: s.financing_total,
        created_at: s.created_at,
        cancelled_at: s.cancelled_at,
        cancel_reason: s.cancel_reason,
      })
      if (error) throw new Error(`sales: ${error.message}`)

      const items = this.db.all('SELECT * FROM sale_items WHERE sale_id = ?', [s.id])
      if (items.length) {
        const { error: itemsError } = await client.from('sale_items').upsert(
          items.map(i => ({
            id: i.id, sale_id: i.sale_id, variant_id: i.variant_id,
            product_name: i.product_name, size: i.size, color: i.color,
            qty: i.qty, unit_price: i.unit_price, discount_pct: i.discount_pct,
            line_total: i.line_total,
          }))
        )
        if (itemsError) throw new Error(`sale_items: ${itemsError.message}`)
      }

      const payments = this.db.all('SELECT * FROM payments WHERE sale_id = ?', [s.id])
      if (payments.length) {
        const { error: paysError } = await client.from('payments').upsert(
          payments.map(pay => ({
            id: pay.id, sale_id: pay.sale_id, method: pay.method,
            amount: pay.amount, reference: pay.reference, created_at: pay.created_at,
          }))
        )
        if (paysError) throw new Error(`payments: ${paysError.message}`)
      }

      // Una venta nunca se vuelve a sincronizar (no cambia una vez creada,
      // salvo cancelación, que ya actualiza synced_at a NULL abajo).
      this.db.run(`UPDATE sales SET synced_at = datetime('now') WHERE id = ?`, [s.id])
      count++
    }
    return count
  }

  // ─── Imágenes ───────────────────────────────────────────────

  async _uploadImage(client, relativePath) {
    const absolutePath = this.images.getAbsolutePath(relativePath)
    if (!absolutePath || !fs.existsSync(absolutePath)) return null

    const buffer = fs.readFileSync(absolutePath)
    const { error } = await client.storage.from(BUCKET).upload(relativePath, buffer, {
      contentType: 'image/webp',
      upsert: true,
    })
    if (error) throw new Error(`storage upload: ${error.message}`)

    const { data } = client.storage.from(BUCKET).getPublicUrl(relativePath)
    return data?.publicUrl || null
  }

  async _deleteImage(client, relativePath) {
    const { error } = await client.storage.from(BUCKET).remove([relativePath])
    // Si ya no existía en la nube, no es un error real — puede pasar si
    // nunca se llegó a subir, o si ya se había borrado antes.
    if (error && !/not.?found/i.test(error.message || '')) {
      throw new Error(`storage delete: ${error.message}`)
    }
  }

  // ─── Auxiliares ─────────────────────────────────────────────

  _categoryName(categoryId) {
    if (!categoryId) return null
    return this.db.get('SELECT name FROM categories WHERE id = ?', [categoryId])?.name || null
  }

  _brandName(brandId) {
    if (!brandId) return null
    return this.db.get('SELECT name FROM brands WHERE id = ?', [brandId])?.name || null
  }
}

module.exports = SupabaseSync
