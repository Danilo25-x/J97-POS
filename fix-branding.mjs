// fix-branding.mjs — cambia los textos de J'97 por Zona Fit Orito.
// Uso (en D:\ZonaFit):  node fix-branding.mjs
// Guarda copia de cada archivo modificado en .branding-backup\
import fs from 'node:fs'
import path from 'node:path'

const edits = [
  ['src/components/Layout/Sidebar.jsx', [
    [`storeName || "J'97 Tienda de ropa"`, `storeName || "Zona Fit Orito"`],
  ]],
  ['src/pages/Login/LoginPage.jsx', [
    [`alt="J'97 Tienda de ropa"`, `alt="Zona Fit Orito"`],
    [/J'97 Tienda de Ropa[^<{]*v\{pkg\.version\}/, `Zona Fit Orito`],          // pie del login: sin versión
    [/^import pkg from [^\n]*package\.json[^\n]*\r?\n/m, ``],                   // import que ya no se usa
  ]],
  ['src/pages/Settings/SettingsPage.jsx', [
    [`placeholder: "J'97"`, `placeholder: "Zona Fit Orito"`],
    [`placeholder: 'J97'`, `placeholder: 'ZF'`],
  ]],
  ['src/components/Layout/Header.jsx', [
    [`|| "J'97"`, `|| "Zona Fit Orito"`],
  ]],
]

let changedFiles = 0
for (const [file, pairs] of edits) {
  if (!fs.existsSync(file)) { console.log(`- ${file}: no existe, se omite`); continue }
  const original = fs.readFileSync(file, 'utf8')
  let text = original, n = 0
  for (const [from, to] of pairs) {
    const next = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to)
    if (next !== text) n += 1
    text = next
  }
  if (text === original) { console.log(`= ${file}: sin cambios (ya estaba bien o el texto es distinto)`); continue }
  const backup = path.join('.branding-backup', file)
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.writeFileSync(backup, original)
  fs.writeFileSync(file, text)
  changedFiles += 1
  console.log(`✔ ${file}: ${n} cambio(s)`)
}
console.log(`\nListo: ${changedFiles} archivo(s) modificado(s).`)
