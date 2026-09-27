// electron/lib/validation.js
// Validaciones y normalización compartidas por la capa backend.

function text(value, { required = false, max = 255, field = 'Campo' } = {}) {
  const result = String(value ?? '').trim()
  if (required && !result) throw new Error(`${field} es obligatorio`)
  if (result.length > max) throw new Error(`${field} supera el máximo permitido de ${max} caracteres`)
  return result
}

function id(value, field = 'ID') {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${field} inválido`)
  }
  return result
}

/**
 * Convierte importes COP a enteros de pesos.
 * Acepta 100000, "100000", "100.000" y "$ 100.000".
 * Los puntos se consideran separadores de miles, no parte del dato almacenado.
 */
function cop(value, field = 'Monto') {
  if (value === null || value === undefined || value === '') return 0

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} inválido`)
    }
    return value
  }

  const raw = String(value).trim()
  // Se aceptan pesos enteros y el formato colombiano con puntos de miles:
  // 100000, "100.000" y "$ 100.000". No se silencian letras ni otros
  // caracteres porque eso podría convertir una entrada malformada en dinero.
  const normalized = raw.replace(/^\$\s*/, '')
  if (!/^\d+$/.test(normalized) && !/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    throw new Error(`${field} inválido`)
  }

  const digits = normalized.replace(/\./g, '')
  const result = Number(digits)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${field} inválido`)
  }
  return result
}

function positiveCop(value, field = 'Monto') {
  const result = cop(value, field)
  if (result <= 0) throw new Error(`${field} debe ser mayor que cero`)
  return result
}

function digits(value, { required = false, min = 1, max = 30, field = 'Campo' } = {}) {
  const result = String(value ?? '').trim()
  if (required && !result) throw new Error(`${field} es obligatorio`)
  if (result && !/^\d+$/.test(result)) throw new Error(`${field} solo puede contener números`)
  if (result && result.length < min) throw new Error(`${field} debe tener al menos ${min} dígitos`)
  if (result && result.length > max) throw new Error(`${field} supera el máximo permitido de ${max} dígitos`)
  return result
}

function documentNumber(value) {
  return digits(value, { required: true, min: 5, max: 15, field: 'Documento' })
}

function phoneNumber(value) {
  return digits(value, { required: true, min: 7, max: 15, field: 'Teléfono' })
}

function positiveInt(value, field = 'Cantidad') {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${field} debe ser un entero mayor que cero`)
  }
  return result
}

module.exports = { text, id, cop, positiveCop, positiveInt, digits, documentNumber, phoneNumber }
