// electron/ipc/ReportHandlers.js

function registerReportHandlers(ipcMain, db, authService) {

  // ── Dashboard ─────────────────────────────────────────────
  ipcMain.handle('reports:getDashboard', async () => {
    try {
      authService.requirePermission('dashboard')
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const thisMonth = today.slice(0, 7)

      const ventasHoy = db.get(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM sales WHERE DATE(created_at, 'localtime')=? AND status='completed'`, [today]
      )
      const ventasMes = db.get(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM sales WHERE strftime('%Y-%m',created_at, 'localtime')=? AND status='completed'`, [thisMonth]
      )
      const inventarioStats = db.get(
        `SELECT COUNT(DISTINCT p.id) AS total_products,
                COALESCE(SUM(v.stock),0) AS total_units,
                COALESCE(SUM(v.stock * p.cost_price),0) AS inventory_value
         FROM products p
         LEFT JOIN product_variants v ON v.product_id=p.id AND v.is_active=1
         WHERE p.is_active=1`
      )
      const cajaAbierta = db.get(
        `SELECT cr.id, cr.opening_amount,
                COALESCE(SUM(p.amount),0) AS total_sales,
                COUNT(DISTINCT s.id) AS num_sales
         FROM cash_registers cr
         LEFT JOIN sales s ON s.cash_register_id = cr.id AND s.status='completed'
         LEFT JOIN payments p ON p.sale_id = s.id
         WHERE cr.status='open'
         GROUP BY cr.id LIMIT 1`
      )
      const ventas7dias = db.all(
        `SELECT DATE(created_at, 'localtime') AS dia,
                COALESCE(SUM(total),0) AS total,
                COUNT(*) AS count
         FROM sales
         WHERE DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-6 days') AND status='completed'
         GROUP BY DATE(created_at, 'localtime') ORDER BY dia ASC`
      )
      const ventasPorMetodo = db.all(
        `SELECT p.method, COALESCE(SUM(p.amount),0) AS total, COUNT(*) AS count
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         WHERE strftime('%Y-%m',s.created_at, 'localtime')=? AND s.status='completed'
         GROUP BY p.method`, [thisMonth]
      )
      // Usa el mismo umbral configurable que el resto de la app (Ajustes >
      // Inventario) en lugar de un valor fijo, para que el dashboard no
      // muestre una cifra distinta a la del módulo de Inventario.
      const threshold = parseInt(
        db.get(`SELECT value FROM settings WHERE key='low_stock_threshold'`)?.value || '5', 10
      )
      const stockBajo = db.get(
        `SELECT COUNT(*) AS n FROM product_variants v
         JOIN products p ON p.id=v.product_id
         WHERE v.is_active=1 AND p.is_active=1 AND v.stock > 0 AND v.stock <= ?`,
        [threshold]
      )
      const sinStock = db.get(
        `SELECT COUNT(*) AS n FROM product_variants v
         JOIN products p ON p.id=v.product_id
         WHERE v.is_active=1 AND p.is_active=1 AND v.stock = 0`
      )

      return {
        ok: true,
        data: { ventasHoy, ventasMes, inventarioStats, cajaAbierta,
                ventas7dias, ventasPorMetodo,
                stockBajo: stockBajo?.n || 0, sinStock: sinStock?.n || 0 }
      }
    } catch (e) {
      console.error('[ReportHandlers:getDashboard]', e)
      return { ok: false, error: 'Error al cargar dashboard' }
    }
  })

  // ── Reporte de ventas con filtros ─────────────────────────
  ipcMain.handle('reports:getSalesReport', async (_, params = {}) => {
    try {
      authService.requirePermission('reports')
      const { from, to } = params
      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500)
      const offset = Math.max(Number(params.offset) || 0, 0)
      let sql = `
        SELECT s.*, u.name AS cajero,
               (SELECT GROUP_CONCAT(method||':'||amount) FROM payments WHERE sale_id=s.id) AS payments_summary
        FROM sales s LEFT JOIN users u ON u.id=s.user_id
        WHERE 1=1
      `
      const args = []
      if (from) { sql += " AND DATE(s.created_at, 'localtime') >= ?"; args.push(from) }
      if (to)   { sql += " AND DATE(s.created_at, 'localtime') <= ?"; args.push(to) }
      sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?'
      args.push(limit, offset)

      const items = db.all(sql, args)

      let totalSql = `
        SELECT COALESCE(SUM(total),0) AS grand_total, COUNT(*) AS total_count
        FROM sales
        WHERE status='completed'
      `
      const totalArgs = []
      if (from) { totalSql += " AND DATE(created_at, 'localtime') >= ?"; totalArgs.push(from) }
      if (to)   { totalSql += " AND DATE(created_at, 'localtime') <= ?"; totalArgs.push(to) }

      const totRow = db.get(totalSql, totalArgs)
      return { ok: true, data: { items, ...totRow } }
    } catch (e) {
      return { ok: false, error: 'Error al obtener reporte de ventas' }
    }
  })

  // ── Top productos ─────────────────────────────────────────
  ipcMain.handle('reports:getTopProducts', async (_, { limit = 10, from, to } = {}) => {
    try {
      authService.requirePermission('reports')
      const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100)
      let sql = `
        SELECT p.name, p.sku,
               SUM(si.qty) AS total_qty,
               SUM(si.line_total) AS total_revenue,
               COUNT(DISTINCT si.sale_id) AS num_sales
        FROM sale_items si
        JOIN product_variants pv ON pv.id=si.variant_id
        JOIN products p ON p.id=pv.product_id
        JOIN sales s ON s.id=si.sale_id
        WHERE s.status='completed'
      `
      const args = []
      if (from) { sql += " AND DATE(s.created_at, 'localtime') >= ?"; args.push(from) }
      if (to)   { sql += " AND DATE(s.created_at, 'localtime') <= ?"; args.push(to) }
      sql += ' GROUP BY p.id ORDER BY total_qty DESC LIMIT ?'
      args.push(safeLimit)

      return { ok: true, data: db.all(sql, args) }
    } catch (e) {
      return { ok: false, error: 'Error al obtener top productos' }
    }
  })

  // ── Reporte de inventario ─────────────────────────────────
  ipcMain.handle('reports:getInventoryReport', async () => {
    try {
      authService.requirePermission('reports')
      const threshold = parseInt(
        db.get(`SELECT value FROM settings WHERE key='low_stock_threshold'`)?.value || '5'
      )
      const items = db.all(
        `SELECT p.name, p.sku, c.name AS category,
                COALESCE(SUM(v.stock),0) AS total_stock,
                COUNT(v.id) AS variants,
                p.sale_price, p.cost_price,
                COALESCE(SUM(v.stock * p.cost_price),0) AS value
         FROM products p
         LEFT JOIN categories c ON c.id=p.category_id
         LEFT JOIN product_variants v ON v.product_id=p.id AND v.is_active=1
         WHERE p.is_active=1
         GROUP BY p.id
         ORDER BY total_stock ASC`
      )
      return { ok: true, data: items, threshold }
    } catch (e) {
      return { ok: false, error: 'Error al obtener reporte de inventario' }
    }
  })
}

module.exports = { registerReportHandlers }
