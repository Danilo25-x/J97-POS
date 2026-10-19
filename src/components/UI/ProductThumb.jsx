import { Shirt, Maximize2 } from 'lucide-react'
import { useImageSrc } from '../../data/useImageUrl'

const TINTS = [['#efe6f7', '#d9c4ec'], ['#fbe6f1', '#f4c3dc'], ['#e9e4fb', '#cfc4f3'], ['#f6e4f8', '#e6bdee'], ['#e7eaf9', '#c9d1f2']]
const hash = s => [...(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

// Miniatura reutilizable. Cuando se proporciona onClick, la imagen puede ampliarse.
export default function ProductThumb({ name, src: rawSrc, size = 'md', onClick }) {
  const src = useImageSrc(rawSrc)
  const [a, b] = TINTS[hash(name) % TINTS.length]
  const content = src ? <img src={src} alt={`Imagen de ${name}`} /> : <Shirt strokeWidth={1.2} />

  if (!onClick || !src) {
    return (
      <div className={`thumb thumb--${size}`} style={{ background: `linear-gradient(145deg,${a},${b})` }} aria-hidden={src ? undefined : 'true'}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`thumb thumb--${size} thumb--clickable`}
      style={{ background: `linear-gradient(145deg,${a},${b})` }}
      onClick={e => { e.stopPropagation(); onClick() }}
      title={`Ampliar imagen de ${name}`}
      aria-label={`Ampliar imagen de ${name}`}
    >
      {content}
      <span className="thumb__zoom" aria-hidden="true"><Maximize2 size={size === 'sm' ? 13 : 17} /></span>
    </button>
  )
}
