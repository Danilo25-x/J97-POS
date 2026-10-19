// src/data/images.js — fotos de productos guardadas como Blob en el dispositivo.
// (Reemplaza electron/media/ProductImageService.js.) Fase 4: se suben a Supabase Storage.
import { db, uuid, nowIso } from './db.js'

const MAX_INPUT_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DATA_FORMATS = {
  'data:image/webp;base64,': { mime: 'image/webp', ext: 'webp' },
  'data:image/jpeg;base64,': { mime: 'image/jpeg', ext: 'jpg' },   // Safari (iPhone) no genera WebP
}
const urlCache = new Map()
let remoteFetcher = null
const missingUntil = new Map()   // fotos que el servidor no tiene: no se vuelven a pedir durante 10 min
const RETRY_MS = 10 * 60 * 1000
export const isKnownMissing = (path) => (missingUntil.get(path) || 0) > Date.now()
export const markMissing = (path) => { missingUntil.set(path, Date.now() + RETRY_MS) }
/** La sincronización registra cómo descargar una foto que aún no está en este dispositivo. */
export const setRemoteImageFetcher = (fn) => { remoteFetcher = fn }

export async function saveDataUrl(dataUrl) {
  if (!dataUrl) return null
  const prefix = typeof dataUrl === 'string'
    ? Object.keys(DATA_FORMATS).find((p) => dataUrl.startsWith(p))
    : null
  if (!prefix) {
    throw new Error('La imagen debe procesarse como WebP o JPEG antes de guardarse')
  }
  const { mime, ext } = DATA_FORMATS[prefix]
  const base64 = dataUrl.slice(prefix.length)
  if (!base64 || Math.floor(base64.length * 3 / 4) > MAX_INPUT_BYTES) {
    throw new Error('La imagen original es demasiado grande')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error('La imagen no es válida')
  }
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) {
    throw new Error('La imagen procesada supera el tamaño máximo permitido')
  }
  const ascii = (a, b) => String.fromCharCode(...bytes.subarray(a, b))
  const isWebp = bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  if ((mime === 'image/webp' && !isWebp) || (mime === 'image/jpeg' && !isJpeg)) {
    throw new Error('El archivo procesado no es una imagen válida')
  }

  const path = `products/${uuid()}.${ext}`
  await db.images.put({
    path, blob: new Blob([bytes], { type: mime }),
    uploaded: 0, deleted: 0, updated_at: nowIso(),
  })
  return path
}

export async function deleteImage(path) {
  if (!path) return false
  const rec = await db.images.get(path)
  if (!rec) return false
  const cached = urlCache.get(path)
  if (cached) { URL.revokeObjectURL(cached); urlCache.delete(path) }
  if (rec.uploaded) {
    // ya está en Supabase: se conserva la marca para borrarla allá en la sincronización
    await db.images.put({ path, blob: null, uploaded: 1, deleted: 1, updated_at: nowIso() })
  } else {
    await db.images.delete(path)
  }
  return true
}

/** URL local (blob:) para mostrar la foto. Devuelve null si no existe. */
export async function getImageUrl(path) {
  if (!path) return null
  if (urlCache.has(path)) return urlCache.get(path)
  let rec = await db.images.get(path)
  if (!rec && remoteFetcher && !isKnownMissing(path)) {
    try {
      const blob = await remoteFetcher(path)
      if (blob) { rec = { path, blob, uploaded: 1, deleted: 0, updated_at: nowIso() }; await db.images.put(rec) }
      else markMissing(path)
    } catch { /* sin conexión: se mostrará cuando haya internet */ }
  }
  if (!rec?.blob || rec.deleted) return null
  const url = URL.createObjectURL(rec.blob)
  urlCache.set(path, url)
  return url
}
