const test = require('node:test')
const assert = require('node:assert/strict')
const { cop } = require('../electron/lib/validation')

test('COP validation accepts Colombian thousands format and rejects malformed money', () => {
  assert.equal(cop(100000), 100000)
  assert.equal(cop('100000'), 100000)
  assert.equal(cop('100.000'), 100000)
  assert.equal(cop('$ 1.250.000'), 1250000)

  assert.throws(() => cop('10abc'), /Monto inválido/)
  assert.throws(() => cop('100,000'), /Monto inválido/)
  assert.throws(() => cop('100.00'), /Monto inválido/)
})

test('COP validation never converts unsafe integers to valid money', () => {
  assert.throws(() => cop(Number.MAX_SAFE_INTEGER + 1), /Monto inválido/)
  assert.throws(() => cop(-1), /Monto inválido/)
})
