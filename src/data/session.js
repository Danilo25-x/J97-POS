// src/data/session.js — usuario con sesión activa (en memoria).
let user = null
export const getUser = () => user
export const setUser = (u) => { user = u }

export const ADMIN_PERMISSIONS = [
  'dashboard', 'inventory', 'sales', 'billing',
  'customers', 'suppliers', 'cash_register',
  'reports', 'settings',
]

export function requirePermission(permission) {
  if (!user?.permissions?.includes(permission)) throw new Error(`Sin permiso: ${permission}`)
}
