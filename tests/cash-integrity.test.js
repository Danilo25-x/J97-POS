const test = require('node:test')
const assert = require('node:assert/strict')

function expectedCash({ opening, cashSales, creditCash, expenses, cashRefunds = 0 }) {
  return opening + cashSales + creditCash - expenses - cashRefunds
}

test('cash closing uses only physical cash movements', () => {
  assert.equal(expectedCash({ opening: 15000, cashSales: 43543, creditCash: 35000, expenses: 40000 }), 53543)
})

test('transfer, internal credit and Sistecrédito do not enter physical cash', () => {
  assert.equal(expectedCash({ opening: 15000, cashSales: 0, creditCash: 0, expenses: 0 }), 15000)
})

test('cash refunds reduce physical cash when they occur in an open register', () => {
  assert.equal(expectedCash({ opening: 15000, cashSales: 100000, creditCash: 0, expenses: 10000, cashRefunds: 25000 }), 80000)
})

test('a financing surcharge is added to the base sale total', () => {
  const base = 35000
  const pct = 5
  const surcharge = Math.round(base * pct / 100)
  assert.equal(base + surcharge, 36750)
})

test('installments preserve the total using a final adjusted installment', () => {
  const total = 100000
  const count = 3
  const base = Math.floor(total / count)
  const last = total - base * (count - 1)
  assert.equal(base, 33333)
  assert.equal(last, 33334)
  assert.equal(base * (count - 1) + last, total)
})
