// src/pages/Inventory/components/ProductFormModal.jsx
import { useState, useEffect, useRef } from 'react'
import Modal from '../../../components/UI/Modal'
import PrimaryButton from '../../../components/UI/PrimaryButton'
import VariantManager from './VariantManager'
import { Info, ImagePlus, X } from 'lucide-react'
import { processImage } from '../../../utils/processImage'

const EMPTY = {
  sku: '', name: '', description: '', categoryId: '',
  costPrice: '', salePrice: '', imageData: '', imagePath: ''
}

function formatCop(value) {
  if (value === '' || value == null) return ''
  const digits = String(value).replace(/\D/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('es-CO')
}

function parseCop(value) {
  const digits = String(value).replace(/\D/g, '')
  return digits ? Number(digits) : ''
}

export default function ProductFormModal({ isOpen, onClose, onSaved, product, catalogs, onCatalogsChanged }) {
  const [form, setForm] = useState(EMPTY)
  const [variants, setVariants] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const [removeImage, setRemoveImage] = useState(false)
  const fileRef = useRef(null)

  const [newCatName, setNewCatName] = useState('')
  const [addingCat, setAddingCat] = useState(false)
  const [savingCat, setSavingCat] = useState(false)
  const [catError, setCatError] = useState('')

  const isEdit = !!product

  useEffect(() => {
    if (product) {
      setForm({
        sku: product.sku || '',
        name: product.name || '',
        description: product.description || '',
        categoryId: product.category_id || '',
        costPrice: product.cost_price ?? '',
        salePrice: product.sale_price ?? '',
        imageData: '',
        imagePath: product.image_path || ''
      })
      setImagePreview(product.image_path ? `j97-image:///${product.image_path}` : '')
    } else {
      setForm(EMPTY)
      setVariants([])
      setImagePreview('')
    }

    setRemoveImage(false)
    setError('')
    setAddingCat(false)
    setNewCatName('')
    setCatError('')
  }, [product, isOpen])

  useEffect(() => () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleImageChange = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError('')

    try {
      const processed = await processImage(file)

      setForm(f => ({
        ...f,
        imageData: processed.dataUrl
      }))
      setImagePreview(processed.previewUrl)
      setRemoveImage(false)
    } catch (err) {
      setError(err.message || 'No se pudo procesar la imagen.')
    }
  }

  const clearImage = () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setImagePreview('')
    setForm(f => ({ ...f, imageData: '', imagePath: '' }))
    setRemoveImage(isEdit)
  }

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) { setCatError('Escribe un nombre'); return }
    setSavingCat(true)
    const r = await window.electronAPI.inventory.createCategory(newCatName.trim())
    setSavingCat(false)
    if (r.ok) {
      await onCatalogsChanged?.()
      setForm(f => ({ ...f, categoryId: r.id }))
      setNewCatName('')
      setAddingCat(false)
      setCatError('')
    } else {
      setCatError(r.error || 'Error al crear categoría')
    }
  }

  const handleSave = async () => {
    setError('')
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    if (!form.sku.trim()) { setError('El SKU es obligatorio'); return }
    if (!form.salePrice) { setError('El precio de venta es obligatorio'); return }

    setSaving(true)

    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      costPrice: Number(form.costPrice) || 0,
      salePrice: Number(form.salePrice) || 0,
      variants: isEdit ? undefined : variants,
      imageData: form.imageData || undefined,
      removeImage
    }

    const r = isEdit
      ? await window.electronAPI.inventory.updateProduct({ id: product.id, ...payload })
      : await window.electronAPI.inventory.createProduct(payload)

    setSaving(false)
    if (r.ok) onSaved()
    else setError(r.error || 'Error al guardar')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar producto' : 'Nuevo producto'} width={600}>
      {error && <div className="notice notice--bad" role="alert" style={{ marginBottom: 18 }}>{error}</div>}

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="pf-sku">SKU *</label>
          <input id="pf-sku" className="input" placeholder="CAM-001" value={form.sku} onChange={set('sku')} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="pf-name">Nombre *</label>
          <input id="pf-name" className="input" placeholder="Camiseta Oversize" value={form.name} onChange={set('name')} />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-desc">Descripción</label>
        <input id="pf-desc" className="input" placeholder="Descripción opcional" value={form.description} onChange={set('description')} />
      </div>

      <div className="field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label className="field__label" htmlFor="pf-cat" style={{ margin: 0 }}>Categoría</label>
          <button type="button" className="link-btn" onClick={() => { setAddingCat(a => !a); setCatError('') }}>
            {addingCat ? 'Cancelar' : '+ Nueva categoría'}
          </button>
        </div>
        {addingCat ? (
          <div>
            <div className="chip-row" style={{ marginBottom: 0 }}>
              <input autoFocus className="input" aria-label="Nombre de la categoría" placeholder="Ej. Camisetas, Jeans..." value={newCatName}
                onChange={e => { setNewCatName(e.target.value); setCatError('') }}
                onKeyDown={e => e.key === 'Enter' && handleCreateCategory()} />
              <button type="button" className="btn btn--primary" onClick={handleCreateCategory} disabled={savingCat}>{savingCat ? '...' : 'Guardar'}</button>
            </div>
            {catError && <p className="field__error">{catError}</p>}
          </div>
        ) : (
          <select id="pf-cat" className="select" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">Sin categoría</option>
            {catalogs.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="pf-cost">Precio de costo</label>
          <input
            id="pf-cost"
            className="input"
            inputMode="numeric"
            placeholder="0"
            value={formatCop(form.costPrice)}
            onChange={e => setForm(f => ({ ...f, costPrice: parseCop(e.target.value) }))}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="pf-price">Precio de venta *</label>
          <input
            id="pf-price"
            className="input"
            inputMode="numeric"
            placeholder="0"
            value={formatCop(form.salePrice)}
            onChange={e => setForm(f => ({ ...f, salePrice: parseCop(e.target.value) }))}
          />
        </div>
      </div>

      <div className="field">
        <span className="field__label">Imagen del producto</span>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div className="product-image-preview" style={{ width: 110, height: 110, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line, #ddd)', display: 'grid', placeItems: 'center', background: '#f7f7f7' }}>
            {imagePreview
              ? <img src={imagePreview} alt="Vista previa del producto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <ImagePlus size={30} strokeWidth={1.4} />}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <PrimaryButton variant="soft" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={16} /> {imagePreview ? 'Cambiar imagen' : 'Seleccionar imagen'}
              </PrimaryButton>
              {imagePreview && (
                <button type="button" className="icon-btn icon-btn--danger" onClick={clearImage} title="Quitar imagen" aria-label="Quitar imagen">
                  <X size={17} />
                </button>
              )}
            </div>
            <small style={{ color: 'var(--muted, #777)' }}>
              JPG, PNG o WebP. Se optimiza automáticamente a WebP, máximo 800 × 800 px.
            </small>
          </div>
        </div>
      </div>

      {!isEdit && (
        <div className="field">
          <span className="field__label">Variantes iniciales (talla + color)</span>
          <VariantManager variants={variants} onChange={setVariants} />
        </div>
      )}

      {isEdit && (
        <div className="notice notice--info" style={{ marginBottom: 16 }}>
          <Info size={18} /> Para gestionar variantes y stock usa el botón “Variantes” en la lista.
        </div>
      )}

      <div className="modal__foot">
        <PrimaryButton variant="ghost" onClick={onClose}>Cancelar</PrimaryButton>
        <PrimaryButton onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear producto'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
