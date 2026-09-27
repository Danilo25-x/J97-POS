export const fmt = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n||0)
export const compact = n => new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1}).format(n||0)
export const fmtDate = s => s ? new Date(s).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'}) : '—'
export const fmtDateMedium = s => s ? new Date(s).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) : '—'
export const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

export const parseCopInput = value => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits ? Number(digits) : 0
}
export const formatCopInput = value => {
  const amount = parseCopInput(value)
  return amount ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(amount) : ''
}
