const path = require('path')
const Database = require('better-sqlite3')

const dbPath = path.join(
  process.env.APPDATA,
  'j97-pos',
  'pos-ropa.db'
)

console.log('\n====================================')
console.log(' REVISIÓN DE BASE DE DATOS J97 POS')
console.log('====================================')
console.log('Base de datos:')
console.log(dbPath)

const db = new Database(dbPath, {
  readonly: true
})

const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
  ORDER BY name
`).all()

console.log('\nTABLAS ENCONTRADAS:')
console.table(tables)

const tablesToCheck = [
  'sales',
  'sale_items',
  'payments',
  'cash_registers',
  'credits'
]

for (const table of tablesToCheck) {
  const exists = tables.some(row => row.name === table)

  if (!exists) {
    console.log(`\n=== ${table} ===`)
    console.log('NO EXISTE')
    continue
  }

  console.log(`\n=== ${table} ===`)

  const columns = db.prepare(
    `PRAGMA table_info(${table})`
  ).all()

  console.table(
    columns.map(column => ({
      cid: column.cid,
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      default: column.dflt_value,
      pk: column.pk
    }))
  )
}

db.close()

console.log('\n====================================')
console.log(' Revisión terminada')
console.log('====================================')