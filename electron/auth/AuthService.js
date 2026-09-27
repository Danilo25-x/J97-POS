// electron/auth/AuthService.js

const bcrypt         = require('bcryptjs')
const AuthRepository = require('./AuthRepository')
const AuditLogger    = require('./AuditLogger')

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES        = 15

const ADMIN_PERMISSIONS = [
  'dashboard', 'inventory', 'sales', 'billing',
  'customers', 'suppliers', 'cash_register',
  'reports', 'settings'
]

class AuthService {
  constructor(db) {
    this.repo  = new AuthRepository(db)
    this.audit = new AuditLogger(db)
    this.session = null
  }

  async login(username, password) {
    const user = this.repo.findByUsername(username)

    if (!user) return { ok: false, error: 'Credenciales incorrectas' }
    if (!user.is_active) return { ok: false, error: 'Usuario inactivo. Contacta al administrador.' }

    if (user.locked_until) {
      const until = new Date(user.locked_until)
      if (until > new Date()) {
        const mins = Math.ceil((until - new Date()) / 60000)
        return { ok: false, error: `Cuenta bloqueada. Intenta en ${mins} min.` }
      }
    }

    const match = await bcrypt.compare(password, user.password_hash)

    if (!match) {
      const attempts  = user.failed_attempts + 1
      let lockedUntil = null
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const d = new Date()
        d.setMinutes(d.getMinutes() + LOCK_MINUTES)
        lockedUntil = d.toISOString()
      }
      this.repo.updateFailedAttempts(user.id, attempts, lockedUntil)
      this.audit.log(user.id, 'login_failed', 'user', user.id, { username })
      const remaining = MAX_FAILED_ATTEMPTS - attempts
      if (remaining > 0) return { ok: false, error: `Contraseña incorrecta. ${remaining} intento(s) restante(s).` }
      return { ok: false, error: `Cuenta bloqueada por ${LOCK_MINUTES} minutos.` }
    }

    this.repo.resetFailedAttempts(user.id)
    this.audit.log(user.id, 'login_success', 'user', user.id, { username })

    this.session = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: 'admin',
      permissions: ADMIN_PERMISSIONS,
      loginAt: new Date().toISOString()
    }

    return { ok: true, user: this.session }
  }

  logout() {
    if (this.session) {
      this.audit.log(this.session.id, 'logout', 'user', this.session.id, {})
      this.session = null
    }
    return { ok: true }
  }

  getSession() { return this.session }
  isAuthenticated() { return !!this.session }
  hasPermission(permission) { return this.session?.permissions?.includes(permission) ?? false }

  async changePassword(userId, newPassword) {
    if (!this.isAuthenticated()) return { ok: false, error: 'Sesión inválida' }

    const targetId = Number(userId)
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return { ok: false, error: 'Usuario inválido' }
    }

    if (targetId !== this.session.id) {
      return { ok: false, error: 'Solo el administrador activo puede cambiar su propia contraseña' }
    }

    const password = String(newPassword || '')
    if (password.length < 8) {
      return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }
    }

    if (!this.repo.findById(targetId)) {
      return { ok: false, error: 'Usuario no encontrado' }
    }

    const hash = await bcrypt.hash(password, 12)
    this.repo.db.transaction(() => {
      this.repo.updatePassword(targetId, hash)
      this.audit.log(this.session.id, 'change_password', 'user', targetId, {})
    })
    return { ok: true }
  }

  requirePermission(permission) {
    if (!this.hasPermission(permission)) throw new Error(`Sin permiso: ${permission}`)
  }
}

module.exports = AuthService
