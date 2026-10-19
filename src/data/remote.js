// src/data/remote.js — conexión real con Supabase (la sincronización solo usa esta interfaz).
import { getSupabase } from './supabase.js'

const BUCKET = 'product-images'
const coded = (message, code) => Object.assign(new Error(message), { code })
const looksOffline = (e, status) => status === 0 || /failed to fetch|network|load failed|fetch failed/i.test(String(e?.message || ''))
const looksUnauthorized = (e, status) => status === 401 || e?.code === 'PGRST301' || /jwt|expired/i.test(String(e?.message || ''))

// Listado de carpetas del bucket, compartido entre todas las descargas durante 5 minutos.
// Antes se listaba una vez por cada foto (3 peticiones por imagen: listado, preflight y descarga).
const FOLDER_TTL_MS = 5 * 60 * 1000
const folderCache = new Map()
async function listFolder(sb, folder) {
  const hit = folderCache.get(folder)
  if (hit && Date.now() - hit.at < FOLDER_TTL_MS) return hit.names
  const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: 1000 })
  if (error) return null
  const names = new Set((data || []).map((o) => o.name))
  folderCache.set(folder, { names, at: Date.now() })
  return names
}

export function createSupabaseRemote(sb = getSupabase()) {

  /** Ejecuta una consulta. Si el servidor dice "sin autorización" renueva el token y reintenta una vez. */
  async function call(run) {
    let res = await run()
    if (res.error && looksOffline(res.error, res.status)) throw coded('Sin conexión', 'OFFLINE')
    if (res.error && looksUnauthorized(res.error, res.status)) {
      const { data, error } = await sb.auth.refreshSession()
      if (error && looksOffline(error, error.status)) throw coded('Sin conexión', 'OFFLINE')
      if (error || !data?.session) throw coded('Tu sesión venció. Inicia sesión de nuevo.', 'SESSION_EXPIRED')
      res = await run()
      if (res.error && looksUnauthorized(res.error, res.status)) throw coded('Tu sesión venció. Inicia sesión de nuevo.', 'SESSION_EXPIRED')
    }
    if (res.error) throw res.error
    return res.data
  }

  return {
    async hasSession() {
      const { data } = await sb.auth.getSession()
      const s = data?.session
      if (!s) return false
      if ((s.expires_at || 0) * 1000 < Date.now() + 30_000) {          // token por vencer o vencido: renovarlo antes de sincronizar
        const { error } = await sb.auth.refreshSession()
        if (error) {
          if (looksOffline(error, error.status)) throw coded('Sin conexión', 'OFFLINE')
          return false
        }
      }
      return true
    },
    /** Si el perfil del usuario no existe en el servidor (usuario creado antes del esquema), lo crea. */
    async ensureProfile() {
      const { data: auth } = await sb.auth.getSession()
      const u = auth?.session?.user
      if (!u) return
      // Solo consulta. Los perfiles los crea el administrador (RLS no permite que la app los inserte).
      // Si no existe, la sincronización no inserta nada y el usuario ve el aviso correspondiente.
      const found = await call(() => sb.from('profiles').select('id').eq('id', u.id).limit(1))
      return { hasProfile: Boolean(found?.length) }
    },
    select(table, { since, limit }) {
      return call(() => sb.from(table).select('*').gte('updated_at', since)
        .order('updated_at', { ascending: true }).order(table === 'settings' ? 'key' : 'id').limit(limit))
    },
    upsert(table, rows, onConflict) {
      return call(() => sb.from(table).upsert(rows, { onConflict }).select())
    },
    findInvoices(numbers) {
      return call(() => sb.from('sales').select('id,invoice_number').in('invoice_number', numbers))
    },
    async maxInvoice(prefix) {
      const rows = await call(() => sb.from('sales').select('invoice_number').like('invoice_number', `${prefix}-%`)
        .order('invoice_number', { ascending: false }).limit(1))
      return rows?.[0]?.invoice_number ?? null
    },
    async uploadImage(path, blob) {
await call(() => sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/webp', upsert: true }))    },
    async removeImage(path) { await call(() => sb.storage.from(BUCKET).remove([path])) },
    /** Descarga una foto SOLO si existe (se consulta antes: pedir un archivo inexistente deja un error 400 en la consola). */
    async downloadImage(path) {
      const slash = path.lastIndexOf('/')
      const folder = slash > 0 ? path.slice(0, slash) : ''
      const name = path.slice(slash + 1)
      const names = await listFolder(sb, folder)          // una sola consulta por carpeta, no una por foto
      if (!names || !names.has(name)) return null
      const { data, error } = await sb.storage.from(BUCKET).download(path)
      return error ? null : data
    },
  }
}
