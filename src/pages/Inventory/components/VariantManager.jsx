// src/pages/Inventory/components/VariantManager.jsx
import { useEffect, useState } from 'react'
import { Plus, X, ImagePlus } from 'lucide-react'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import { processImage } from '../../../utils/processImage'

export default function VariantManager({ variants, onChange }) {
  const [size, setSize]   = useState('')
  const [color, setColor] = useState('')
  const [stock, setStock] = useState('')
  const [imageData, setImageData] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const add = () => {
    if (!size.trim() || !color.trim()) { setError('Talla y color son obligatorios'); return }
    const dup = variants.some(v => v.size.toLowerCase() === size.trim().toLowerCase() && v.color.toLowerCase() === color.trim().toLowerCase())
    if (dup) { setError('Esa talla y color ya existen'); return }
    onChange([...variants, { size: size.trim(), color: color.trim(), stock: Number(stock) || 0, imageData: imageData || undefined }])
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setSize(''); setColor(''); setStock(''); setImageData(''); setImagePreview(''); setError('')
  }

  const remove = idx => onChange(variants.filter((_, i) => i !== idx))

  const handleImage = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const processed = await processImage(file)
      if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
      setImageData(processed.dataUrl)
      setImagePreview(processed.previewUrl)
      setError('')
    } catch (err) {
      setError(err.message || 'No se pudo procesar la imagen.')
    }
  }

  return (
    <div>
      <div className="chip-row">
        <input className="input input--sm" aria-label="Talla" placeholder="Talla" value={size} onChange={e => setSize(e.target.value)} />
        <input className="input input--sm" aria-label="Color" placeholder="Color" value={color} onChange={e => setColor(e.target.value)} />
        <input className="input input--sm" aria-label="Stock" type="number" min="0" placeholder="Stock" value={stock} onChange={e => setStock(e.target.value)} style={{ maxWidth: 84, flex: 'none' }} />
        <input id="initial-variant-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} style={{ display:'none' }} />
        <label htmlFor="initial-variant-image" className="btn btn--soft btn--sm" style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
          <ImagePlus size={15} /> {imageData ? 'Imagen ✓' : 'Imagen'}
        </label>
        <PrimaryButton size="sm" variant="soft" onClick={add}><Plus size={15} /> Añadir</PrimaryButton>
      </div>
      {error && <p className="field__error" style={{ marginTop: 7 }}>{error}</p>}
      {imagePreview && <div style={{ marginTop: 8, display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--muted)' }}><img src={imagePreview} alt="Vista previa de variante" style={{ width:38, height:38, objectFit:'cover', borderRadius:7 }} /> Imagen de variante seleccionada</div>}
      {variants.length === 0 ? (
        <div className="dashed">Sin variantes aún</div>
      ) : (
        <div className="vlist">
          {variants.map((v, i) => (
            <div key={`${v.size}-${v.color}-${i}`} className="vitem" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {v.imageData ? (
                  <img
                    src={v.imageData}
                    alt={`Imagen ${v.size} ${v.color}`}
                    style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line, #ddd)', flex: '0 0 auto' }}
                  />
                ) : (
                  <div style={{ width: 42, height: 42, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--surface-2, #f4f0f8)', color: 'var(--muted, #777)', flex: '0 0 auto' }}>
                    <ImagePlus size={17} />
                  </div>
                )}
                <span style={{ minWidth: 0 }}><strong>{v.size}</strong> / {v.color} — Stock: {v.stock}{v.imageData ? ' · Imagen' : ''}</span>
              </div>
              <button type="button" className="icon-btn icon-btn--danger" style={{ width: 28, height: 28, flex: '0 0 auto' }} onClick={() => remove(i)} aria-label={`Quitar ${v.size} ${v.color}`}><X size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
