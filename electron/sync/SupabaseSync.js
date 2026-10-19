// electron/sync/SupabaseSync.js
//
// Respaldo de un solo sentido: local (SQLite) → nube (Supabase).
// Nunca al revés, EXCEPTO por restoreFromCloud(), que es la única vía de
// vuelta y solo está permitida sobre una instalación nueva y vacía (ver
// más abajo) — es para recuperación de emergencia en un computador nuevo,
// no para mantener dos dispositivos sincronizados al mismo tiempo.
//
// Cuando un producto o variante se queda en stock 0, no se borra la fila
// en Supabase (eso rompería el historial de ventas/reportes a futuro),
// solo se borra su imagen del almacenamiento en la nube para liberar
// espacio, y el campo image_url queda en null.
//
// Lo que SÍ se respalda: productos, variantes, ventas (+ items + pagos),
// clientes, créditos internos (+ sus abonos), y caja (aperturas/cierres +
// gastos + ingresos de caja). Lo que NO se respalda: usuarios/contraseñas
// (un computador nuevo crea su propio administrador), auditoría, y el
// detalle fino de movimientos de inventario.

const fs = require('fs')
const path = require('path')

const BUCKET = 'product-images'
const PAGE_SIZE = 1000

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
    this.lastResult = null
    this.lastRestoreResult = null
  }

  _getClient(settings) {
    const url = settings.supabase_url
    const key = settings.supabase_anon_key
    if (!url || !key) return null

    const { createClient } = require('@supabase/supabase-js')
    return createClient(url, key, { auth: { persistSession: false } })
  }

  // ════════════════════════════════════════════════════════════
  // SUBIDA (local → nube)
  // ════════════════════════════════════════════════════════════

  async runSync(settingsService) {
    const settings = settingsService.getAll()

    if (settings.sync_enabled !== '1') {
      return { ok: false, skipped: true, reason: 'Sincronización desactivada en Ajustes' }
    }

    const client = this._getClient(settings)
    if (!client) {
      return { ok: false, skipped: true, reason: 'Faltan la URL o la llave de Supabase en Ajustes' }
    }

    const result = {
      ok: true, products: 0, variants: 0, sales: 0,
      customers: 0, cashRegisters: 0, credits: 0, creditPayments: 0,
      cashExpenses: 0, cashIncome: 0, errors: [],
    }

    try {
      // Orden importante: las tablas "padre" van antes que las que las
      // referencian (clientes y caja antes que ventas, etc.).
      result.customers     = await this._syncCustomers(client)
      result.cashRegisters = await this._syncCashRegisters(client)
      result.products      = await this._syncProducts(client)
      result.variants      = await this._syncVariants(client)
      result.sales         = await this._syncSales(client)
      result.credits       = await this._syncCredits(client)
      result.creditPayments = await this._syncCreditPayments(client)
      result.cashExpenses  = await this._syncCashExpenses(client)
      result.cashIncome    = await this._syncCashIncome(client)
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

  // ─── Clientes ───────────────────────────────────────────────

  async _syncCustomers(client) {
    const pending = this.db.all(`
      SELECT * FROM customers WHERE synced_at IS NULL OR synced_at < updated_at
    `)
    for (const c of pending) {
      const { error } = await client.from('customers').upsert({
        id: c.id, name: c.name, document: c.document, phone: c.phone,
        email: c.email, address: c.address, notes: c.notes,
        is_active: !!c.is_active, updated_at: c.updated_at,
      })
      if (error) throw new Error(`customers: ${error.message}`)
      this.db.run(`UPDATE customers SET synced_at = datetime('now') WHERE id = ?`, [c.id])
    }
    return pending.length
  }

  // ─── Caja ───────────────────────────────────────────────────

  async _syncCashRegisters(client) {
    const pending = this.db.all(`
      SELECT * FROM cash_registers WHERE synced_at IS NULL
    `)
    for (const r of pending) {
      const { error } = await client.from('cash_registers').upsert({
        id: r.id, opening_amount: r.opening_amount, opened_at: r.opened_at,
        closed_at: r.closed_at, status: r.status, closing_amount: r.closing_amount,
        expected_amount: r.expected_amount, difference: r.difference,
        total_sales: r.total_sales, total_expenses: r.total_expenses,
        cash_sales: r.cash_sales, transfer_sales: r.transfer_sales,
        credit_sales: r.credit_sales, sistecredito_sales: r.sistecredito_sales,
        credit_collection_cash: r.credit_collection_cash,
        credit_collection_transfer: r.credit_collection_transfer,
        total_credit_collections: r.total_credit_collections, notes: r.notes,
      })
      if (error) throw new Error(`cash_registers: ${error.message}`)
      this.db.run(`UPDATE cash_registers SET synced_at = datetime('now') WHERE id = ?`, [r.id])
    }
    return pending.length
  }

  async _syncCashExpenses(client) {
    const pending = this.db.all(`SELECT * FROM cash_expenses WHERE synced_at IS NULL`)
    for (const e of pending) {
      const { error } = await client.from('cash_expenses').upsert({
        id: e.id, cash_register_id: e.cash_register_id, description: e.description,
        category: e.category, amount: e.amount, observation: e.observation,
        created_at: e.created_at,
      })
      if (error) throw new Error(`cash_expenses: ${error.message}`)
      this.db.run(`UPDATE cash_expenses SET synced_at = datetime('now') WHERE id = ?`, [e.id])
    }
    return pending.length
  }

  async _syncCashIncome(client) {
    const pending = this.db.all(`SELECT * FROM cash_income WHERE synced_at IS NULL`)
    for (const inc of pending) {
      const { error } = await client.from('cash_income').upsert({
        id: inc.id, cash_register_id: inc.cash_register_id, source: inc.source,
        reference_id: inc.reference_id, description: inc.description,
        amount: inc.amount, payment_method: inc.payment_method, created_at: inc.created_at,
      })
      if (error) throw new Error(`cash_income: ${error.message}`)
      this.db.run(`UPDATE cash_income SET synced_at = datetime('now') WHERE id = ?`, [inc.id])
    }
    return pending.length
  }

  // ─── Créditos internos (fiado) ──────────────────────────────

  async _syncCredits(client) {
    const pending = this.db.all(`
      SELECT * FROM credits WHERE synced_at IS NULL OR synced_at < updated_at
    `)
    for (const c of pending) {
      const { error } = await client.from('credits').upsert({
        id: c.id, customer_id: c.customer_id, sale_id: c.sale_id,
        total_amount: c.total_amount, installment_count: c.installment_count,
        installment_amount: c.installment_amount, paid_amount: c.paid_amount,
        balance: c.balance, status: c.status, created_at: c.created_at,
        updated_at: c.updated_at,
      })
      if (error) throw new Error(`credits: ${error.message}`)
      this.db.run(`UPDATE credits SET synced_at = datetime('now') WHERE id = ?`, [c.id])
    }
    return pending.length
  }

  async _syncCreditPayments(client) {
    const pending = this.db.all(`SELECT * FROM credit_payments WHERE synced_at IS NULL`)
    for (const p of pending) {
      const { error } = await client.from('credit_payments').upsert({
        id: p.id, credit_id: p.credit_id, amount: p.amount, notes: p.notes,
        payment_method: p.payment_method, created_at: p.created_at,
      })
      if (error) throw new Error(`credit_payments: ${error.message}`)
      this.db.run(`UPDATE credit_payments SET synced_at = datetime('now') WHERE id = ?`, [p.id])
    }
    return pending.length
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
    }
    return pending.length
  }

  // ─── Variantes ──────────────────────────────────────────────

  async _syncVariants(client) {
    const pending = this.db.all(`
      SELECT * FROM product_variants
      WHERE synced_at IS NULL OR synced_at < updated_at
    `)

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
    }
    return pending.length
  }

  // ─── Ventas ─────────────────────────────────────────────────

  async _syncSales(client) {
    const pending = this.db.all(`SELECT * FROM sales WHERE synced_at IS NULL`)

    for (const s of pending) {
      const { error } = await client.from('sales').upsert({
        id: s.id,
        invoice_number: s.invoice_number,
        cash_register_id: s.cash_register_id,
        customer_id: s.customer_id,
        subtotal: s.subtotal,
        tax_amt: s.tax_amt,
        total: s.total,
        status: s.status,
        financing_method: s.financing_method,
        financing_total: s.financing_total,
        installment_count: s.installment_count,
        installment_amount: s.installment_amount,
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
      // salvo cancelación, que ya actualiza synced_at a NULL aparte).
      this.db.run(`UPDATE sales SET synced_at = datetime('now') WHERE id = ?`, [s.id])
    }
    return pending.length
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
    if (error && !/not.?found/i.test(error.message || '')) {
      throw new Error(`storage delete: ${error.message}`)
    }
  }

  _relativePathFromUrl(url) {
    if (!url) return null
    const marker = `/object/public/${BUCKET}/`
    const idx = url.indexOf(marker)
    if (idx === -1) return null
    return decodeURIComponent(url.slice(idx + marker.length))
  }

  async _downloadImage(client, relativePath) {
    const { data, error } = await client.storage.from(BUCKET).download(relativePath)
    if (error) throw new Error(`storage download ${relativePath}: ${error.message}`)
    const buffer = Buffer.from(await data.arrayBuffer())
    const absolutePath = this.images.getAbsolutePath(relativePath)
    if (!absolutePath) return
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, buffer)
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

  // ════════════════════════════════════════════════════════════
  // RESTAURACIÓN DE EMERGENCIA (nube → local)
  // ════════════════════════════════════════════════════════════
  // Solo pensada para un computador NUEVO con la base de datos recién
  // creada (sin productos todavía) — por ejemplo porque el computador de
  // la tienda se dañó. No es para mantener dos dispositivos al día: si ya
  // hay datos locales, se rechaza para no mezclar ni duplicar nada.
  // No restaura usuarios/contraseñas (el computador nuevo crea su propio
  // administrador), auditoría, ni movimientos finos de inventario.

  async restoreFromCloud(settingsService) {
    const settings = settingsService.getAll()
    const client = this._getClient(settings)
    if (!client) {
      return { ok: false, error: 'Faltan la URL o la llave de Supabase en Ajustes' }
    }

    const localProducts = this.db.get('SELECT COUNT(*) AS n FROM products').n
    if (localProducts > 0) {
      return {
        ok: false,
        error: 'Ya hay productos guardados en este computador. La restauración solo está permitida sobre una instalación nueva y vacía, para no mezclar ni duplicar información.',
      }
    }

    try {
      // 1) Bajar todo de Supabase y descargar las imágenes ANTES de tocar
      // la base de datos local — si algo falla aquí, no se modificó nada.
      const data = {
        customers:      await this._fetchAll(client, 'customers'),
        cashRegisters:  await this._fetchAll(client, 'cash_registers'),
        products:       await this._fetchAll(client, 'products'),
        variants:       await this._fetchAll(client, 'product_variants'),
        sales:          await this._fetchAll(client, 'sales'),
        saleItems:      await this._fetchAll(client, 'sale_items'),
        payments:       await this._fetchAll(client, 'payments'),
        credits:        await this._fetchAll(client, 'credits'),
        creditPayments: await this._fetchAll(client, 'credit_payments'),
        cashExpenses:   await this._fetchAll(client, 'cash_expenses'),
        cashIncome:     await this._fetchAll(client, 'cash_income'),
      }

      for (const p of data.products) {
        const rel = this._relativePathFromUrl(p.image_url)
        if (rel) await this._downloadImage(client, rel)
      }
      for (const v of data.variants) {
        const rel = this._relativePathFromUrl(v.image_url)
        if (rel) await this._downloadImage(client, rel)
      }

      // 2) Insertar todo en una sola transacción local: o queda completo,
      // o no queda nada (si algo falla a mitad de camino, se revierte).
      const counts = this._insertRestoredData(data)

      this.lastRestoreResult = { ok: true, counts, at: new Date().toISOString() }
      return this.lastRestoreResult
    } catch (error) {
      this.lastRestoreResult = { ok: false, error: error.message, at: new Date().toISOString() }
      return this.lastRestoreResult
    }
  }

  async _fetchAll(client, table) {
    const rows = []
    let from = 0
    while (true) {
      const { data, error } = await client.from(table).select('*').range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`descargando ${table}: ${error.message}`)
      if (!data || !data.length) break
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    return rows
  }

  _insertRestoredData(data) {
    const counts = {}
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

    this.db.transaction(() => {
      for (const c of data.customers) {
        this.db.run(
          `INSERT INTO customers (id,name,document,phone,email,address,notes,is_active,created_at,updated_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [c.id, c.name, c.document, c.phone, c.email, c.address, c.notes,
           c.is_active ? 1 : 0, c.updated_at, c.updated_at, now]
        )
      }
      this._fixSequence('customers')

      for (const r of data.cashRegisters) {
        this.db.run(
          `INSERT INTO cash_registers (id,opening_amount,opened_at,closed_at,status,closing_amount,
            expected_amount,difference,total_sales,total_expenses,cash_sales,transfer_sales,
            credit_sales,sistecredito_sales,credit_collection_cash,credit_collection_transfer,
            total_credit_collections,notes,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.opening_amount, r.opened_at, r.closed_at, r.status, r.closing_amount,
           r.expected_amount, r.difference, r.total_sales, r.total_expenses, r.cash_sales,
           r.transfer_sales, r.credit_sales, r.sistecredito_sales, r.credit_collection_cash,
           r.credit_collection_transfer, r.total_credit_collections, r.notes, now]
        )
      }
      this._fixSequence('cash_registers')

      for (const p of data.products) {
        const rel = this._relativePathFromUrl(p.image_url)
        this.db.run(
          `INSERT INTO products (id,name,sku,description,cost_price,sale_price,image_path,is_active,created_at,updated_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [p.id, p.name, p.sku, p.description, p.cost_price, p.sale_price, rel,
           p.is_active ? 1 : 0, p.updated_at, p.updated_at, now]
        )
      }
      this._fixSequence('products')

      for (const v of data.variants) {
        const rel = this._relativePathFromUrl(v.image_url)
        this.db.run(
          `INSERT INTO product_variants (id,product_id,sku_variant,size,color,stock,price_override,barcode,image_path,is_active,created_at,updated_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [v.id, v.product_id, v.sku_variant, v.size, v.color, v.stock, v.price_override,
           v.barcode, rel, v.is_active ? 1 : 0, v.updated_at, v.updated_at, now]
        )
      }
      this._fixSequence('product_variants')

      for (const s of data.sales) {
        this.db.run(
          `INSERT INTO sales (id,invoice_number,cash_register_id,customer_id,subtotal,tax_amt,total,
            status,created_at,cancelled_at,cancel_reason,financing_method,financing_total,
            installment_count,installment_amount,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [s.id, s.invoice_number, s.cash_register_id, s.customer_id, s.subtotal, s.tax_amt,
           s.total, s.status, s.created_at, s.cancelled_at, s.cancel_reason, s.financing_method,
           s.financing_total, s.installment_count || 1, s.installment_amount || 0, now]
        )
      }
      this._fixSequence('sales')

      for (const i of data.saleItems) {
        this.db.run(
          `INSERT INTO sale_items (id,sale_id,variant_id,product_name,size,color,qty,unit_price,discount_pct,line_total)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [i.id, i.sale_id, i.variant_id, i.product_name, i.size, i.color, i.qty,
           i.unit_price, i.discount_pct, i.line_total]
        )
      }
      this._fixSequence('sale_items')

      for (const pay of data.payments) {
        this.db.run(
          `INSERT INTO payments (id,sale_id,method,amount,reference,created_at)
           VALUES (?,?,?,?,?,?)`,
          [pay.id, pay.sale_id, pay.method, pay.amount, pay.reference, pay.created_at]
        )
      }
      this._fixSequence('payments')

      for (const c of data.credits) {
        this.db.run(
          `INSERT INTO credits (id,customer_id,sale_id,total_amount,installment_count,installment_amount,
            paid_amount,balance,status,created_at,updated_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [c.id, c.customer_id, c.sale_id, c.total_amount, c.installment_count,
           c.installment_amount, c.paid_amount, c.balance, c.status, c.created_at, c.updated_at, now]
        )
      }
      this._fixSequence('credits')

      for (const cp of data.creditPayments) {
        this.db.run(
          `INSERT INTO credit_payments (id,credit_id,amount,notes,payment_method,created_at,synced_at)
           VALUES (?,?,?,?,?,?,?)`,
          [cp.id, cp.credit_id, cp.amount, cp.notes, cp.payment_method, cp.created_at, now]
        )
      }
      this._fixSequence('credit_payments')

      for (const e of data.cashExpenses) {
        this.db.run(
          `INSERT INTO cash_expenses (id,cash_register_id,description,category,amount,observation,created_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [e.id, e.cash_register_id, e.description, e.category, e.amount, e.observation, e.created_at, now]
        )
      }
      this._fixSequence('cash_expenses')

      for (const inc of data.cashIncome) {
        this.db.run(
          `INSERT INTO cash_income (id,cash_register_id,source,reference_id,description,amount,payment_method,created_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [inc.id, inc.cash_register_id, inc.source, inc.reference_id, inc.description,
           inc.amount, inc.payment_method, inc.created_at, now]
        )
      }
      this._fixSequence('cash_income')

      counts.customers = data.customers.length
      counts.cashRegisters = data.cashRegisters.length
      counts.products = data.products.length
      counts.variants = data.variants.length
      counts.sales = data.sales.length
      counts.credits = data.credits.length
    })

    return counts
  }

  // Después de insertar filas con IDs explícitos, SQLite no actualiza
  // solo su contador interno de AUTOINCREMENT — hay que corregirlo para
  // que la próxima fila creada desde la app no choque con una restaurada.
  _fixSequence(table) {
    this.db.run(
      `INSERT INTO sqlite_sequence (name, seq)
       SELECT ?, (SELECT COALESCE(MAX(id),0) FROM ${table})
       WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)`,
      [table, table]
    )
    this.db.run(
      `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id),0) FROM ${table}) WHERE name = ?`,
      [table]
    )
  }
}

module.exports = SupabaseSync
