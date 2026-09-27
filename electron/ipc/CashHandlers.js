const { cop, positiveCop } = require('../lib/validation')
// electron/ipc/CashHandlers.js

function registerCashHandlers(ipcMain, db, authService) {
  const totalsFor = (registerId) => db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN p.method='efectivo' THEN p.amount ELSE 0 END),0) AS cash_sales,
       COALESCE(SUM(CASE WHEN p.method='transferencia' THEN p.amount ELSE 0 END),0) AS transfer_sales,
       COALESCE(SUM(CASE WHEN p.method='credito' THEN p.amount ELSE 0 END),0) AS credit_sales,
       COALESCE(SUM(CASE WHEN p.method='sistecredito' THEN p.amount ELSE 0 END),0) AS sistecredito_sales,
       COALESCE(SUM(p.amount),0) AS total_sales,
       COUNT(DISTINCT s.id) AS num_sales
     FROM payments p
     JOIN sales s ON s.id=p.sale_id
     WHERE s.cash_register_id=? AND s.status='completed'`, [registerId]
  )

  const collectionsFor = (registerId) => db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method='efectivo' THEN amount ELSE 0 END),0) AS credit_collection_cash,
       COALESCE(SUM(CASE WHEN payment_method='transferencia' THEN amount ELSE 0 END),0) AS credit_collection_transfer,
       COALESCE(SUM(amount),0) AS total_credit_collections
     FROM cash_income WHERE cash_register_id=? AND source='credit_payment'`, [registerId]
  )

  const expensesFor = (registerId, order = 'DESC') => ({
    total: db.get(`SELECT COALESCE(SUM(amount),0) AS total FROM cash_expenses WHERE cash_register_id=?`, [registerId]).total,
    list: db.all(`SELECT ce.*, u.name AS user_name FROM cash_expenses ce LEFT JOIN users u ON u.id=ce.user_id WHERE ce.cash_register_id=? ORDER BY ce.created_at ${order}`, [registerId])
  })

  ipcMain.handle('cash:openRegister', async (_, { openingAmount } = {}) => {
    try {
      authService.requirePermission('cash_register')
      if (db.get(`SELECT id FROM cash_registers WHERE status='open' LIMIT 1`)) return { ok: false, error: 'Ya hay una caja abierta' }
      const userId = authService.getSession()?.id
      if (!userId) return { ok: false, error: 'Sesión inválida' }
      const amount = cop(openingAmount, 'Efectivo inicial')
      if (amount < 0) return { ok: false, error: 'El monto inicial no puede ser negativo' }
      let registerId
      db.transaction(() => {
        const result = db.run(`INSERT INTO cash_registers(user_id,opening_amount,status) VALUES(?,?, 'open')`, [userId, amount])
        registerId = result.lastInsertRowid
        authService.audit.log(userId, 'open_cash', 'cash_register', registerId, { opening_amount: amount })
      })
      return { ok: true, id: registerId }
    } catch (e) { console.error('[CashHandlers:open]', e); return { ok: false, error: 'Error al abrir la caja' } }
  })

  ipcMain.handle('cash:getOpen', async () => {
    try {
      authService.requirePermission('cash_register')
      const caja = db.get(`SELECT cr.*, u.name AS cajero FROM cash_registers cr LEFT JOIN users u ON u.id=cr.user_id WHERE cr.status='open' LIMIT 1`)
      if (!caja) return { ok: true, data: null }
      const totales = totalsFor(caja.id)
      const cobros = collectionsFor(caja.id)
      const gastos = expensesFor(caja.id)
      const expected = caja.opening_amount + totales.cash_sales + cobros.credit_collection_cash - gastos.total
      return { ok: true, data: { ...caja, ...totales, ...cobros, total_expenses: gastos.total, expected_cash: expected, expenses_list: gastos.list } }
    } catch (e) { console.error('[CashHandlers:getOpen]', e); return { ok: false, error: 'Error al obtener estado de caja' } }
  })

  ipcMain.handle('cash:getClosePreview', async () => {
    try {
      authService.requirePermission('cash_register')
      const caja = db.get(`SELECT cr.*, u.name AS cajero FROM cash_registers cr LEFT JOIN users u ON u.id=cr.user_id WHERE cr.status='open' LIMIT 1`)
      if (!caja) return { ok: false, error: 'No hay caja abierta' }
      const totales = totalsFor(caja.id)
      const cobros = collectionsFor(caja.id)
      const gastos = expensesFor(caja.id, 'ASC')
      const expected = caja.opening_amount + totales.cash_sales + cobros.credit_collection_cash - gastos.total
      return { ok: true, data: { caja, totales: { ...totales, ...cobros }, total_expenses: gastos.total, expected_cash: expected, expenses_list: gastos.list } }
    } catch (e) { console.error('[CashHandlers:getClosePreview]', e); return { ok: false, error: 'Error al preparar resumen de caja' } }
  })

  ipcMain.handle('cash:closeRegister', async (_, { closingAmount, notes } = {}) => {
    try {
      authService.requirePermission('cash_register')
      const caja = db.get(`SELECT * FROM cash_registers WHERE status='open' LIMIT 1`)
      if (!caja) return { ok: false, error: 'No hay caja abierta' }
      const userId = authService.getSession()?.id
      if (!userId) return { ok: false, error: 'Sesión inválida' }
      const totales = totalsFor(caja.id)
      const cobros = collectionsFor(caja.id)
      const gastos = expensesFor(caja.id, 'ASC')
      const expected = caja.opening_amount + totales.cash_sales + cobros.credit_collection_cash - gastos.total
      const closing = cop(closingAmount, 'Dinero contado')
      const diff = closing - expected

      db.transaction(() => {
        db.run(`UPDATE cash_registers SET status='closed',closed_at=datetime('now'),closing_amount=?,expected_amount=?,difference=?,cash_sales=?,transfer_sales=?,credit_sales=?,total_sales=?,total_expenses=?,credit_collection_cash=?,credit_collection_transfer=?,total_credit_collections=?,notes=? WHERE id=?`, [
          closing, expected, diff, totales.cash_sales, totales.transfer_sales, totales.credit_sales, totales.total_sales, gastos.total,
          cobros.credit_collection_cash, cobros.credit_collection_transfer, cobros.total_credit_collections,
          notes || null, caja.id
        ])
        authService.audit.log(userId, 'close_cash', 'cash_register', caja.id, { total_sales: totales.total_sales, expected, closing, diff, total_credit_collections: cobros.total_credit_collections })
      })

      const settings = Object.fromEntries(db.all('SELECT key,value FROM settings').map(r => [r.key, r.value]))
      const closedCaja = db.get(`SELECT * FROM cash_registers WHERE id=?`, [caja.id])
      return { ok: true, data: { ...closedCaja, ...totales, ...cobros, cajero: db.get(`SELECT name FROM users WHERE id=?`, [caja.user_id])?.name, total_expenses: gastos.total, expected_cash: expected, difference: diff, expenses_list: gastos.list, settings } }
    } catch (e) { console.error('[CashHandlers:close]', e); return { ok: false, error: 'Error al cerrar la caja' } }
  })

  ipcMain.handle('cash:addExpense', async (_, { description, amount, category, notes: expNotes } = {}) => {
    try {
      authService.requirePermission('cash_register')
      const caja = db.get(`SELECT id FROM cash_registers WHERE status='open' LIMIT 1`)
      if (!caja) return { ok: false, error: 'No hay caja abierta' }
      if (!description?.trim()) return { ok: false, error: 'La descripción es obligatoria' }
      const amt = positiveCop(amount, 'Monto del gasto')
      const userId = authService.getSession()?.id
      if (!userId) return { ok: false, error: 'Sesión inválida' }
      if (!amt || amt <= 0) return { ok: false, error: 'Monto inválido' }
      db.transaction(() => {
        const result = db.run(`INSERT INTO cash_expenses(cash_register_id,user_id,description,amount,category,observation) VALUES(?,?,?,?,?,?)`, [caja.id, userId, description.trim(), amt, category || 'Otros', expNotes || null])
        authService.audit.log(userId, 'add_cash_expense', 'cash_expense', result.lastInsertRowid, { cash_register_id: caja.id, amount: amt })
      })
      return { ok: true }
    } catch (e) { console.error('[CashHandlers:addExpense]', e); return { ok: false, error: 'Error al registrar el gasto' } }
  })

  ipcMain.handle('cash:getHistory', async (_, { limit = 30 } = {}) => {
    try {
      authService.requirePermission('cash_register')
      const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 200)
      return { ok: true, data: db.all(`SELECT cr.*,u.name AS cajero FROM cash_registers cr LEFT JOIN users u ON u.id=cr.user_id ORDER BY cr.opened_at DESC LIMIT ?`, [safeLimit]) }
    } catch (e) { console.error('[CashHandlers:history]', e); return { ok: false, error: 'Error al obtener historial de cajas' } }
  })

  ipcMain.handle('cash:getDetail', async (_, id) => {
    try {
      authService.requirePermission('cash_register')
      const caja = db.get(`SELECT cr.*,u.name AS cajero FROM cash_registers cr LEFT JOIN users u ON u.id=cr.user_id WHERE cr.id=?`, [id])
      if (!caja) return { ok: false, error: 'Caja no encontrada' }
      const expenses = db.all(`SELECT ce.*,u.name AS user_name FROM cash_expenses ce LEFT JOIN users u ON u.id=ce.user_id WHERE ce.cash_register_id=? ORDER BY ce.created_at ASC`, [id])
      const collections = db.all(`SELECT ci.*,u.name AS user_name FROM cash_income ci LEFT JOIN users u ON u.id=ci.user_id WHERE ci.cash_register_id=? ORDER BY ci.created_at ASC`, [id])
      const sales = db.all(`
        SELECT s.id, s.invoice_number, s.created_at, s.status, s.subtotal, s.tax_amt, s.total, s.notes,
               u.name AS cajero,
               COALESCE((SELECT GROUP_CONCAT(p.method || ':' || printf('%.2f', p.amount), ' | ')
                         FROM payments p WHERE p.sale_id=s.id), '') AS payments_summary
        FROM sales s
        LEFT JOIN users u ON u.id=s.user_id
        WHERE s.cash_register_id=?
           OR (s.cash_register_id IS NULL
               AND datetime(s.created_at) >= datetime(?)
               AND datetime(s.created_at) <= datetime(?))
        ORDER BY s.created_at ASC`, [id, caja.opened_at, caja.closed_at || new Date().toISOString()])
      const settings = Object.fromEntries(db.all('SELECT key,value FROM settings').map(r => [r.key, r.value]))
      return { ok: true, data: { ...caja, expenses_list: expenses, collections_list: collections, sales_list: sales, settings } }
    } catch (e) { return { ok: false, error: 'Error al obtener detalle de caja' } }
  })
}

module.exports = { registerCashHandlers }
