// src/pages/Inventory/components/VariantModal.jsx
import { useState, useEffect } from 'react'
import { fmt } from '../../../utils/format'
import Modal from '../../../components/UI/Modal'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import { Plus, Pencil, SlidersHorizontal, Trash2, Check, X, ImagePlus, Maximize2 } from 'lucide-react'
import ProductImageViewer from '../../../components/UI/ProductImageViewer'
import { processImage } from '../../../utils/processImage'

const tone = s => (s === 0 ? 'bad' : s <= 5 ? 'warn' : 'ok')

const EMPTY_NEW = { size:'', color:'', stock:'', barcode:'', priceOverride:'', imageData:'', imagePreview:'', removeImage:false }

export default function VariantModal({ isOpen, onClose, productId, productName, productBasePrice }) {
  const [variants, setVariants] = useState([])
  const [loading, setLoading]   = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [imageToView, setImageToView] = useState(null)

  // Formulario de nueva variante
  const [newV, setNewV]         = useState(EMPTY_NEW)
  const [newError, setNewError] = useState('')
  const [addingNew, setAddingNew] = useState(false)

  // Fila en edición
  const [editId, setEditId]     = useState(null)
  const [editData, setEditData] = useState({})

  // Ajuste de stock
  const [adjustId, setAdjustId]     = useState(null)
  const [adjustType, setAdjustType] = useState('entrada')
  const [adjustQty, setAdjustQty]   = useState('')
  const [adjustNote, setAdjustNote] = useState('')

  const load = async () => {
    if (!productId) return false
    setLoading(true)
    try {
      const r = await window.electronAPI.inventory.getVariants(productId)
      if (!r.ok) {
        setGlobalError(r.error || 'No se pudieron cargar las variantes')
        return false
      }
      setVariants(Array.isArray(r.data) ? r.data : [])
      return true
    } catch (error) {
      setGlobalError(error?.message || 'No se pudieron cargar las variantes')
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      setGlobalError(''); setNewV(EMPTY_NEW); setNewError(''); setImageToView(null)
      setEditId(null); setAdjustId(null)
      load()
    }
  }, [isOpen, productId])

  useEffect(() => () => {
    if (newV.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(newV.imagePreview)
    if (editData.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(editData.imagePreview)
  }, [newV.imagePreview, editData.imagePreview])

  // ── Crear variante ──────────────────────────────────────
  const handleAdd = async () => {
    setNewError('')
    if (!newV.size.trim() || !newV.color.trim()) {
      setNewError('Talla y color son obligatorios')
      return
    }
    setAddingNew(true)
    const r = await window.electronAPI.inventory.createVariant({
      productId,
      size:          newV.size.trim(),
      color:         newV.color.trim(),
      stock:         Number(newV.stock) || 0,
      barcode:       newV.barcode.trim() || null,
      priceOverride: newV.priceOverride ? Number(newV.priceOverride) : null,
      imageData:     newV.imageData || undefined,
    })
    setAddingNew(false)
    if (r.ok) {
      if (newV.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(newV.imagePreview)
      setNewV(EMPTY_NEW)
      await load()
    }
    else setNewError(r.error || 'Error al crear variante')
  }

  // ── Guardar edición ─────────────────────────────────────
  const handleSaveEdit = async (id) => {
    const r = await window.electronAPI.inventory.updateVariant({
      id,
      size:          editData.size,
      color:         editData.color,
      barcode:       editData.barcode || null,
      priceOverride: editData.priceOverride ? Number(editData.priceOverride) : null,
      imageData:     editData.imageData || undefined,
      removeImage:   Boolean(editData.removeImage),
    })
    if (r.ok) { setEditId(null); await load() }
    else setGlobalError(r.error || 'Error al guardar')
  }

  // ── Ajustar stock ───────────────────────────────────────
  const handleAdjust = async (id) => {
    const qty = Number(adjustQty)
    if (!qty && adjustType !== 'ajuste') { return }
    const r = await window.electronAPI.inventory.adjustStock({
      variantId: id, type: adjustType, qty,
      notes: adjustNote || 'Ajuste manual',
      reference: 'Inventario',
    })
    if (r.ok) { setAdjustId(null); setAdjustQty(''); setAdjustNote(''); await load() }
    else setGlobalError(r.error || 'Error al ajustar')
  }

  // ── Eliminar ────────────────────────────────────────────
  const handleDelete = async (id) => {
    const r = await window.electronAPI.inventory.deleteVariant(id)
    if (r.ok) await load()
    else setGlobalError(r.error || 'Error al eliminar')
  }

  const setNew = field => e => setNewV(v => ({ ...v, [field]: e.target.value }))
  const setEdit = field => e => setEditData(d => ({ ...d, [field]: e.target.value }))

  const handleNewImage = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const processed = await processImage(file)
      setNewV(v => {
        if (v.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(v.imagePreview)
        return { ...v, imageData: processed.dataUrl, imagePreview: processed.previewUrl, removeImage: false }
      })
    } catch (err) {
      setNewError(err.message || 'No se pudo procesar la imagen.')
    }
  }

  const handleEditImage = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const processed = await processImage(file)
      setEditData(d => {
        if (d.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(d.imagePreview)
        return { ...d, imageData: processed.dataUrl, imagePreview: processed.previewUrl, removeImage: false }
      })
    } catch (err) {
      setGlobalError(err.message || 'No se pudo procesar la imagen.')
    }
  }

  const imageSrc = path => path ? `j97-image:///${path}` : ''

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={`Variantes${productName ? ' — ' + productName : ''}`} width={760}>

      {globalError && <div className="notice notice--bad" role="alert" style={{ marginBottom: 16 }}>{globalError}</div>}

      <div className="panel">
        <div className="section-title" style={{ marginBottom: 12 }}><h2 style={{ fontSize: 15 }}>Agregar variante</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 10, marginBottom: 10 }}>
          <div><label className="minilabel" htmlFor="nv-size">Talla *</label>
            <input id="nv-size" className="input input--sm" placeholder="XS, S, M, L, 32..." value={newV.size} onChange={setNew('size')} onKeyDown={e => e.key === 'Enter' && handleAdd()} /></div>
          <div><label className="minilabel" htmlFor="nv-color">Color *</label>
            <input id="nv-color" className="input input--sm" placeholder="Negro, Blanco, Azul..." value={newV.color} onChange={setNew('color')} onKeyDown={e => e.key === 'Enter' && handleAdd()} /></div>
          <div><label className="minilabel" htmlFor="nv-stock">Stock</label>
            <input id="nv-stock" className="input input--sm" type="number" min="0" placeholder="0" value={newV.stock} onChange={setNew('stock')} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <div><label className="minilabel" htmlFor="nv-price">Precio (vacío = precio del producto)</label>
            <input id="nv-price" className="input input--sm" type="number" min="0" placeholder={productBasePrice ? `Base: ${fmt(productBasePrice)}` : 'Precio especial'} value={newV.priceOverride} onChange={setNew('priceOverride')} /></div>
          <div><label className="minilabel" htmlFor="nv-bar">Código de barras</label>
            <input id="nv-bar" className="input input--sm" placeholder="Opcional" value={newV.barcode} onChange={setNew('barcode')} /></div>
          <div>
            <label className="minilabel">Imagen</label>
            <input id="nv-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleNewImage} style={{ display:'none' }} />
            <label htmlFor="nv-image" className="btn btn--soft btn--sm" style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}><ImagePlus size={15} /> {newV.imageData ? 'Cambiar' : 'Imagen'}</label>
          </div>
          <PrimaryButton size="sm" onClick={handleAdd} disabled={addingNew}><Plus size={16} /> {addingNew ? '...' : 'Añadir'}</PrimaryButton>
        </div>
        {newError && <p className="field__error" style={{ marginTop: 8 }}>{newError}</p>}
      </div>

      {loading ? (
        <div className="loading" role="status"><div className="spinner" />Cargando...</div>
      ) : variants.length === 0 ? (
        <div className="dashed" style={{ padding: 24 }}>Sin variantes aún — agrega la primera arriba</div>
      ) : (
        <>
          <div className="vhead"><div>Imagen</div><div>Talla</div><div>Color</div><div>Stock</div><div>Precio</div><div>Código</div><div style={{ textAlign: 'right' }}>Acciones</div></div>
          <div>
            {variants.map(v => {
              const isEditing = editId === v.id
              const isAdjusting = adjustId === v.id
              return (
                <div key={v.id} className="vrow">
                  <div className="vrow__main">
                    {isEditing ? (
                      <>
                        <div className="vrow__image">
                          {editData.imagePreview ? <img src={editData.imagePreview} alt="Vista previa" /> : <ImagePlus size={16} />}
                          <input id={`ev-image-${v.id}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleEditImage} style={{ display:'none' }} />
                          <label htmlFor={`ev-image-${v.id}`} className="icon-btn" title="Cambiar imagen" style={{ cursor:'pointer' }}><ImagePlus size={15} /></label>
                          {editData.imagePreview && <button type="button" className="icon-btn" title="Quitar imagen propia" onClick={() => setEditData(d => ({ ...d, imageData:'', imagePreview:'', removeImage:true }))}><X size={15} /></button>}
                        </div>
                        <input className="input input--sm" aria-label="Talla" value={editData.size} onChange={setEdit('size')} />
                        <input className="input input--sm" aria-label="Color" value={editData.color} onChange={setEdit('color')} />
                        <div><span className={`stock-pill stock-pill--${tone(v.stock)}`}>{v.stock}</span></div>
                        <input className="input input--sm" aria-label="Precio" type="number" min="0" placeholder={`Base: ${fmt(productBasePrice)}`} value={editData.priceOverride} onChange={setEdit('priceOverride')} />
                        <input className="input input--sm" aria-label="Código de barras" placeholder="Código" value={editData.barcode || ''} onChange={setEdit('barcode')} />
                        <div className="row-actions">
                          <PrimaryButton size="sm" onClick={() => handleSaveEdit(v.id)}><Check size={15} /> Guardar</PrimaryButton>
                          <button type="button" className="icon-btn" onClick={() => setEditId(null)} aria-label="Cancelar edición"><X size={17} /></button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="vrow__image">
                          {v.display_image_path ? <button type="button" className="vimage-btn" onClick={() => setImageToView({ src:imageSrc(v.display_image_path), name:`${productName} — ${v.size} / ${v.color}` })} title="Ampliar imagen"><img src={imageSrc(v.display_image_path)} alt={`Imagen ${v.size} ${v.color}`} /><span><Maximize2 size={12}/></span></button> : <ImagePlus size={17} color="var(--muted)" />}
                        </div>
                        <div className="cell-main">{v.size}</div>
                        <div>{v.color}</div>
                        <div><span className={`stock-pill stock-pill--${tone(v.stock)}`}>{v.stock}</span></div>
                        <div className="num" style={{ color: v.price_override ? 'var(--plum-700)' : 'var(--muted)', fontWeight: v.price_override ? 650 : 400 }}>{v.price_override ? fmt(v.price_override) : 'Base'}</div>
                        <div className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.barcode || '—'}</div>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="Editar" aria-label={`Editar ${v.size} ${v.color}`} onClick={() => {
                            setEditId(v.id)
                            setEditData({ size: v.size, color: v.color, priceOverride: v.price_override || '', barcode: v.barcode || '', imageData: '', imagePreview: v.image_path ? imageSrc(v.image_path) : '', removeImage: false })
                            setAdjustId(null)
                          }}><Pencil size={17} /></button>
                          <button type="button" className="icon-btn" title="Ajustar stock" aria-label={`Ajustar stock ${v.size} ${v.color}`} onClick={() => {
                            setAdjustId(adjustId === v.id ? null : v.id)
                            setAdjustQty(''); setAdjustNote(''); setEditId(null)
                          }}><SlidersHorizontal size={17} /></button>
                          <button type="button" className="icon-btn icon-btn--danger" title="Eliminar" aria-label={`Eliminar ${v.size} ${v.color}`} onClick={() => handleDelete(v.id)}><Trash2 size={17} /></button>
                        </div>
                      </>
                    )}
                  </div>

                  {isAdjusting && (
                    <div className="vrow__adjust">
                      <div><label className="minilabel" htmlFor={`at-${v.id}`}>Tipo</label>
                        <select id={`at-${v.id}`} className="select select--sm" style={{ width: 160 }} value={adjustType} onChange={e => setAdjustType(e.target.value)}>
                          <option value="entrada">Entrada (+)</option><option value="salida">Salida (−)</option><option value="ajuste">Ajuste directo (=)</option>
                        </select></div>
                      <div><label className="minilabel" htmlFor={`aq-${v.id}`}>{adjustType === 'ajuste' ? 'Nuevo stock' : 'Cantidad'}</label>
                        <input id={`aq-${v.id}`} className="input input--sm" style={{ width: 96 }} type="number" min="0" placeholder={adjustType === 'ajuste' ? 'Ej. 10' : 'Ej. 5'} value={adjustQty} onChange={e => setAdjustQty(e.target.value)} /></div>
                      <div style={{ flex: 1, minWidth: 130 }}><label className="minilabel" htmlFor={`an-${v.id}`}>Nota</label>
                        <input id={`an-${v.id}`} className="input input--sm" placeholder="Motivo (opcional)" value={adjustNote} onChange={e => setAdjustNote(e.target.value)} /></div>
                      <PrimaryButton size="sm" onClick={() => handleAdjust(v.id)}>Aplicar</PrimaryButton>
                      <PrimaryButton size="sm" variant="ghost" onClick={() => setAdjustId(null)}>Cancelar</PrimaryButton>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
    {imageToView && <ProductImageViewer src={imageToView.src} name={imageToView.name} onClose={() => setImageToView(null)} />}
    </>
  )
}
