// src/pages/Inventory/InventoryPage.jsx
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Shirt, TriangleAlert, PackageX, Coins, Layers, Pencil, Trash2, List, LayoutGrid, PackageSearch } from 'lucide-react'
import PageContainer   from '../../components/UI/PageContainer'
import StatsCard       from '../../components/UI/StatsCard'
import StatusBadge     from '../../components/UI/StatusBadge'
import SearchBar       from '../../components/UI/SearchBar'
import PrimaryButton   from '../../components/UI/PrimaryButton'
import Toast           from '../../components/UI/Toast'
import EmptyState      from '../../components/UI/EmptyState'
import ProductThumb    from '../../components/UI/ProductThumb'
import ProductImageViewer from '../../components/UI/ProductImageViewer'
import ConfirmDialog   from '../../components/UI/ConfirmDialog'
import ProductFormModal from './components/ProductFormModal'
import VariantModal     from './components/VariantModal'
import { fmt } from '../../utils/format'

function stockStatus(s, threshold = 5) {
  if (s === 0) return 'Agotado'
  if (s <= threshold) return 'Bajo'
  return 'Disponible'
}
const pill = (s, threshold = 5) => (s === 0 ? 'bad' : s <= threshold ? 'warn' : 'ok')

export default function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const [stats, setStats]       = useState({ totalProducts: 0, lowStock: 0, outOfStock: 0, inventoryValue: 0, threshold: 5 })
  const [products, setProducts] = useState([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [view, setView]         = useState('list')
  const [catalogs, setCatalogs] = useState({ categories: [], brands: [], suppliers: [] })
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditing]     = useState(null)
  const [variantTarget, setVariantTarget] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [msg, setMsg]           = useState({ text: '', type: 'ok' })
  const [imageToView, setImageToView] = useState(null)

  const notify = (text, type = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: 'ok' }), 3000)
  }

  const loadStats = useCallback(async () => {
    const r = await window.electronAPI.inventory.getStats()
    if (r.ok) setStats(r.data)
  }, [])

  const loadProducts = useCallback(async (q = '') => {
    setLoading(true)
    const r = await window.electronAPI.inventory.getProducts({ search: q, pageSize: 80 })
    if (r.ok) setProducts(r.data.items)
    setLoading(false)
  }, [])

  const loadCatalogs = useCallback(async () => {
    const [cat, brand, sup] = await Promise.all([
      window.electronAPI.inventory.getCategories(),
      window.electronAPI.inventory.getBrands(),
      window.electronAPI.inventory.getSuppliers(),
    ])
    setCatalogs({ categories: cat.ok ? cat.data : [], brands: brand.ok ? brand.data : [], suppliers: sup.ok ? sup.data : [] })
  }, [])

  useEffect(() => { loadStats(); loadProducts(); loadCatalogs() }, [])

  // Acceso directo desde el Inicio: /inventory?new=1 abre el formulario de producto
  useEffect(() => {
    if (params.get('new')) { setEditing(null); setFormOpen(true); setParams({}, { replace: true }) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => loadProducts(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const refresh = () => { loadStats(); loadProducts(search) }

  const confirmDelete = async () => {
    const p = toDelete
    setToDelete(null)
    const r = await window.electronAPI.inventory.deleteProduct(p.id)
    if (r.ok) { notify('Producto desactivado'); refresh() }
    else notify(r.error, 'error')
  }

  const openVariants = p => setVariantTarget({ id: p.id, name: p.name, salePrice: p.sale_price })
  const openEdit = p => { setEditing(p); setFormOpen(true) }

  return (
    <PageContainer
      title="Inventario"
      subtitle="Gestión de productos, variantes y stock"
      action={<PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}><Plus size={18} /> Nuevo producto</PrimaryButton>}
    >
      <Toast msg={msg} />

      <div className="kpis">
        <StatsCard accent title="Productos" value={stats.totalProducts} sub="En el catálogo" icon={<Shirt size={22} />} />
        <StatsCard title="Stock bajo" value={stats.lowStock} sub="Requieren reposición" icon={<TriangleAlert size={22} />} />
        <StatsCard title="Agotados" value={stats.outOfStock} sub="Sin unidades" icon={<PackageX size={22} />} />
        <StatsCard title="Valor del inventario" value={fmt(stats.inventoryValue)} sub="A precio de costo" icon={<Coins size={22} />} />
      </div>

      <div className="card card--flush">
        <div className="card__head">
          <h2 className="card__title">Productos<small>{stats.totalProducts} en total</small></h2>
          <div className="toolbar">
            <SearchBar placeholder="Buscar producto o SKU..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="segmented" role="group" aria-label="Vista">
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /> Lista</button>
              <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={16} /> Tarjetas</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading" role="status"><div className="spinner" />Cargando productos...</div>
        ) : products.length === 0 ? (
          <EmptyState icon={<PackageSearch size={28} />} title="No hay productos"
            text={search ? 'Ningún resultado para esa búsqueda.' : 'Agrega tu primer producto para comenzar.'} />
        ) : view === 'list' ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Producto</th><th>SKU</th><th className="c">Stock</th><th className="r">Precio de venta</th><th>Estado</th><th className="r">Acciones</th></tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <ProductThumb name={p.name} src={p.image_path ? `j97-image:///${p.image_path}` : ""} size="sm" onClick={() => setImageToView({ src: `j97-image:///${p.image_path}`, name: p.name })} />
                        <div>
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">{p.category_name || 'Sin categoría'}{p.variant_count > 0 && ` · ${p.variant_count} variante(s)`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{p.sku}</td>
                    <td className="c"><span className={`stock-pill stock-pill--${pill(p.total_stock, stats.threshold)}`}>{p.total_stock}</span></td>
                    <td className="r num cell-main">{fmt(p.sale_price)}</td>
                    <td><StatusBadge status={stockStatus(p.total_stock, stats.threshold)} /></td>
                    <td>
                      <div className="row-actions">
                        <PrimaryButton size="sm" variant="soft" onClick={() => openVariants(p)}><Layers size={15} /> Variantes</PrimaryButton>
                        <button type="button" className="icon-btn" onClick={() => openEdit(p)} title="Editar" aria-label={`Editar ${p.name}`}><Pencil size={17} /></button>
                        <button type="button" className="icon-btn icon-btn--danger" onClick={() => setToDelete(p)} title="Desactivar" aria-label={`Desactivar ${p.name}`}><Trash2 size={17} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pcards">
            {products.map(p => (
              <article className="pcard" key={p.id}>
                <ProductThumb name={p.name} src={p.image_path ? `j97-image:///${p.image_path}` : ""} onClick={() => setImageToView({ src: `j97-image:///${p.image_path}`, name: p.name })} />
                <div className="pcard__body">
                  <h3 className="pcard__name">{p.name}</h3>
                  <div className="pcard__sub">{p.category_name || 'Sin categoría'} · <span className="mono">{p.sku}</span></div>
                  <div className="pcard__row">
                    <span className="price">{fmt(p.sale_price)}</span>
                    <StatusBadge status={stockStatus(p.total_stock, stats.threshold)} />
                  </div>
                  <div className="pcard__sub">Stock: {p.total_stock}{p.variant_count > 0 && ` · ${p.variant_count} variante(s)`}</div>
                </div>
                <div className="pcard__actions">
                  <PrimaryButton size="sm" variant="soft" onClick={() => openVariants(p)}>Variantes</PrimaryButton>
                  <button type="button" className="icon-btn" onClick={() => openEdit(p)} aria-label={`Editar ${p.name}`}><Pencil size={17} /></button>
                  <button type="button" className="icon-btn icon-btn--danger" onClick={() => setToDelete(p)} aria-label={`Desactivar ${p.name}`}><Trash2 size={17} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {imageToView && <ProductImageViewer src={imageToView.src} name={imageToView.name} onClose={() => setImageToView(null)} />}

      <ProductFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        product={editingProduct}
        catalogs={catalogs}
        onCatalogsChanged={loadCatalogs}
        onSaved={() => { setFormOpen(false); refresh(); notify(editingProduct ? 'Producto actualizado' : 'Producto creado') }}
      />

      <VariantModal
        isOpen={!!variantTarget}
        onClose={() => { setVariantTarget(null); refresh() }}
        productId={variantTarget?.id}
        productName={variantTarget?.name}
        productBasePrice={variantTarget?.salePrice}
      />

      <ConfirmDialog
        isOpen={!!toDelete}
        danger
        title="Desactivar producto"
        text={toDelete ? `“${toDelete.name}” dejará de aparecer en ventas. Podrás verlo en el historial.` : ''}
        confirmLabel="Desactivar"
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  )
}
