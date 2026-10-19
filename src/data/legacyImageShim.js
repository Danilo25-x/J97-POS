// src/data/legacyImageShim.js — PUENTE TEMPORAL.
// Algunas pantallas aún piden las fotos con el esquema de Electron (j97-image://...), que el navegador
// no entiende. Aquí se intercepta ese src ANTES de que el navegador intente cargarlo y se reemplaza
// por la foto guardada en el dispositivo. Se elimina cuando todas las pantallas usen useImageUrl().
import { getImageUrl } from './images.js'

const SCHEME = 'j97-image://'
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const toPath = (src) => decodeURIComponent(src.slice(SCHEME.length).replace(/^\/+/, ''))

function resolveInto(img, src) {
  img.__zfSrc = src
  getImageUrl(toPath(src)).then((url) => {
    if (url && img.__zfSrc === src) img.setAttribute('src', url)
  })
}

export function installLegacyImageShim(doc = document) {
  const win = doc.defaultView || window
  const proto = win.Element.prototype

  // 1) React asigna el src con setAttribute: se intercepta antes de la petición de red.
  if (!proto.__zfPatched) {
    const original = proto.setAttribute
    proto.setAttribute = function (name, value) {
      if (this.tagName === 'IMG' && String(name).toLowerCase() === 'src') {
        const v = String(value)
        if (v.startsWith(SCHEME)) {
          original.call(this, 'src', BLANK)
          resolveInto(this, v)
          return
        }
        this.__zfSrc = undefined
      }
      return original.call(this, name, value)
    }
    proto.__zfPatched = true
  }

  // 2) Respaldo: imágenes que ya venían escritas en el HTML.
  const fix = (img) => {
    const src = img.getAttribute('src') || ''
    if (src.startsWith(SCHEME)) { img.setAttribute('src', src) }
  }
  const scan = (root) => root.querySelectorAll?.('img[src^="j97-image:"]').forEach(fix)
  const observer = new win.MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') fix(m.target)
      else m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return
        if (n.tagName === 'IMG') fix(n)
        scan(n)
      })
    }
  })
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  scan(doc)
  return () => observer.disconnect()
}
