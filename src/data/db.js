// src/data/db.js — base de datos local del dispositivo (IndexedDB vía Dexie).
// Funciona sin internet. Cada fila escrita con save() queda marcada _dirty:1
// para que la sincronización (Fase 4) la suba a Supabase.
import Dexie from 'dexie'

export const db = new Dexie('j97-pos')

db.version(1).stores({
  profiles: 'id,_dirty',
  settings: 'key,_dirty',
  audit_logs: 'id,created_at,_dirty',
  categories: 'id,name,_dirty',
  brands: 'id,name,_dirty',
  suppliers: 'id,name,_dirty',
  customers: 'id,document,name,phone,_dirty',
  products: 'id,sku,barcode,category_id,brand_id,created_at,_dirty',
  product_variants: 'id,product_id,sku_variant,barcode,_dirty',
  inventory_movements: 'id,variant_id,created_at,_dirty',
  cash_registers: 'id,status,_dirty',
  sales: 'id,invoice_number,customer_id,cash_register_id,status,created_at,_dirty',
  sale_items: 'id,sale_id,variant_id,_dirty',
  payments: 'id,sale_id,_dirty',
  invoices: 'id,sale_id,_dirty',
  cash_expenses: 'id,cash_register_id,_dirty',
  credits: 'id,customer_id,sale_id,status,_dirty',
  credit_payments: 'id,credit_id,_dirty',
  cash_income: 'id,cash_register_id,_dirty',
  images: 'path,uploaded',   // fotos de productos (Blob) — se suben a Supabase Storage
  meta: 'key',               // cursores de sincronización
})

export const uuid = () => crypto.randomUUID()
export const nowIso = () => new Date().toISOString()

let writeHook = null
/** La sincronización se registra aquí para enterarse de cada cambio local. */
export const onWrite = (fn) => { writeHook = fn }

/** Guarda una fila y la marca pendiente de sincronizar. */
export async function save(table, row) {
  const r = { ...row, updated_at: nowIso(), _dirty: 1 }
  await db.table(table).put(r)
  try { writeHook?.() } catch { /* nunca debe romper un guardado */ }
  return r
}

/** Quita campos internos antes de entregar una fila a la interfaz. */
export const strip = ({ _dirty, ...row }) => row
