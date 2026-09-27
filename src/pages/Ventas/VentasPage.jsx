// src/pages/Ventas/VentasPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ScanBarcode, X, Minus, Plus, Trash2, Wallet, ShoppingBag, Lock, LockOpen, Receipt, Eye, Shirt, TriangleAlert } from 'lucide-react'
import PageContainer   from '../../components/UI/PageContainer'
import PrimaryButton   from '../../components/UI/PrimaryButton'
import SearchBar       from '../../components/UI/SearchBar'
import StatusBadge     from '../../components/UI/StatusBadge'
import Modal           from '../../components/UI/Modal'
import Toast           from '../../components/UI/Toast'
import EmptyState      from '../../components/UI/EmptyState'
import ProductThumb    from '../../components/UI/ProductThumb'
import ProductImageViewer from '../../components/UI/ProductImageViewer'
import Sprig           from '../../components/UI/Sprig'
import PaymentModal    from './components/PaymentModal'
import SaleDetailModal from './components/SaleDetailModal'
import { fmt, fmtDate } from '../../utils/format'

const GRID_SIZE = 60

function VariantSelector({ variants, productName, onSelect, onClose }) {
  return (
    <Modal isOpen onClose={onClose} title={productName} width={520}>
      <p className="page__sub" style={{ margin: '-8px 0 16px' }}>Elige la talla y el color</p>
      <div className="vgrid">
        {variants.map(v => (
          <button key={v.id} type="button" className="vopt" onClick={() => onSelect(v)} disabled={v.stock === 0}>
            <b>{v.size} / {v.color}</b>
            <small>Stock: {v.stock}</small>
            <em className="num">{fmt(v.unitPrice)}</em>
          </button>
        ))}
      </div>
      <div className="modal__foot" style={{ marginTop: 20 }}>
        <PrimaryButton variant="ghost" onClick={onClose}>Cancelar</PrimaryButton>
      </div>
    </Modal>
  )
}

export default function VentasPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = ['pos', 'historial'].includes(params.get('tab')) ? params.get('tab') : 'pos'
  const setTab = k => setParams(k === 'pos' ? {} : { tab: k }, { replace: true })

  const [caja, setCaja] = useState(null)
  const [cart, setCart] = useState([])
  const [msg, setMsg] = useState({ text: '', type: 'ok' })
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [cat, setCat] = useState('all')
  const [reload, setReload] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [selecting, setSelecting] = useState(null)
  const [paying, setPaying] = useState(false)
  const [historial, setHistorial] = useState([])
  const [detailId, setDetailId] = useState(null)
  const [histSearch, setHistSearch] = useState('')
  const [imageToView, setImageToView] = useState(null)
  const scanRef = useRef(null)

  const notify = useCallback((text, type = 'ok') => { setMsg({ text, type }); setTimeout(() => setMsg({ text: '', type: 'ok' }), 3500) }, [])
  const loadCaja = useCallback(async () => { const r = await window.electronAPI.cash.getOpen(); if (r.ok) setCaja(r.data) }, [])
  const loadHistorial = useCallback(async (s = '') => { const r = await window.electronAPI.sales.getSales({ limit: 100, search: s }); if (r.ok) setHistorial(r.data) }, [])

  useEffect(() => { loadCaja() }, [])
  useEffect(() => {
    window.electronAPI.inventory.getCategories().then(r => { if (r.ok) setCategories(r.data) })
  }, [])
  useEffect(() => { if (tab === 'historial') loadHistorial(histSearch) }, [tab, histSearch])
  useEffect(() => { if (scanning && scanRef.current) scanRef.current.focus() }, [scanning])
  useEffect(() => {
    if (scanning || tab !== 'pos') return
    const t = setTimeout(async () => {
      const r = await window.electronAPI.inventory.getProducts({ search: search.trim(), pageSize: GRID_SIZE })
      if (r.ok) setProducts(r.data.items)
    }, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, scanning, tab, reload])

  const handleScan = async e => {
    if (e.key !== 'Enter') return
    const code = scanInput.trim(); setScanInput('')
    if (!code) return
    const r = await window.electronAPI.sales.scanBarcode(code)
    if (!r.ok) { notify(r.error || 'Código no encontrado', 'error'); return }
    if (r.type === 'variant') {
      addToCart({ variantId: r.data.variantId, productName: r.data.productName, size: r.data.size, color: r.data.color, unitPrice: r.data.unitPrice, maxStock: r.data.stock, imagePath: r.data.imagePath })
    } else if (r.type === 'product_select') {
      setSelecting({ variants: r.variants.map(v => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, unitPrice: v.price_override ?? r.data.sale_price, imagePath: v.display_image_path || r.data.image_path || null })), productName: r.data.name, imagePath: r.data.image_path, fromScan: true })
    }
  }

  const handleSelectVariant = v => {
    addToCart({ variantId: v.id, productName: selecting.productName, size: v.size, color: v.color, unitPrice: v.unitPrice, maxStock: v.stock, imagePath: v.imagePath || selecting.imagePath })
    setSelecting(null)
    if (selecting.fromScan && scanning && scanRef.current) scanRef.current.focus()
  }

  const handleProductClick = async p => {
    const r = await window.electronAPI.inventory.getVariants(p.id)
    if (!r.ok) return
    const variants = r.data.filter(v => v.stock > 0).map(v => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, unitPrice: v.price_override ?? p.sale_price, imagePath: v.display_image_path || p.image_path || null }))
    if (variants.length === 0) { notify('Sin stock disponible', 'warning'); return }
    if (variants.length === 1) addToCart({ variantId: variants[0].id, productName: p.name, size: variants[0].size, color: variants[0].color, unitPrice: variants[0].unitPrice, maxStock: variants[0].stock, imagePath: variants[0].imagePath })
    else setSelecting({ variants, productName: p.name, imagePath: p.image_path, fromScan: false })
  }

  const addToCart = item => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.variantId === item.variantId)
      if (idx >= 0) {
        if (prev[idx].qty >= item.maxStock) { notify(`Stock máximo: ${item.maxStock}`, 'warning'); return prev }
        const u = [...prev]; u[idx] = { ...u[idx], qty: u[idx].qty + 1, lineTotal: (u[idx].qty + 1) * u[idx].unitPrice }; return u
      }
      return [...prev, { ...item, qty: 1, lineTotal: item.unitPrice }]
    })
  }
  const removeFromCart = id => setCart(p => p.filter(i => i.variantId !== id))
  const changeQty = (id, qty) => {
    if (qty < 1) return
    setCart(p => p.map(i => { if (i.variantId !== id) return i; const q = Math.min(qty, i.maxStock); return { ...i, qty: q, lineTotal: q * i.unitPrice } }))
  }
  const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0)
  const units = cart.reduce((s, i) => s + i.qty, 0)

  const confirmSale = async ({ payments, notes, customerId, installments, financingPct }) => {
    setPaying(false)
    const r = await window.electronAPI.sales.createSale({ items: cart.map(i => ({ variantId: i.variantId, qty: i.qty, discountPct: 0 })), payments, notes, customerId, installments, financingPct })
    if (r.ok) { notify(`Venta registrada — ${r.invoice}`); setCart([]); loadCaja(); setReload(n => n + 1) }
    else notify(r.error, 'error')
  }

  const shown = cat === 'all' ? products : products.filter(p => String(p.category_id) === String(cat))
  return (
    <PageContainer
      title="Ventas"
      subtitle="Punto de venta e historial de ventas"
      action={caja
        ? <span className="badge badge--ok">Caja abierta</span>
        : <span className="badge badge--bad">Caja cerrada</span>}
    >
      <Toast msg={msg} />

      <div className="tabs" role="tablist">
        {[['pos', 'Nueva venta'], ['historial', 'Historial']].map(([k, l]) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* ── NUEVA VENTA ── */}
      {tab === 'pos' && (
        <div className="pos">
          <div>
            {!caja && (
              <div className="notice notice--warn" style={{ marginBottom: 16, alignItems: 'center' }}>
                <TriangleAlert size={18} />
                <span style={{ flex: 1 }}><strong>No hay caja abierta.</strong> Ábrela antes de cobrar una venta.</span>
                <PrimaryButton size="sm" variant="ghost" onClick={() => navigate('/cash')}>Abrir caja</PrimaryButton>
              </div>
            )}

            <div className="pos__tools">
              {scanning ? (
                <div className="search" style={{ flex: 1 }}>
                  <ScanBarcode size={18} />
                  <input ref={scanRef} className="input" value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScan}
                    placeholder="Escanea o escribe el código y presiona Enter" aria-label="Código de barras" style={{ borderColor: 'var(--plum-500)' }} />
                </div>
              ) : (
                <SearchBar placeholder="Buscar por nombre o código del producto..." value={search} onChange={e => setSearch(e.target.value)} />
              )}
              <PrimaryButton variant={scanning ? 'primary' : 'soft'} onClick={() => { setScanning(s => !s); setScanInput('') }} aria-pressed={scanning}>
                {scanning ? <><X size={18} /> Salir del lector</> : <><ScanBarcode size={18} /> Escanear código</>}
              </PrimaryButton>
            </div>

            {scanning ? (
              <div className="card scan-box">
                <EmptyState small icon={<ScanBarcode size={28} />} title="Lector activo" text="Apunta el lector USB al código de barras del producto. Se agregará solo al resumen de la venta." />
              </div>
            ) : (
              <>
                {categories.length > 0 && (
                  <div className="chips pos__cats" role="group" aria-label="Categorías">
                    <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>Todas</button>
                    {categories.map(c => <button key={c.id} type="button" className="chip" aria-pressed={String(cat) === String(c.id)} onClick={() => setCat(c.id)}>{c.name}</button>)}
                  </div>
                )}
                {shown.length === 0 ? (
                  <div className="card"><EmptyState icon={<Shirt size={28} />} title={search ? 'Sin resultados' : 'No hay productos'} text={search ? 'Prueba con otro nombre o código.' : 'Agrega productos desde Inventario para empezar a vender.'} /></div>
                ) : (
                  <div className="pgrid">
                    {shown.map(p => {
                      const tone = p.total_stock === 0 ? 'bad' : p.total_stock <= 5 ? 'warn' : ''
                      return (
                        <div key={p.id} className={`ptile ${p.total_stock === 0 ? 'ptile--disabled' : ''}`} role="button" tabIndex={p.total_stock === 0 ? -1 : 0} onClick={() => p.total_stock !== 0 && handleProductClick(p)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && p.total_stock !== 0) { e.preventDefault(); handleProductClick(p) } }}>
                          <div className="ptile__media">
                            <ProductThumb name={p.name} src={p.image_path ? `j97-image:///${p.image_path}` : ''} />
                            {p.image_path && <button type="button" className="ptile__zoom" onClick={e => { e.stopPropagation(); setImageToView({ src: `j97-image:///${p.image_path}`, name: p.name }) }} aria-label={`Ampliar imagen de ${p.name}`} title="Ampliar imagen"><span aria-hidden="true">↗</span></button>}
                          </div>
                          <div className="ptile__name">{p.name}</div>
                          <div className="ptile__foot">
                            <span className="price">{fmt(p.sale_price)}</span>
                            <span className={`stock-txt ${tone ? `stock-txt--${tone}` : ''}`}>{p.total_stock === 0 ? 'Agotado' : `${p.total_stock} uds`}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {products.length >= GRID_SIZE && !search && <p className="page__sub" style={{ marginTop: 14 }}>Mostrando los primeros {GRID_SIZE} productos. Usa el buscador para encontrar otros.</p>}
              </>
            )}
          </div>

          <aside className="card cart" aria-label="Resumen de la venta">
            <div className="card__head">
              <h2 className="card__title">Resumen de la venta</h2>
              <span className={`badge ${cart.length ? '' : 'badge--neutral'}`}>{units} {units === 1 ? 'unidad' : 'unidades'}</span>
            </div>
            <div className="cart__lines">
              {cart.length === 0 ? (
                <EmptyState small icon={<ShoppingBag size={26} />} title="Sin productos aún" text="Toca un producto para agregarlo." />
              ) : cart.map(item => (
                <div key={item.variantId} className="cart__line">
                  <ProductThumb name={item.productName} src={item.imagePath ? `j97-image:///${item.imagePath}` : ''} size="sm" onClick={() => item.imagePath && setImageToView({ src: `j97-image:///${item.imagePath}`, name: item.productName })} />
                  <div>
                    <div className="cart__name">{item.productName}</div>
                    <div className="cart__var">{item.size} / {item.color} · {fmt(item.unitPrice)}</div>
                    <div className="stepper">
                      <button type="button" aria-label="Quitar una unidad" onClick={() => changeQty(item.variantId, item.qty - 1)} disabled={item.qty <= 1}><Minus size={15} /></button>
                      <span>{item.qty}</span>
                      <button type="button" aria-label="Agregar una unidad" onClick={() => changeQty(item.variantId, item.qty + 1)} disabled={item.qty >= item.maxStock}><Plus size={15} /></button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <button type="button" className="icon-btn icon-btn--danger" onClick={() => removeFromCart(item.variantId)} aria-label={`Quitar ${item.productName}`}><Trash2 size={17} /></button>
                    <div className="cart__total-line">{fmt(item.lineTotal)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart__foot">
              <div className="cart__sum"><span>Total</span><strong>{fmt(subtotal)}</strong></div>
              <PrimaryButton size="lg" fullWidth disabled={!caja || cart.length === 0} onClick={() => setPaying(true)}>
                <Wallet size={20} /> {!caja ? 'Abre la caja primero' : 'Cobrar'}
              </PrimaryButton>
              {cart.length > 0 && <button type="button" className="link-btn" style={{ display: 'block', margin: '12px auto 0', color: 'var(--muted)' }} onClick={() => setCart([])}>Limpiar resumen</button>}
            </div>
          </aside>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="card card--flush">
          <div className="card__head">
            <h2 className="card__title">Historial de ventas</h2>
            <SearchBar placeholder="Buscar factura..." value={histSearch} onChange={e => setHistSearch(e.target.value)} />
          </div>
          {historial.length === 0 ? (
            <EmptyState icon={<Receipt size={28} />} title="Sin ventas registradas" text={histSearch ? 'Ninguna factura coincide con tu búsqueda.' : 'Las ventas que hagas aparecerán aquí.'} />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Producto</th><th>Factura</th><th>Fecha</th><th>Cajero</th><th className="r">Total</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {historial.map(s => (
                    <tr key={s.id}>
                      <td><ProductThumb name={s.invoice_number} src={s.image_path ? `j97-image:///${s.image_path}` : ''} size="sm" onClick={() => s.image_path && setImageToView({ src: `j97-image:///${s.image_path}`, name: s.invoice_number })} /></td>
                      <td className="cell-link">{s.invoice_number}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmtDate(s.created_at)}</td>
                      <td>{s.cajero}</td>
                      <td className="r num cell-main">{fmt(s.total)}</td>
                      <td><StatusBadge status={s.status === 'completed' ? 'Completada' : 'Cancelada'} /></td>
                      <td className="r"><PrimaryButton size="sm" variant="ghost" onClick={() => setDetailId(s.id)}><Eye size={16} /> Ver</PrimaryButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {imageToView && <ProductImageViewer src={imageToView.src} name={imageToView.name} onClose={() => setImageToView(null)} />}

      {selecting && <VariantSelector variants={selecting.variants} productName={selecting.productName} onSelect={handleSelectVariant} onClose={() => setSelecting(null)} />}
      {paying && <PaymentModal total={subtotal} onConfirm={confirmSale} onClose={() => setPaying(false)} />}
      {detailId && <SaleDetailModal saleId={detailId} onClose={() => setDetailId(null)} onCancelled={() => loadHistorial(histSearch)} />}
    </PageContainer>
  )
}
