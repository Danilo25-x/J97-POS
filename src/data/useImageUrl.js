// src/data/useImageUrl.js — hook para mostrar fotos guardadas en el dispositivo.
import { useEffect, useState } from 'react'
import { getImageUrl } from './images.js'

export function useImageUrl(path) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (path) getImageUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  return url
}

const SCHEME = 'j97-image://'

/** Para <img src=...>: si la dirección es j97-image://, la resuelve a la foto guardada en el dispositivo. */
export function useImageSrc(src) {
  const local = typeof src === 'string' && src.startsWith(SCHEME)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!local) { setUrl(null); return undefined }
    let alive = true
    const path = decodeURIComponent(src.slice(SCHEME.length).replace(/^\/+/, ''))
    // Si no está en el dispositivo (p. ej. Electron), se usa la dirección original.
    getImageUrl(path).then((u) => { if (alive) setUrl(u || src) })
    return () => { alive = false }
  }, [src, local])
  return local ? url : src
}
