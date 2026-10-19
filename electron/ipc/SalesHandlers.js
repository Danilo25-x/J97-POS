// electron/ipc/SalesHandlers.js

const { shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const { cop } = require('../lib/validation')

function registerSalesHandlers(ipcMain, db, authService) {

  // ── Crear venta (transacción atómica completa) ─────────────
  ipcMain.handle('sales:createSale', async (_, payload) => {
    try {
      authService.requirePermission('sales')
      const { items, payments: paymentsData, notes, customerId, installments = 1 } = payload || {}

      if (!items || items.length === 0)
        return { ok: false, error: 'El carrito está vacío' }

      const caja = db.get(`SELECT id FROM cash_registers WHERE status='open' LIMIT 1`)
      if (!caja) return { ok: false, error: 'Debes abrir la caja antes de vender' }

      const userId = authService.getSession()?.id
      if (!userId) return { ok: false, error: 'Sesión inválida' }

      // ── Generar número de factura ─────────────────────────
      const prefix  = db.get(`SELECT value FROM settings WHERE key='invoice_prefix'`)?.value || 'J97'
      const nextNum = parseInt(db.get(`SELECT value FROM settings WHERE key='invoice_next'`)?.value || '1', 10)
      const invoice = `${prefix}-${String(nextNum).padStart(6, '0')}`

      // ── Validar y calcular totales (backend es la fuente de verdad) ──
      const taxRate = parseFloat(db.get(`SELECT value FROM settings WHERE key='tax_rate'`)?.value || '0')
      let subtotal  = 0
      const lineItems = []

      for (const item of items) {
        const qty = Number(item.qty)
        if (!Number.isInteger(qty) || qty < 1)
          return { ok: false, error: 'Cantidad de venta inválida' }

        const variant = db.get(
          `SELECT pv.*, p.name AS product_name, p.sale_price AS base_price, p.sku AS product_sku, COALESCE(pv.image_path, p.image_path) AS display_image_path, p.image_path
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
           WHERE pv.id = ? AND pv.is_active = 1 AND p.is_active = 1`,
          [item.variantId]
        )
        if (!variant)
          return { ok: false, error: `Producto no encontrado (variante ${item.variantId})` }
        if (variant.stock < qty)
          return { ok: false, error: `Stock insuficiente: ${variant.product_name} ${variant.size}/${variant.color} — disponible: ${variant.stock}` }

        const unitPrice = variant.price_override ?? variant.base_price
        const rawDiscount = Number(item.discountPct ?? 0)
        if (!Number.isFinite(rawDiscount) || rawDiscount < 0 || rawDiscount > 100) return { ok: false, error: 'Descuento inválido' }
        const discPct   = rawDiscount
        const lineTotal = Math.round(unitPrice * qty * (1 - discPct / 100))
        subtotal += lineTotal
        lineItems.push({ variant, unitPrice, qty, discPct, lineTotal })
      }

      const taxAmt = Math.round(subtotal * (taxRate / 100))
      const total  = subtotal + taxAmt

      // ── Validar pagos ─────────────────────────────────────
      if (!paymentsData || paymentsData.length === 0)
        return { ok: false, error: 'Debe seleccionar un método de pago' }
      if (paymentsData.length !== 1)
        return { ok: false, error: 'La venta debe tener un único método de pago' }

      const validMethods = ['efectivo', 'transferencia', 'credito', 'sistecredito']
      for (const p of paymentsData) {
        if (!validMethods.includes(p.method))
          return { ok: false, error: `Método de pago inválido: ${p.method}` }
        let amount
        try {
          amount = cop(p.amount, 'Monto de pago')
        } catch {
          return { ok: false, error: 'Monto de pago inválido' }
        }
        if (amount <= 0)
          return { ok: false, error: 'Monto de pago inválido' }
        p.amount = amount
      }

      const hasCredit = paymentsData.some(p => p.method === 'credito')
      const hasSistecredito = paymentsData.some(p => p.method === 'sistecredito')
      if (hasCredit && hasSistecredito) return { ok: false, error: 'Una venta no puede combinar Crédito interno y Sistecrédito' }
      const financingMethod = hasCredit ? 'credito' : hasSistecredito ? 'sistecredito' : null
      const financingPct = Number(payload.financingPct ?? 0)
      if (!Number.isFinite(financingPct) || financingPct < 0 || financingPct > 100) return { ok: false, error: 'Porcentaje de financiación inválido' }
      const chargedTotal = financingMethod ? Math.round(total * (1 + financingPct / 100)) : total
      const customer = customerId ? db.get(`SELECT id, name FROM customers WHERE id=? AND is_active=1`, [Number(customerId)]) : null
      if (customerId && !customer) return { ok: false, error: 'Cliente no encontrado o inactivo' }
      if (hasCredit && !customer) return { ok: false, error: 'Para una venta a crédito interno debes seleccionar un cliente' }
      if (hasSistecredito && customerId) return { ok: false, error: 'Sistecrédito no se asocia a clientes' }
      const installmentCount = hasCredit ? Number(installments) : null
      if (hasCredit && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120)) {
        return { ok: false, error: 'Número de cuotas inválido para crédito interno' }
      }

      const totalPagado = paymentsData[0].amount
      // El backend registra el valor real de la venta. En efectivo el monto
      // recibido puede ser mayor, pero la venta siempre se registra por su total.
      if (paymentsData[0].method !== 'efectivo' && Math.round(totalPagado) !== Math.round(chargedTotal)) {
        return { ok: false, error: `El pago debe coincidir exactamente con el total: $${chargedTotal.toLocaleString('es-CO')}` }
      }
      if (paymentsData[0].method === 'efectivo' && Math.round(totalPagado) !== Math.round(total)) {
        return { ok: false, error: `El valor registrado en efectivo debe ser $${total.toLocaleString('es-CO')}` }
      }

      // ── Transacción atómica ───────────────────────────────
      let saleId
      db.transaction(() => {
        // 1. Venta
        const saleRes = db.run(
          `INSERT INTO sales (invoice_number, user_id, cash_register_id, customer_id, subtotal, tax_amt, total, notes, financing_method, financing_pct, financing_base, financing_total, installment_count, installment_amount)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [invoice, userId, caja.id, customer?.id || null, subtotal, taxAmt, chargedTotal, notes || null,
           financingMethod || 'none', financingPct,
           financingMethod ? total : 0, financingMethod ? chargedTotal : 0,
           hasCredit ? installmentCount : 1,
           hasCredit ? Math.round((chargedTotal / installmentCount) * 100) / 100 : 0]
        )
        saleId = saleRes.lastInsertRowid

        // 2. Ítems + descuento de stock
        for (const li of lineItems) {
          db.run(
            `INSERT INTO sale_items (sale_id, variant_id, product_name, size, color, qty, unit_price, discount_pct, line_total)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [saleId, li.variant.id, li.variant.product_name,
             li.variant.size, li.variant.color,
             li.qty, li.unitPrice, li.discPct, li.lineTotal]
          )
          const newStock = li.variant.stock - li.qty
          db.run(`UPDATE product_variants SET stock=?, updated_at=datetime('now') WHERE id=?`,
            [newStock, li.variant.id])
          db.run(
            `INSERT INTO inventory_movements (variant_id, user_id, type, qty, stock_before, stock_after, reference)
             VALUES (?,?,?,?,?,?,?)`,
            [li.variant.id, userId, 'venta', -li.qty, li.variant.stock, newStock, invoice]
          )
        }

        // 3. Pagos
        for (const p of paymentsData) {
          db.run(
            `INSERT INTO payments (sale_id, method, amount, reference) VALUES (?,?,?,?)`,
            [saleId, p.method, p.amount, p.reference || null]
          )
        }

        // 4. Crédito interno: crear saldo pendiente asociado a la venta y cliente.
        if (hasCredit) {
          const creditAmount = paymentsData.filter(p => p.method === 'credito').reduce((sum, p) => sum + p.amount, 0)
          if (creditAmount > 0) {
            const installmentAmount = Math.ceil((creditAmount / installmentCount) * 100) / 100
            db.run(
              `INSERT INTO credits(customer_id, sale_id, total_amount, installment_count, installment_amount, paid_amount, balance, status)
               VALUES(?,?,?,?,?,?,?,'pending')`,
              [customer.id, saleId, creditAmount, installmentCount, installmentAmount, 0, creditAmount]
            )
          }
        }

        // 5. Registro de factura
        db.run(`INSERT INTO invoices (sale_id) VALUES (?)`, [saleId])

        // 6. Incrementar contador
        db.run(
          `INSERT INTO settings (key, value) VALUES ('invoice_next',?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          [String(nextNum + 1)]
        )

        // 7. Auditoría — dentro de la misma transacción. Si el registro de
        // auditoría falla, toda la venta debe revertirse: de lo contrario
        // la venta quedaría guardada en la base de datos pero el backend
        // respondería error, y el cajero podría reintentar y duplicar la
        // venta (doble descuento de stock, doble ingreso de caja).
        authService.audit.log(userId, 'create_sale', 'sale', saleId,
          { invoice, total, items: lineItems.length })
      })

      return { ok: true, saleId, invoice, total: chargedTotal, baseTotal: total, taxAmt, subtotal }
    } catch (e) {
  console.error('[SalesHandlers:createSale]', {
    name: e?.name,
    message: e?.message,
    code: e?.code,
    stack: e?.stack,
  })

  return {
    ok: false,
    error: `Error al registrar la venta: ${e?.message || 'Error desconocido'}`
  }
}
  })

  // ── Historial de ventas ───────────────────────────────────
  ipcMain.handle('sales:getSales', async (_, params = {}) => {
    try {
      authService.requirePermission('sales')
      const { from, to, status, search } = params
      const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 500)
      const offset = Math.max(Number(params.offset) || 0, 0)
      let sql = `
        SELECT s.*, u.name AS cajero,
               (SELECT method FROM payments WHERE sale_id = s.id LIMIT 1) AS payment_method,
               (SELECT COALESCE(pv.image_path, p.image_path)
                  FROM sale_items si
                  JOIN product_variants pv ON pv.id = si.variant_id
                  JOIN products p ON p.id = pv.product_id
                 WHERE si.sale_id = s.id
                 ORDER BY si.id
                 LIMIT 1) AS image_path
        FROM sales s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE 1=1
      `
      const args = []
      if (from)   { sql += " AND DATE(s.created_at, 'localtime') >= ?"; args.push(from) }
      if (to)     { sql += " AND DATE(s.created_at, 'localtime') <= ?"; args.push(to) }
      if (status) { sql += ' AND s.status = ?';            args.push(status) }
      if (search) {
        sql += ' AND (s.invoice_number LIKE ? OR u.name LIKE ?)'
        args.push(`%${search}%`, `%${search}%`)
      }
      sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?'
      args.push(limit, offset)

      const items = db.all(sql, args)
      return { ok: true, data: items }
    } catch (e) {
      console.error('[SalesHandlers:getSales]', e)
      return { ok: false, error: 'Error al obtener ventas' }
    }
  })

  // ── Detalle de venta ──────────────────────────────────────
  ipcMain.handle('sales:getSale', async (_, id) => {
    try {
      authService.requirePermission('sales')
      const sale = db.get(
        `SELECT s.*, u.name AS cajero
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`, [id]
      )
      if (!sale) return { ok: false, error: 'Venta no encontrada' }

      sale.items    = db.all(
        `SELECT si.*, COALESCE(pv.image_path, p.image_path) AS image_path
           FROM sale_items si
           LEFT JOIN product_variants pv ON pv.id = si.variant_id
           LEFT JOIN products p ON p.id = pv.product_id
          WHERE si.sale_id = ?
          ORDER BY si.id`,
        [id]
      )
      sale.payments = db.all(`SELECT * FROM payments WHERE sale_id = ?`, [id])

      const settings = {}
      db.all('SELECT key, value FROM settings').forEach(r => { settings[r.key] = r.value })
      sale.settings = settings

      return { ok: true, data: sale }
    } catch (e) {
      console.error('[SalesHandlers:getSale]', e)
      return { ok: false, error: 'Error al obtener detalle de venta' }
    }
  })

  // ── Cancelar venta ────────────────────────────────────────
  ipcMain.handle('sales:cancelSale', async (_, { id, reason }) => {
    try {
      authService.requirePermission('sales')
      const sale = db.get(`SELECT * FROM sales WHERE id = ? AND status = 'completed'`, [id])
      if (!sale) return { ok: false, error: 'Venta no encontrada o ya cancelada' }

      const userId = authService.getSession()?.id
      if (!userId) return { ok: false, error: 'Sesión inválida' }

      db.transaction(() => {
        const saleItems = db.all(`SELECT * FROM sale_items WHERE sale_id = ?`, [id])
        for (const item of saleItems) {
          const v = db.get(`SELECT stock FROM product_variants WHERE id = ?`, [item.variant_id])
          if (v) {
            const newStock = v.stock + item.qty
            db.run(`UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
              [newStock, item.variant_id])
            db.run(
              `INSERT INTO inventory_movements (variant_id, user_id, type, qty, stock_before, stock_after, reference, notes)
               VALUES (?,?,?,?,?,?,?,?)`,
              [item.variant_id, userId, 'devolucion', item.qty, v.stock, newStock,
               sale.invoice_number, reason || 'Cancelación de venta']
            )
          }
        }
        db.run(
          `UPDATE sales SET status='cancelled', cancel_reason=?, cancelled_by=?, cancelled_at=datetime('now')
           WHERE id=?`,
          [reason || null, userId, id]
        )

        // Un crédito interno no puede quedar pendiente después de cancelar
        // la venta que lo originó.
        db.run(
          `UPDATE credits SET status='cancelled', balance=0, updated_at=datetime('now')
           WHERE sale_id=? AND status IN ('pending','paid')`,
          [id]
        )

        const originalPayments = db.all(
          `SELECT method, amount, reference FROM payments WHERE sale_id=? ORDER BY id`,
          [id]
        )
        authService.audit.log(userId, 'cancel_sale', 'sale', id, {
          invoice: sale.invoice_number,
          reason: reason ? String(reason).trim().slice(0, 500) : null,
          cash_register_id: sale.cash_register_id,
          payments: originalPayments
        })
      })

      return { ok: true }
    } catch (e) {
      console.error('[SalesHandlers:cancelSale]', e)
      return { ok: false, error: 'Error al cancelar la venta' }
    }
  })

  // ── Buscar por código de barras (para POS scanner) ────────
  ipcMain.handle('sales:scanBarcode', async (_, barcode) => {
    try {
      authService.requirePermission('sales')
      if (!barcode || !barcode.trim())
        return { ok: false, error: 'Código vacío' }

      // Buscar en variantes primero (más específico)
      const variant = db.get(
        `SELECT pv.*, p.name AS product_name, p.sale_price AS base_price,
                p.id AS product_id, p.sku AS product_sku, COALESCE(pv.image_path, p.image_path) AS display_image_path, p.image_path
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.barcode = ? AND pv.is_active = 1 AND p.is_active = 1`,
        [barcode.trim()]
      )

      if (variant) {
        if (variant.stock <= 0)
          return { ok: false, error: `Sin stock: ${variant.product_name} ${variant.size}/${variant.color}` }

        return {
          ok: true,
          type: 'variant',
          data: {
            variantId:   variant.id,
            productId:   variant.product_id,
            productName: variant.product_name,
            sku:         variant.product_sku,
            size:        variant.size,
            color:       variant.color,
            stock:       variant.stock,
            unitPrice:   variant.price_override ?? variant.base_price,
            imagePath:  variant.display_image_path || null,
          }
        }
      }

      // Buscar en producto principal
      const product = db.get(
        `SELECT * FROM products WHERE barcode = ? AND is_active = 1`,
        [barcode.trim()]
      )

      if (product) {
        // Retornar variantes disponibles para que el cajero elija
        const variants = db.all(
          `SELECT pv.*, COALESCE(pv.image_path, p.image_path) AS display_image_path
           FROM product_variants pv JOIN products p ON p.id = pv.product_id
           WHERE pv.product_id = ? AND pv.is_active = 1 AND pv.stock > 0`,
          [product.id]
        )
        return { ok: true, type: 'product_select', data: product, variants }
      }

      return { ok: false, error: 'Código de barras no encontrado' }
    } catch (e) {
      console.error('[SalesHandlers:scanBarcode]', e)
      return { ok: false, error: 'Error al buscar código' }
    }
  })
}

module.exports = { registerSalesHandlers }
