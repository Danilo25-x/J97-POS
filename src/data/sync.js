// src/data/sync.js — sincronización entre la base local y Supabase.
//  1) sube lo pendiente (_dirty=1)  2) baja lo nuevo de otros dispositivos
//  3) reconcilia número de factura y stock  4) sincroniza fotos
// Si no hay internet o sesión, no hace nada: la app sigue funcionando con los datos locales.
import Dexie from 'dexie'
import { db, save, uuid, nowIso, onWrite } from './db.js'
import { setRemoteImageFetcher, isKnownMissing, markMissing } from './images.js'
import { createSupabaseRemote } from './remote.js'

const PUSH_ORDER = ['settings', 'categories', 'brands', 'suppliers', 'customers', 'products', 'product_variants',
  'cash_registers', 'sales', 'sale_items', 'payments', 'invoices', 'cash_expenses', 'inventory_movements',
  'credits', 'credit_payments', 'cash_income', 'audit_logs']
const PULL_ORDER = ['profiles', ...PUSH_ORDER.filter((t) => t !== 'audit_logs')]
const pkOf = (table) => (table === 'settings' ? 'key' : 'id')
const PAGE = 1000, BATCH = 200, EPOCH = '1970-01-01T00:00:00Z'

// ─── Estado visible para la pantalla ────────────────────────
let status = { state: 'idle', pending: 0, lastSync: null, error: null }
const listeners = new Set()
const setStatus = (patch) => { status = { ...status, ...patch }; listeners.forEach((l) => l()) }
export const getSyncStatus = () => status
export const subscribeSync = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export async function countPending() {
  let n = 0
  for (const t of PUSH_ORDER) n += await db.table(t).where('_dirty').equals(1).count()
  n += await db.images.where('uploaded').equals(0).count()
  return n
}
export async function refreshPending() { setStatus({ pending: await countPending() }) }

// ─── Utilidades ─────────────────────────────────────────────
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)$/
/** Supabase devuelve fechas como 2026-10-03T21:48:00.123456+00:00; aquí se guardan siempre en formato ISO con Z. */
function normalize(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' && TS_RE.test(v) ? new Date(v).toISOString() : v
  return out
}
const clean = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')))
/** Convierte el error de Supabase (que no es un Error normal) en un mensaje legible con la tabla afectada. */
function describe(where, e) {
  const parts = [e?.message || 'Error']
  if (e?.details) parts.push(e.details)
  if (e?.hint) parts.push(e.hint)
  const err = new Error(`${where}: ${parts.join(' — ')}${e?.code ? ` (${e.code})` : ''}`)
  err.cause = e
  return err
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// ─── Subir ──────────────────────────────────────────────────
async function markClean(table, pk, sent, returned) {
  const byId = new Map((returned || []).map((r) => [r[pk], normalize(r)]))
  const t = db.table(table)
  await db.transaction('rw', t, async () => {
    for (const row of sent) {
      const cur = await t.get(row[pk])
      if (!cur || cur.updated_at !== row.updated_at) continue   // cambió mientras se subía: sigue pendiente
      await t.put({ ...cur, ...(byId.get(row[pk]) || {}), _dirty: 0 })
    }
  })
}

async function renumberInvoices(remote, rows) {
  const taken = await remote.findInvoices(rows.map((r) => r.invoice_number))
  const clashing = rows.filter((r) => taken.some((t) => t.invoice_number === r.invoice_number && t.id !== r.id))
  if (!clashing.length) return
  clashing.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  for (const sale of clashing) {
    const m = /^(.*)-(\d+)$/.exec(sale.invoice_number)
    if (!m) continue
    const prefix = m[1]
    const remoteMax = await remote.maxInvoice(prefix)
    const remoteN = remoteMax ? Number(/-(\d+)$/.exec(remoteMax)?.[1] || 0) : 0
    const localN = (await db.sales.toArray()).reduce((mx, s) => {
      const mm = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`).exec(s.invoice_number)
      return mm ? Math.max(mx, Number(mm[1])) : mx
    }, 0)
    let n = Math.max(remoteN, localN) + 1
    let candidate = `${prefix}-${String(n).padStart(6, '0')}`
    while ((await remote.findInvoices([candidate])).length) { n += 1; candidate = `${prefix}-${String(n).padStart(6, '0')}` }

    const old = sale.invoice_number
    await save('sales', { ...(await db.sales.get(sale.id)), invoice_number: candidate })
    for (const mv of await db.inventory_movements.filter((x) => x.reference === old).toArray()) {
      await save('inventory_movements', { ...mv, reference: candidate })
    }
    await save('settings', { key: 'invoice_next', value: String(n + 1) })
    sale.invoice_number = candidate
  }
}

// Tablas de las que depende cada tabla (llaves foráneas) y referencias opcionales que se pueden anular si quedaron colgando.
const PARENTS = {
  products: ['categories', 'brands', 'suppliers'], product_variants: ['products'],
  sales: ['cash_registers', 'customers'], sale_items: ['sales', 'product_variants'], payments: ['sales'], invoices: ['sales'],
  cash_expenses: ['cash_registers'], cash_income: ['cash_registers'], inventory_movements: ['product_variants'],
  credits: ['customers', 'sales'], credit_payments: ['credits'],
}
const OPTIONAL_REFS = {
  products: [['category_id', 'categories'], ['brand_id', 'brands'], ['supplier_id', 'suppliers']],
  sales: [['customer_id', 'customers']], sale_items: [['variant_id', 'product_variants']],
}

/**
 * Error 23503 = el servidor no tiene una fila de la que depende (p. ej. alguien borró una categoría en el panel
 * de Supabase). 1) se vuelven a subir las tablas "padre"; 2) si la referencia ni siquiera existe en este
 * dispositivo, se anula (solo en campos opcionales) para no bloquear toda la sincronización.
 */
async function healReferences(remote, table, seen = new Set()) {
  for (const parent of PARENTS[table] || []) {
    if (seen.has(parent)) continue
    seen.add(parent)
    await healReferences(remote, parent, seen)
    await db.table(parent).toCollection().modify((r) => { r._dirty = 1 })
    await pushTable(remote, parent, false)
  }
  for (const [col, parent] of OPTIONAL_REFS[table] || []) {
    for (const row of await db.table(table).where('_dirty').equals(1).toArray()) {
      if (row[col] && !(await db.table(parent).get(row[col]))) await save(table, { ...row, [col]: null })
    }
  }
}

async function pushTable(remote, table, heal = true) {
  const pk = pkOf(table)
  const dirty = await db.table(table).where('_dirty').equals(1).toArray()
  for (const group of chunks(dirty, BATCH)) {
    if (table === 'sales') {
      await renumberInvoices(remote, group)
      for (let i = 0; i < group.length; i++) group[i] = await db.sales.get(group[i].id)
    }
    let returned
    try { returned = await remote.upsert(table, group.map(clean), pk) } catch (e) {
      if (heal && e?.code === '23503') { await healReferences(remote, table); return pushTable(remote, table, false) }
      throw describe(`subir ${table}`, e)
    }
    await markClean(table, pk, group, returned)
  }
}

async function pushImages(remote) {
  for (const rec of await db.images.where('uploaded').equals(0).toArray()) {
    if (rec.deleted || !rec.blob) { await db.images.delete(rec.path); continue }
    await remote.uploadImage(rec.path, rec.blob)
    await db.images.update(rec.path, { uploaded: 1 })
  }
  for (const rec of await db.images.where('uploaded').equals(1).filter((r) => r.deleted).toArray()) {
    await remote.removeImage(rec.path)
    await db.images.delete(rec.path)
  }
}

// ─── Bajar ──────────────────────────────────────────────────
async function pullTable(remote, table) {
  const pk = pkOf(table), t = db.table(table), key = `cursor:${table}`
  let since = (await db.meta.get(key))?.value || EPOCH
  for (;;) {
    const rows = await remote.select(table, { since, limit: PAGE })
    if (!rows.length) break
    await db.transaction('rw', t, async () => {
      for (const r of rows) {
        const row = normalize(r)
        const cur = await t.get(row[pk])
        if (cur?._dirty === 1) continue          // un cambio local pendiente no se pisa
        await t.put({ ...row, _dirty: 0 })
      }
    })
    const last = rows[rows.length - 1].updated_at
    const advanced = last !== since
    since = last
    await db.meta.put({ key, value: since })
    if (rows.length < PAGE || !advanced) break
  }
}

async function prefetchImages(remote, max = 25) {
  const [prods, vars] = await Promise.all([db.products.toArray(), db.product_variants.toArray()])
  // Solo fotos de productos y variantes activos (las de productos eliminados ya no existen en el servidor).
  const wanted = [...new Set([...prods, ...vars].filter((r) => r.is_active).map((r) => r.image_path).filter(Boolean))]
  let done = 0
  for (const path of wanted) {
    if (done >= max) break
    if (isKnownMissing(path) || (await db.images.get(path))) continue
    try {
      const blob = await remote.downloadImage(path)
      if (blob) await db.images.put({ path, blob, uploaded: 1, deleted: 0, updated_at: nowIso() })
      else markMissing(path)       // el servidor aún no la tiene (la sube el otro dispositivo): reintento en 10 min
    } catch { /* se reintenta en el próximo ciclo */ }
    done += 1
  }
}

// ─── Reconciliación ─────────────────────────────────────────
const sumMovements = async () => {
  const sums = new Map()
  for (const m of await db.inventory_movements.toArray()) sums.set(m.variant_id, (sums.get(m.variant_id) || 0) + m.qty)
  return sums
}

/** Datos creados antes de la Fase 4: registra el stock actual como "Saldo inicial" para que stock = suma de movimientos. */
export async function ensureStockLedger() {
  if (await db.meta.get('ledger_v1')) return
  const sums = await sumMovements()
  for (const v of await db.product_variants.toArray()) {
    const diff = v.stock - (sums.get(v.id) || 0)
    if (diff === 0) continue
    await save('inventory_movements', {
      id: uuid(), variant_id: v.id, user_id: null, type: 'ajuste', qty: diff,
      stock_before: sums.get(v.id) || 0, stock_after: v.stock, reference: 'Saldo inicial', notes: null, created_at: v.created_at,
    })
  }
  await db.meta.put({ key: 'ledger_v1', value: true })
}

/** El stock de cada variante es la suma de todos sus movimientos (de todos los dispositivos). */
export async function reconcileStock() {
  const sums = await sumMovements()
  let fixed = 0
  for (const v of await db.product_variants.toArray()) {
    if (!sums.has(v.id)) continue
    const want = Math.max(0, sums.get(v.id))
    if (v.stock !== want) { await save('product_variants', { ...v, stock: want }); fixed += 1 }
  }
  return fixed
}

/** Evita repetir números de factura que otro dispositivo ya usó. */
export async function reconcileInvoiceCounter() {
  const prefix = (await db.settings.get('invoice_prefix'))?.value || 'ZF'
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  let max = 0
  for (const s of await db.sales.toArray()) { const m = re.exec(s.invoice_number); if (m) max = Math.max(max, Number(m[1])) }
  const cur = Number((await db.settings.get('invoice_next'))?.value || 1)
  if (max + 1 > cur) await save('settings', { key: 'invoice_next', value: String(max + 1) })
}

// ─── Ciclo completo ─────────────────────────────────────────
export async function runSync(remote) {
  if (!(await remote.hasSession())) { setStatus({ state: 'signedout' }); return { ok: false, reason: 'signedout' } }
  await remote.ensureProfile?.()           // las llaves foráneas apuntan al perfil del usuario: debe existir en el servidor
  await ensureStockLedger()

  // Un fallo al subir NO debe impedir bajar los datos (p. ej. un dispositivo nuevo): se reporta al final.
  let pushError = null
  try { for (const t of PUSH_ORDER) await pushTable(remote, t) } catch (e) { pushError = e }
  try { await pushImages(remote) } catch (e) { pushError ||= e }   // las fotos se suben aunque falle alguna tabla

  for (const t of PULL_ORDER) {
    try { await pullTable(remote, t) } catch (e) { throw describe(`bajar ${t}`, e) }
  }
  await reconcileInvoiceCounter()
  const fixed = await reconcileStock()
  if (pushError) throw pushError

  if (fixed || (await countPending())) for (const t of PUSH_ORDER) await pushTable(remote, t)
  await prefetchImages(remote)
  return { ok: true }
}

let running = null
let errorAt = 0
export function syncNow(remoteFactory = createSupabaseRemote) {
  if (running) return running
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline' }); return refreshPending().then(() => ({ ok: false, reason: 'offline' }))
  }
  setStatus({ state: 'syncing', error: null })
  running = (async () => {
    try {
      const result = await runSync(remoteFactory())
      if (result.ok) { setStatus({ state: 'idle', lastSync: nowIso(), error: null }); markSynced() }
      await refreshPending()
      return result
    } catch (e) {
      const code = e?.code || e?.cause?.code
      if (code === 'OFFLINE') {                       // sin red: no es un error, se reintentará solo
        setStatus({ state: 'offline', error: null }); await refreshPending().catch(() => {})
        return { ok: false, reason: 'offline' }
      }
      if (code === 'SESSION_EXPIRED') {               // el token no se pudo renovar: hay que entrar de nuevo
        setStatus({ state: 'signedout', error: 'Tu sesión venció. Inicia sesión de nuevo.' }); await refreshPending().catch(() => {})
        return { ok: false, reason: 'signedout' }
      }
      console.error('[sync]', e)
      errorAt = Date.now()
      setStatus({ state: 'error', error: e?.message || 'Error de sincronización' })
      await refreshPending().catch(() => {})
      return { ok: false, error: e?.message }
    } finally { running = null }
  })()
  return running
}

// Sincronización automática: UNA VEZ AL DÍA, o cuando el usuario pulsa "Sincronizar ahora".
// Sincronizar en cada cambio o cada minuto subía las 18 tablas (incluida auditoría) una y otra vez.
const AUTO_SYNC_EVERY_MS = 24 * 60 * 60 * 1000
const LAST_SYNC_KEY = 'j97-last-sync-ms'
const readLastSync = () => Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
const markSynced = () => { try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())) } catch { /* sin almacenamiento: se reintenta al abrir */ } }

/** Tras un error espera 30 s antes de reintentar. Si ya se sincronizó hoy, no hace nada. */
// Límite de seguridad: si un intento automático falla, no se repite antes de 1 hora,
// aunque se recargue la página o se dispare de nuevo. Evita reintentos en cadena.
const LAST_ATTEMPT_KEY = 'j97-last-attempt-ms'
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000
const readLastAttempt = () => Number(localStorage.getItem(LAST_ATTEMPT_KEY) || 0)
const markAttempt = () => { try { localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now())) } catch { /* sin almacenamiento */ } }

export function autoSync() {
  const now = Date.now()
  if (now - readLastSync() < AUTO_SYNC_EVERY_MS) return Promise.resolve({ ok: false, reason: 'not-due' })
  if (now - readLastAttempt() < RETRY_AFTER_FAILURE_MS) return Promise.resolve({ ok: false, reason: 'retry-later' })
  markAttempt()
  return syncNow()
}
/**
 * Se entera de cada cambio local solo para actualizar el contador de "pendientes".
 * No sincroniza: eso ocurre una vez al día o con "Sincronizar ahora".
 * IMPORTANTE: save() se ejecuta dentro de transacciones de Dexie; leer otras tablas desde ahí
 * da NotFoundError, por eso se usa Dexie.ignoreTransaction.
 */
export function installWriteHook() {
  onWrite(() => {
    Dexie.ignoreTransaction(() => { refreshPending().catch(() => {}) })
  })
}

let started = false
export function startAutoSync() {
  if (started || typeof window === 'undefined') return
  started = true
  const factory = () => createSupabaseRemote()
  setRemoteImageFetcher(async (path) => { try { return await factory().downloadImage(path) } catch { return null } })

  installWriteHook()
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  // Revisa cada hora si ya toca sincronizar: solo lo hace si pasó un día desde la última vez.
  setInterval(() => autoSync(), 60 * 60 * 1000)
  refreshPending().catch(() => {})
  autoSync()
}
