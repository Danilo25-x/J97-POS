// electron/customers/CustomerService.js
const { text, id, positiveCop, documentNumber, phoneNumber } = require('../lib/validation')

class CustomerService {
  constructor(db, authService) {
    this.db = db
    this.auth = authService
  }

  list({ search = '', page = 1, pageSize = 30 } = {}) {
    page = Math.max(1, Number.parseInt(page, 10) || 1)
    pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 30))
    const q = String(search ?? '').trim()
    const params = []
    let where = 'WHERE c.is_active = 1'

    if (q) {
      where += ' AND (c.name LIKE ? OR c.document LIKE ? OR c.phone LIKE ?)'
      const like = `%${q}%`
      params.push(like, like, like)
    }

    const items = this.db.all(
      `SELECT c.*,
              COALESCE((SELECT SUM(cr.balance) FROM credits cr WHERE cr.customer_id=c.id AND cr.status='pending'),0) AS pending_balance,
              COALESCE((SELECT SUM(cr.installment_count) FROM credits cr WHERE cr.customer_id=c.id),0) AS installments,
              COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id AND s.status='completed'),0) AS purchase_count
       FROM customers c
       ${where}
       ORDER BY c.name
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )

    const total = this.db.get(`SELECT COUNT(*) AS total FROM customers c ${where}`, params).total
    return { items, total, page, pageSize }
  }

  get(idValue) {
    const customerId = id(idValue, 'Cliente')
    const customer = this.db.get('SELECT * FROM customers WHERE id=? AND is_active=1', [customerId])
    if (!customer) return null

    customer.credits = this.db.all(
      `SELECT cr.*, s.invoice_number
       FROM credits cr JOIN sales s ON s.id=cr.sale_id
       WHERE cr.customer_id=? ORDER BY cr.created_at DESC`,
      [customerId]
    )
    return customer
  }

  create(data = {}) {
    const name = text(data.name, { required: true, max: 160, field: 'Nombre del cliente' })
    const document = documentNumber(data.document)
    const phone = phoneNumber(data.phone)
    const email = data.email ? text(data.email, { max: 120, field: 'Correo' }) : null
    const address = data.address ? text(data.address, { max: 180, field: 'Dirección' }) : null
    const notes = data.notes ? text(data.notes, { max: 500, field: 'Notas' }) : null

    if (document && this.db.get('SELECT id FROM customers WHERE document=? AND is_active=1', [document])) {
      return { ok: false, error: 'Ya existe un cliente con ese documento' }
    }

    let customerId
    this.db.transaction(() => {
      const result = this.db.run(
        `INSERT INTO customers(name,document,phone,email,address,notes)
         VALUES(?,?,?,?,?,?)`,
        [name, document, phone, email, address, notes]
      )
      customerId = result.lastInsertRowid
      this._audit('create_customer', customerId, { name })
    })
    return { ok: true, id: customerId }
  }

  update(idValue, data = {}) {
    const customerId = id(idValue, 'Cliente')
    if (!this.get(customerId)) return { ok: false, error: 'Cliente no encontrado' }

    const name = text(data.name, { required: true, max: 160, field: 'Nombre del cliente' })
    const document = documentNumber(data.document)
    const phone = phoneNumber(data.phone)
    // Mismas reglas que create(): sin esto, editar un cliente permitía guardar
    // correo/dirección/notas sin límite de longitud ni normalización.
    const email = data.email ? text(data.email, { max: 120, field: 'Correo' }) : null
    const address = data.address ? text(data.address, { max: 180, field: 'Dirección' }) : null
    const notes = data.notes ? text(data.notes, { max: 500, field: 'Notas' }) : null
    if (document && this.db.get('SELECT id FROM customers WHERE document=? AND id<>? AND is_active=1', [document, customerId])) {
      return { ok: false, error: 'Ya existe otro cliente con ese documento' }
    }

    this.db.transaction(() => {
      this.db.run(
        `UPDATE customers SET name=?,document=?,phone=?,email=?,address=?,notes=?,updated_at=datetime('now') WHERE id=?`,
        [name, document, phone, email, address, notes, customerId]
      )
      this._audit('update_customer', customerId, { name })
    })
    return { ok: true }
  }

  deactivate(idValue) {
    const customerId = id(idValue, 'Cliente')
    if (!this.get(customerId)) return { ok: false, error: 'Cliente no encontrado' }

    const debt = this.db.get(
      `SELECT COALESCE(SUM(balance),0) AS balance FROM credits WHERE customer_id=? AND status='pending'`,
      [customerId]
    ).balance

    if (debt > 0) return { ok: false, error: 'No se puede desactivar un cliente con saldo pendiente' }

    this.db.transaction(() => {
      this.db.run(`UPDATE customers SET is_active=0,updated_at=datetime('now') WHERE id=?`, [customerId])
      this._audit('deactivate_customer', customerId, {})
    })
    return { ok: true }
  }

  registerCreditPayment(creditIdValue, amountValue, notes, paymentMethod = 'efectivo') {
    const creditId = id(creditIdValue, 'Crédito')
    const amount = positiveCop(amountValue, 'Abono')
    const credit = this.db.get(`SELECT cr.*, c.name AS customer_name FROM credits cr JOIN customers c ON c.id=cr.customer_id WHERE cr.id=? AND cr.status='pending'`, [creditId])
    if (!credit) return { ok: false, error: 'Crédito no encontrado o ya pagado' }
    if (amount > credit.balance) return { ok: false, error: 'El abono supera el saldo pendiente' }
    const validMethods = ['efectivo', 'transferencia']
    if (!validMethods.includes(paymentMethod)) return { ok: false, error: 'Método de pago inválido' }

    const userId = this.auth.getSession()?.id
    const openRegister = this.db.get(`SELECT id FROM cash_registers WHERE status='open' LIMIT 1`)
    if (!openRegister) return { ok: false, error: 'Debes abrir la caja antes de registrar un abono' }
    this.db.transaction(() => {
      const newPaid = credit.paid_amount + amount
      const newBalance = credit.total_amount - newPaid
      this.db.run(
        `INSERT INTO credit_payments(credit_id,user_id,amount,notes,payment_method) VALUES(?,?,?,?,?)`,
        [creditId, userId, amount, notes ? text(notes, { max: 300, field: 'Nota' }) : null, paymentMethod]
      )

      this.db.run(
          `INSERT INTO cash_income(cash_register_id,user_id,source,reference_id,description,amount,payment_method)
           VALUES(?,?,?,?,?,?,?)`,
          [openRegister.id, userId, 'credit_payment', creditId, `Abono crédito — ${credit.customer_name}`, amount, paymentMethod]
        )
      this.db.run(
        `UPDATE credits SET paid_amount=?,balance=?,status=?,updated_at=datetime('now') WHERE id=?`,
        [newPaid, newBalance, newBalance === 0 ? 'paid' : 'pending', creditId]
      )

      // Auditoría dentro de la transacción: si fallara fuera de ella, el abono
      // ya habría quedado registrado pero el backend respondería error, y un
      // reintento podría duplicar el abono del cliente.
      this._audit('credit_payment', creditId, { amount })
    })

    return { ok: true, balance: credit.balance - amount }
  }

  _audit(action, entityId, details) {
    this.auth.audit.log(this.auth.getSession()?.id, action, 'customer', entityId, details)
  }
}

module.exports = CustomerService
