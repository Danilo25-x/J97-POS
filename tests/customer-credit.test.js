const test = require('node:test')
const assert = require('node:assert/strict')
const CustomerService = require('../electron/customers/CustomerService')

function authStub() {
  return {
    getSession: () => ({ id: 7 }),
    audit: { log: () => {} },
  }
}

test('customer credit payment is atomic and enters the open cash register', () => {
  const writes = []
  const db = {
    get(sql) {
      if (String(sql).includes('FROM credits')) return { id: 4, customer_id: 2, customer_name: 'Ana', total_amount: 100000, paid_amount: 25000, balance: 75000, status: 'pending' }
      if (String(sql).includes('FROM cash_registers')) return { id: 3 }
      return null
    },
    run(sql, params) { writes.push({ sql: String(sql), params }); return { lastInsertRowid: 1 } },
    transaction(fn) { return fn() },
  }

  const service = new CustomerService(db, authStub())
  const result = service.registerCreditPayment(4, 25000, 'Abono', 'efectivo')

  assert.deepEqual(result, { ok: true, balance: 50000 })
  assert.equal(writes.length, 3)
  assert.match(writes[0].sql, /INSERT INTO credit_payments/)
  assert.match(writes[1].sql, /INSERT INTO cash_income/)
  assert.match(writes[2].sql, /UPDATE credits SET paid_amount/)
})

test('credit payment requires an open cash register', () => {
  const db = {
    get(sql) {
      if (String(sql).includes('FROM credits')) return { id: 4, customer_id: 2, customer_name: 'Ana', total_amount: 100000, paid_amount: 0, balance: 100000, status: 'pending' }
      if (String(sql).includes('FROM cash_registers')) return null
      return null
    },
    transaction() { throw new Error('must not transact') },
  }
  const service = new CustomerService(db, authStub())
  assert.deepEqual(service.registerCreditPayment(4, 10000), { ok: false, error: 'Debes abrir la caja antes de registrar un abono' })
})
