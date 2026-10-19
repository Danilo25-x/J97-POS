// src/data/dates.js — fechas en hora local (equivale a DATE(x,'localtime') de SQLite)
const pad = (n) => String(n).padStart(2, '0')
export const localDay = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const localMonth = (iso) => localDay(iso).slice(0, 7)
export const todayLocal = () => localDay(new Date().toISOString())
export const daysAgoLocal = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d.toISOString()) }
/** Marca de tiempo base + i ms: conserva el orden de inserción de ítems y pagos. */
export const tsAt = (base, i) => new Date(base + i).toISOString()
