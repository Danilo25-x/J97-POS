// Crea el único usuario operativo de la instalación.
// No existe un sistema de roles múltiples: todos los usuarios válidos son admin.

const bcrypt = require('bcryptjs')

const INITIAL_ADMIN_PASSWORD = 'admin123'

async function seedDemoData(db) {
  const existing = db.get('SELECT id FROM users WHERE lower(username) = lower(?)', ['admin'])
  if (existing) return { created: false }

  const hash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, 12)

  db.run(
    `INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'admin')`,
    ['Administrador', 'admin', hash]
  )

  console.log('[Seed] Usuario admin inicial creado.')
  return { created: true, username: 'admin', password: INITIAL_ADMIN_PASSWORD }
}

module.exports = { seedDemoData }
