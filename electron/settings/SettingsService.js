// electron/settings/SettingsService.js

class SettingsService {
  constructor(db) { this.db = db }

  static ALLOWED_KEYS = new Set([
    'store_name', 'store_nit', 'store_address', 'store_phone', 'store_email',
    'invoice_prefix', 'invoice_next', 'tax_rate', 'low_stock_threshold',
    'backup_enabled', 'backup_days', 'tax_enabled', 'logo_path', 'theme', 'currency'
  ])

  getAll() {
    const rows = this.db.all('SELECT key, value FROM settings')
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  }

  set(key, value) {
    if (!SettingsService.ALLOWED_KEYS.has(key)) {
      throw new Error('Configuración no permitida')
    }

    if (key === 'currency' && String(value).toUpperCase() !== 'COP') {
      throw new Error('La moneda del sistema debe ser COP')
    }

    if (key === 'invoice_prefix') {
      const v = String(value ?? '').trim().toUpperCase()
      // El prefijo se usa para construir el número de factura y, a partir
      // de este, el nombre del archivo PDF generado en disco. Debe limitarse
      // a letras, números y guiones para evitar factura inválidas o rutas
      // de archivo inesperadas (por ejemplo "../../").
      if (!v || !/^[A-Z0-9-]{1,10}$/.test(v)) {
        throw new Error('El prefijo de factura solo puede contener letras, números y guiones (máx. 10 caracteres)')
      }
      value = v
    }

    if (key === 'invoice_next') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) throw new Error('El próximo número de factura debe ser un entero positivo')
      value = n
    }

    if (key === 'tax_rate') {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('La tasa de impuesto debe estar entre 0 y 100')
      value = n
    }

    if (key === 'low_stock_threshold') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0) throw new Error('El umbral de stock debe ser un entero no negativo')
      value = n
    }

    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)]
    )
  }

  get(key) {
    const row = this.db.get('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? null
  }
}

module.exports = SettingsService
