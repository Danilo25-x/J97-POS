import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
const { saveDataUrl } = await import('../src/data/images.js')
const { installLegacyImageShim } = await import('../src/data/legacyImageShim.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const doc = dom.window.document
let path
const mkImg = (src) => { const i = doc.createElement('img'); i.setAttribute('src', src); return i }

test('la dirección j97-image:// se reemplaza antes de que el navegador la pida', async () => {
  const b = Buffer.alloc(40); b.write('RIFF', 0); b.write('WEBP', 8)
  path = await saveDataUrl('data:image/webp;base64,' + b.toString('base64'))
  installLegacyImageShim(doc)

  const a = mkImg(`j97-image:///${path}`), c = mkImg(`j97-image://${path}`), other = mkImg('https://x.test/a.png')
  assert.match(a.getAttribute('src'), /^data:image\/gif/)         // nunca queda la dirección con esquema desconocido
  assert.equal(other.getAttribute('src'), 'https://x.test/a.png')
  doc.getElementById('root').append(a, c, other)
  await wait(150)
  assert.match(a.getAttribute('src'), /^blob:/); assert.match(c.getAttribute('src'), /^blob:/)
  assert.equal(other.getAttribute('src'), 'https://x.test/a.png')
})

test('si el src cambia mientras carga, gana el nuevo', async () => {
  const i = mkImg(`j97-image://${path}`)
  i.setAttribute('src', 'https://x.test/b.png')
  await wait(100)
  assert.equal(i.getAttribute('src'), 'https://x.test/b.png')
})

test('respaldo: imágenes ya escritas en el HTML', async () => {
  const root = doc.getElementById('root')
  root.innerHTML = `<img id="z" src="j97-image://${path}">`
  await wait(150)
  assert.match(doc.getElementById('z').getAttribute('src'), /^blob:/)
})
