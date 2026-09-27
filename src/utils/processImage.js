const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_SIZE = 800
const MAX_OUTPUT_BYTES = 650 * 1024
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.50]

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  return Math.floor((dataUrl.length - comma - 1) * 3 / 4)
}

function encodeWebp(canvas) {
  for (const quality of QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/webp', quality)
    if (!dataUrl.startsWith('data:image/webp;base64,')) continue
    if (dataUrlBytes(dataUrl) <= MAX_OUTPUT_BYTES) return dataUrl
  }
  return null
}

export function processImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Selecciona una imagen válida.'))
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Formato no permitido. Usa JPG, PNG o WebP.'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('La imagen original no puede superar 10 MB.'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida.'))
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight))
        const width = Math.max(1, Math.round(img.naturalWidth * scale))
        const height = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { alpha: true })
        if (!ctx) return reject(new Error('No fue posible procesar la imagen.'))

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        let dataUrl = encodeWebp(canvas)

        // Si una imagen muy compleja sigue superando el objetivo, reducimos
        // dimensiones antes de fallar. Esto evita guardar archivos enormes.
        if (!dataUrl && Math.max(width, height) > 640) {
          const factor = 640 / Math.max(width, height)
          canvas.width = Math.max(1, Math.round(width * factor))
          canvas.height = Math.max(1, Math.round(height * factor))
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          dataUrl = encodeWebp(canvas)
        }

        if (!dataUrl) {
          return reject(new Error('No se pudo comprimir la imagen a un tamaño seguro.'))
        }

        resolve({
          dataUrl,
          previewUrl: URL.createObjectURL(file),
          width: canvas.width,
          height: canvas.height
        })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
