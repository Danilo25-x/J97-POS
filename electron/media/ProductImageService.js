// electron/media/ProductImageService.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_INPUT_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DATA_PREFIX = 'data:image/webp;base64,'

class ProductImageService {
  constructor(app) {
    this.rootDir = path.join(app.getPath('userData'), 'product-images')
    this.productsDir = path.join(this.rootDir, 'products')
    fs.mkdirSync(this.productsDir, { recursive: true })
  }

  saveDataUrl(dataUrl) {
    if (!dataUrl) return null
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(DATA_PREFIX)) {
      throw new Error('La imagen debe procesarse como WebP antes de guardarse')
    }

    const base64 = dataUrl.slice(DATA_PREFIX.length)
    const estimatedBytes = Math.floor(base64.length * 3 / 4)
    if (!base64 || estimatedBytes > MAX_INPUT_BYTES) {
      throw new Error('La imagen original es demasiado grande')
    }

    // Base64 estricto: evita aceptar cadenas que Buffer.from(..., 'base64')
    // pueda corregir silenciosamente.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
      throw new Error('La imagen no es válida')
    }

    let buffer
    try {
      buffer = Buffer.from(base64, 'base64')
    } catch {
      throw new Error('La imagen no es válida')
    }

    if (!buffer.length || buffer.length > MAX_OUTPUT_BYTES) {
      throw new Error('La imagen procesada supera el tamaño máximo permitido')
    }

    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      throw new Error('El archivo procesado no es un WebP válido')
    }

    const filename = `${crypto.randomUUID()}.webp`
    const relativePath = path.posix.join('products', filename)
    const absolutePath = path.join(this.productsDir, filename)
    const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`

    try {
      // Escritura atómica: nunca dejamos una imagen parcialmente escrita
      // como si fuera un archivo válido.
      fs.writeFileSync(tempPath, buffer, { flag: 'wx' })
      fs.renameSync(tempPath, absolutePath)
      return relativePath
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch {}
      throw new Error(`No se pudo guardar la imagen: ${error.message}`)
    }
  }

  getAbsolutePath(relativePath) {
    if (!relativePath) return null

    const normalized = String(relativePath).replace(/\\/g, '/')
    if (!/^products\/[a-f0-9-]+\.webp$/i.test(normalized)) return null

    const filename = path.basename(normalized)
    const preferred = path.join(this.productsDir, filename)
    if (fs.existsSync(preferred)) return preferred

    // Compatibilidad con imágenes de versiones anteriores.
    const legacy = path.join(this.rootDir, filename)
    return fs.existsSync(legacy) ? legacy : null
  }

  delete(relativePath) {
    const absolutePath = this.getAbsolutePath(relativePath)
    if (!absolutePath) return false
    try {
      fs.unlinkSync(absolutePath)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }

  exists(relativePath) {
    const absolutePath = this.getAbsolutePath(relativePath)
    return Boolean(absolutePath && fs.existsSync(absolutePath))
  }
}

module.exports = ProductImageService
