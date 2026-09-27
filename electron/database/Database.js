// electron/database/Database.js
const Database = require('better-sqlite3')
const path     = require('path')
const fs       = require('fs')

class AppDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.db     = null
  }

  connect() {
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(this.dbPath)

    // Configuración de SQLite. Las claves foráneas deben estar activas
    // desde el inicio para que las operaciones posteriores respeten la integridad.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('cache_size = -64000')
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('foreign_keys = ON')

    this.runMigrations()

    console.log('[DB] Conectado:', this.dbPath)
    return this
  }

  runMigrations() {
    // Tabla de control de migraciones
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    const migrationsDir = path.join(__dirname, 'migrations')
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    const applied = this.db
      .prepare('SELECT filename FROM _migrations')
      .all()
      .map(r => r.filename)

    for (const file of files) {
      if (applied.includes(file)) continue

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')

      try {
        // Cada migración y su marca en _migrations deben ser atómicas.
        // Si falla cualquier sentencia, SQLite revierte todo el bloque y
        // la migración podrá reintentarse sin dejar un esquema a medias.
        this.db.transaction(() => {
          this.db.exec(sql)
          this.db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
        })()
      } catch (e) {
        console.error(`[DB] Error en migración ${file}:`, e.message)
        throw new Error(`Migración fallida (${file}): ${e.message}`)
      }

      console.log('[DB] Migración aplicada:', file)
    }
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(params)
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(params)
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(params)
  }

  transaction(fn) {
    return this.db.transaction(fn)()
  }



  async backupToFile(destinationPath) {
    const destination = path.resolve(destinationPath)
    const destinationDir = path.dirname(destination)
    if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true })

    const tempPath = `${destination}.tmp-${process.pid}-${Date.now()}`
    try {
      await this.db.backup(tempPath)
      fs.copyFileSync(tempPath, destination)
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    }

    return destination
  }

  async restoreFromFile(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('Archivo de backup no encontrado')
    }

    const source = path.resolve(sourcePath)
    const target = path.resolve(this.dbPath)
    const tempPath = `${target}.restore-${process.pid}-${Date.now()}`

    // Nunca copiar directamente un SQLite que pueda tener un WAL pendiente.
    // El backup API genera una copia consistente.
    const sourceDb = new Database(source, { readonly: true })
    try {
      const integrity = sourceDb.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') {
        throw new Error('El archivo de backup no pasó la comprobación de integridad')
      }

      await sourceDb.backup(tempPath)
    } finally {
      sourceDb.close()
    }

    this.close()

    try {
      fs.copyFileSync(tempPath, target)
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    }

    this.db = null
    this.connect()
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
      console.log('[DB] Conexión cerrada')
    }
  }

  get instance() {
    return this.db
  }
}

let instance = null

function getDB(dbPath) {
  if (!instance) {
    instance = new AppDatabase(dbPath)
    instance.connect()
  }
  return instance
}

module.exports = { getDB, AppDatabase }