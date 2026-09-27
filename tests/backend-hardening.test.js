const test = require('node:test')
const assert = require('node:assert/strict')

const SettingsService = require('../electron/settings/SettingsService')
const AuthService = require('../electron/auth/AuthService')

function settingsDb() {
  const writes = []
  return {
    writes,
    all: () => [{ key: 'currency', value: 'COP' }],
    get: () => null,
    run: (...args) => writes.push(args),
  }
}

test('settings only accepts allowed keys and keeps COP', () => {
  const db = settingsDb()
  const service = new SettingsService(db)

  service.set('store_name', "J'97")
  assert.equal(db.writes.length, 1)

  assert.throws(() => service.set('unknown_setting', 'x'), /Configuración no permitida/)
  assert.throws(() => service.set('currency', 'USD'), /moneda.*COP/i)
  assert.throws(() => service.set('tax_rate', 150), /entre 0 y 100/)
})

test('the single-admin mode only allows changing the active administrator password', async () => {
  const db = {
    get(sql, params) {
      if (String(sql).includes('FROM users')) {
        return { id: params?.[0] ?? 1, name: 'Admin', username: 'admin', role: 'admin' }
      }
      return null
    },
    all: () => [],
    run: () => ({ lastInsertRowid: 1 }),
  }

  const auth = new AuthService(db)
  auth.session = { id: 1, permissions: ['settings'] }

  const result = await auth.changePassword(2, 'newpassword123')
  assert.deepEqual(result, { ok: false, error: 'Solo el administrador activo puede cambiar su propia contraseña' })
})
