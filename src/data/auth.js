// src/data/auth.js — inicio de sesión con Supabase Auth (reemplaza AuthService + bcrypt).
// Supabase ya limita los intentos fallidos, por eso no se replica el bloqueo local.
import { getSupabase } from './supabase.js'
import { db, nowIso } from './db.js'
import { audit } from './audit.js'
import { getUser, setUser, ADMIN_PERMISSIONS } from './session.js'
import { autoSync } from './sync.js'

const CACHE_KEY = 'j97_last_user'

function toUser(authUser, profile) {
  return {
    id: authUser.id,
    name: profile?.name || authUser.user_metadata?.name || String(authUser.email || '').split('@')[0],
    username: authUser.email,
    email: authUser.email,
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    loginAt: nowIso(),
  }
}

async function loadProfile(sb, uid) {
  try {
    const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (data) { await db.profiles.put({ ...data, _dirty: 0 }); return data }
  } catch { /* sin internet: se usa la copia local */ }
  return (await db.profiles.get(uid)) ?? null
}

function cacheUser(u) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(u)) } catch {} }
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') } catch { return null } }
function hasStoredSupabaseSession() {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
  } catch { return false }
}

export async function login({ username, password } = {}) {
  const email = String(username ?? '').trim()
  if (!email || !password) return { ok: false, error: 'Ingresa tu correo y contraseña' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'Necesitas internet para iniciar sesión. Después podrás trabajar sin conexión.' }
  }

  const sb = getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) {
    if (/invalid login/i.test(error.message)) return { ok: false, error: 'Credenciales incorrectas' }
    if (/rate limit|too many/i.test(error.message)) return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' }
    return { ok: false, error: error.message }
  }

  const profile = await loadProfile(sb, data.user.id)
  if (profile && profile.is_active === false) {
    await sb.auth.signOut({ scope: 'local' })
    return { ok: false, error: 'Usuario inactivo. Contacta al administrador.' }
  }

  const user = toUser(data.user, profile)
  setUser(user); cacheUser(user)
  await audit('login_success', 'user', user.id, { username: email })
  autoSync()  // al entrar sincroniza solo si ya pasó un día desde la última vez (o nunca se ha sincronizado)
  return { ok: true, user }
}

export async function logout() {
  const u = getUser()
  if (u) await audit('logout', 'user', u.id, {})
  try { await getSupabase().auth.signOut({ scope: 'local' }) } catch {}
  try { localStorage.removeItem(CACHE_KEY) } catch {}
  setUser(null)
  return { ok: true }
}

/** Recupera la sesión al abrir la app, incluso sin internet. */
export async function getSession() {
  if (getUser()) return { ok: true, user: getUser() }
  try {
    const sb = getSupabase()
    const { data } = await sb.auth.getSession()
    if (data?.session) {
      const profile = await loadProfile(sb, data.session.user.id)
      if (profile?.is_active !== false) {
        const user = toUser(data.session.user, profile)
        setUser(user); cacheUser(user)
        return { ok: true, user }
      }
    }
  } catch { /* se intenta el modo sin conexión */ }

  const cached = readCache()
  if (cached && hasStoredSupabaseSession() && typeof navigator !== 'undefined' && navigator.onLine === false) {
    setUser(cached)
    return { ok: true, user: cached }
  }
  return { ok: true, user: null }
}

export async function changePassword({ newPassword } = {}) {
  if (!getUser()) return { ok: false, error: 'Sesión inválida' }
  const password = String(newPassword || '')
  if (password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'Necesitas internet para cambiar la contraseña' }
  }
  const { error } = await getSupabase().auth.updateUser({ password })
  if (error) return { ok: false, error: error.message }
  await audit('change_password', 'user', getUser().id, {})
  return { ok: true }
}
