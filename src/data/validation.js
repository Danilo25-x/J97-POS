// src/data/validation.js — mismas reglas que electron/lib/validation.js.
// Único cambio: los ids ahora son UUID (texto) en vez de enteros.

export function text(value, { required = false, max = 255, field = 'Campo' } = {}) {
  const result = String(value ?? '').trim()
  if (required && !result) throw new Error(`${field} es obligatorio`)
  if (result.length > max) throw new Error(`${field} supera el máximo permitido de ${max} caracteres`)
  return result
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function id(value, field = 'ID') {
  const result = String(value ?? '').trim()
  if (!UUID_RE.test(result)) throw new Error(`${field} inválido`)
  return result.toLowerCase()
}

/** Importes COP como enteros. Acepta 100000, "100000", "100.000" y "$ 100.000". */
export function cop(value, field = 'Monto') {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} inválido`)
    return value
  }
  const normalized = String(value).trim().replace(/^\$\s*/, '')
  if (!/^\d+$/.test(normalized) && !/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    throw new Error(`${field} inválido`)
  }
  const result = Number(normalized.replace(/\./g, ''))
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${field} inválido`)
  return result
}

export function positiveCop(value, field = 'Monto') {
  const result = cop(value, field)
  if (result <= 0) throw new Error(`${field} debe ser mayor que cero`)
  return result
}

export function digits(value, { required = false, min = 1, max = 30, field = 'Campo' } = {}) {
  const result = String(value ?? '').trim()
  if (required && !result) throw new Error(`${field} es obligatorio`)
  if (result && !/^\d+$/.test(result)) throw new Error(`${field} solo puede contener números`)
  if (result && result.length < min) throw new Error(`${field} debe tener al menos ${min} dígitos`)
  if (result && result.length > max) throw new Error(`${field} supera el máximo permitido de ${max} dígitos`)
  return result
}

export const documentNumber = (v) => digits(v, { required: true, min: 5, max: 15, field: 'Documento' })
export const phoneNumber = (v) => digits(v, { required: true, min: 7, max: 15, field: 'Teléfono' })

export function positiveInt(value, field = 'Cantidad') {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${field} debe ser un entero mayor que cero`)
  return result
}
