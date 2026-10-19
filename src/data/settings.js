// src/data/settings.js — port de electron/settings/SettingsService.js
import { db, save } from './db.js'

const ALLOWED = new Set([
  'store_name', 'store_nit', 'store_address', 'store_phone', 'store_email',
  'invoice_prefix', 'invoice_next', 'tax_rate', 'low_stock_threshold',
  'backup_enabled', 'backup_days', 'tax_enabled', 'logo_path', 'theme', 'currency',
])

const DEFAULTS = {
  store_name: 'J97', store_nit: '',
  store_address: 'Barrio Chapineros, frente al restaurante El Sitio',
  store_phone: '321 297 0108', store_email: '', currency: 'COP', tax_rate: '0',
  invoice_prefix: 'ZF', invoice_next: '1', low_stock_threshold: '5',
  tax_enabled: '0', logo_path: '', theme: 'light',
}

/** Primer arranque sin internet: crea la configuración base (el servidor gana si difiere). */
export async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!(await db.settings.get(key))) {
      await db.settings.put({ key, value, updated_at: '1970-01-01T00:00:00.000Z', _dirty: 0 })
    }
  }
}

export async function getAll() {
  const rows = await db.settings.toArray()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function get(key) {
  return (await db.settings.get(key))?.value ?? null
}

export async function set(key, value) {
  if (!ALLOWED.has(key)) throw new Error('Configuración no permitida')

  if (key === 'currency' && String(value).toUpperCase() !== 'COP') {
    throw new Error('La moneda del sistema debe ser COP')
  }
  if (key === 'invoice_prefix') {
    const v = String(value ?? '').trim().toUpperCase()
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
  await save('settings', { key, value: String(value) })
}
