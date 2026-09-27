// electron/auth/AuthRepository.js
// El proyecto opera con un único rol: admin.

class AuthRepository {
  constructor(db) { this.db = db }

  findByUsername(username) {
    return this.db.get(
      `SELECT u.*
       FROM users u
       WHERE lower(u.username) = lower(?)`,
      [String(username || '').trim()]
    )
  }

  findById(id) {
    return this.db.get(
      `SELECT * FROM users WHERE id = ?`,
      [id]
    )
  }

  updateFailedAttempts(id, attempts, locked) {
    this.db.run(
      `UPDATE users SET failed_attempts=?, locked_until=?, updated_at=datetime('now') WHERE id=?`,
      [attempts, locked, id]
    )
  }

  resetFailedAttempts(id) {
    this.db.run(
      `UPDATE users SET failed_attempts=0, locked_until=NULL, last_login=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [id]
    )
  }

  updatePassword(id, hash) {
    this.db.run(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`,
      [hash, id]
    )
  }
}

module.exports = AuthRepository
