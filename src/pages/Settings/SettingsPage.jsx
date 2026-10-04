// src/pages/Settings/SettingsPage.jsx
import { useEffect, useState } from 'react'
import { Store, Receipt, Boxes, DatabaseBackup, Check, Upload, ShieldCheck, LockKeyhole, CloudUpload, RefreshCw } from 'lucide-react'
import PageContainer from '../../components/UI/PageContainer'
import PrimaryButton from '../../components/UI/PrimaryButton'
import Toast from '../../components/UI/Toast'
import { useSettingsStore } from '../../store/settingsStore'

const FIELDS = [
  { key: 'store_name',    label: 'Nombre del local',          placeholder: "J'97",             group: 'Negocio' },
  { key: 'store_nit',     label: 'NIT / Identificación',      placeholder: '900.123.456-7',    group: 'Negocio' },
  { key: 'store_address', label: 'Dirección',                 placeholder: 'Calle 10 # 5-20',  group: 'Negocio' },
  { key: 'store_phone',   label: 'Teléfono',                  placeholder: '300 123 4567',     group: 'Negocio' },
  { key: 'store_email',   label: 'Correo electrónico',        placeholder: 'tienda@email.com', group: 'Negocio' },
  { key: 'invoice_prefix', label: 'Prefijo de factura',       placeholder: 'J97',              group: 'Facturación' },
  { key: 'invoice_next',  label: 'Próximo número de factura', placeholder: '1',                group: 'Facturación', type: 'number' },
  { key: 'tax_rate',      label: 'Tasa de impuesto (%)',      placeholder: '0',                group: 'Facturación', type: 'number' },
  { key: 'low_stock_threshold', label: 'Alerta de stock bajo (unidades)', placeholder: '5',  group: 'Inventario', type: 'number' },
  { key: 'supabase_url',       label: 'URL del proyecto Supabase',  placeholder: 'https://xxxxx.supabase.co', group: 'Nube' },
  { key: 'supabase_anon_key',  label: 'Llave "anon" de Supabase',   placeholder: 'eyJhbGciOi...',             group: 'Nube', type: 'password' },
]

const SECTIONS = [
  { key: 'Seguridad',   label: 'Seguridad',           icon: LockKeyhole,    desc: 'Cambia la contraseña del administrador cuando lo necesites.' },
  { key: 'Negocio',     label: 'Datos de la tienda', icon: Store,          desc: 'Información que aparece en tus facturas.' },
  { key: 'Facturación', label: 'Facturación',        icon: Receipt,        desc: 'Numeración e impuestos de las facturas.' },
  { key: 'Inventario',  label: 'Inventario',         icon: Boxes,          desc: 'Cuándo avisar que un producto se está agotando.' },
  { key: 'Respaldo',    label: 'Copia de seguridad', icon: DatabaseBackup, desc: 'Protege la información de tu negocio.' },
  { key: 'Nube',        label: 'Respaldo en la nube', icon: CloudUpload,   desc: 'Sube una copia de productos y ventas a Supabase cuando haya internet.' },
]

export default function SettingsPage() {
  const [section, setSection]   = useState('Negocio')
  const [settings, setSettings] = useState({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [msg, setMsg]           = useState({ text: '', type: 'ok' })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)
  const loadSettings = useSettingsStore(s => s.loadSettings)

  useEffect(() => {
    window.electronAPI.settings.getAll().then(r => { if (r.ok) setSettings(r.data) })
    window.electronAPI.sync.getStatus().then(r => { if (r.ok) setSyncStatus(r.data) })
  }, [])

  const notify = (text, type = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: 'ok' }), 3000)
  }

  const saveSection = async () => {
    setSaving(true)
    const fields = FIELDS.filter(f => f.group === section)
    for (const f of fields) {
      const res = await window.electronAPI.settings.set({ key: f.key, value: settings[f.key] || '' })
      if (!res.ok) { setSaving(false); notify(res.error || `No se pudo guardar “${f.label}”`, 'error'); return }
    }
    if (fields.some(f => f.key === 'store_name')) loadSettings()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    notify('Cambios guardados')
  }

  const handleChangePassword = async () => {
    const password = String(newPassword || '')
    const confirmation = String(confirmPassword || '')

    if (password.length < 8) {
      notify('La contraseña debe tener al menos 8 caracteres', 'error')
      return
    }

    if (password !== confirmation) {
      notify('Las contraseñas no coinciden', 'error')
      return
    }

    setChangingPassword(true)

    try {
      const session = await window.electronAPI.auth.getSession()
      if (!session.ok || !session.user?.id) {
        notify('La sesión no es válida. Inicia sesión nuevamente.', 'error')
        return
      }

      const result = await window.electronAPI.auth.changePassword({
        userId: session.user.id,
        newPassword: password,
      })

      if (!result.ok) {
        notify(result.error || 'No se pudo cambiar la contraseña', 'error')
        return
      }

      setNewPassword('')
      setConfirmPassword('')
      notify('Contraseña actualizada correctamente')
    } catch (error) {
      notify(error?.message || 'No se pudo cambiar la contraseña', 'error')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleBackup = async () => {
    const r = await window.electronAPI.settings.backup()
    if (r.ok) notify(`Copia guardada en: ${r.path}`)
    else if (!r.cancelled) notify(r.error || 'Error al crear la copia de seguridad', 'error')
  }

  const handleRestore = async () => {
    const confirmed = window.confirm('Restaurar una copia reemplazará los datos actuales por los datos del archivo seleccionado. Esta acción no se puede deshacer. ¿Deseas continuar?')
    if (!confirmed) return
    const r = await window.electronAPI.settings.restore()
    if (r.ok) {
      notify('Copia restaurada correctamente. Recargando la sesión...')
      setTimeout(() => window.location.reload(), 700)
    } else if (!r.cancelled) notify(r.error || 'Error al restaurar la copia', 'error')
  }

  const toggleSync = async (checked) => {
    const r = await window.electronAPI.settings.set({ key: 'sync_enabled', value: checked ? '1' : '0' })
    if (r.ok) setSettings(s => ({ ...s, sync_enabled: checked ? '1' : '0' }))
    else notify(r.error || 'No se pudo cambiar la sincronización', 'error')
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    const r = await window.electronAPI.sync.runNow()
    setSyncing(false)
    setSyncStatus(r)
    if (r.ok) notify(`Sincronizado: ${r.products} productos, ${r.variants} variantes, ${r.sales} ventas`)
    else notify(r.reason || r.error || 'No se pudo sincronizar', 'error')
  }

  const current = SECTIONS.find(s => s.key === section)
  const fields = FIELDS.filter(f => f.group === section)

  return (
    <PageContainer title="Configuración" subtitle="Datos del negocio y preferencias del sistema">
      <Toast msg={msg} />
      <div className="settings">
        <nav className="card subnav" aria-label="Secciones de configuración">
          {SECTIONS.map(s => (
            <button key={s.key} type="button" aria-current={section === s.key} onClick={() => setSection(s.key)}>
              <s.icon size={19} /> {s.label}
            </button>
          ))}
        </nav>

        <section className="card">
          <div className="section-title" style={{ marginBottom: 4 }}><h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>{current.label}</h2></div>
          <p className="page__sub" style={{ marginBottom: 22 }}>{current.desc}</p>

          {section === 'Seguridad' ? (
            <>
              <div className="notice notice--info" style={{ marginBottom: 18 }}>
                <ShieldCheck size={18} />
                <span>La aplicación funciona con un único administrador. Puedes cambiar su contraseña en cualquier momento.</span>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="field__label" htmlFor="new-admin-password">Nueva contraseña</label>
                  <input
                    id="new-admin-password"
                    className="input"
                    type="password"
                    value={newPassword}
                    autoComplete="new-password"
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="confirm-admin-password">Confirmar contraseña</label>
                  <input
                    id="confirm-admin-password"
                    className="input"
                    type="password"
                    value={confirmPassword}
                    autoComplete="new-password"
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                  />
                </div>
              </div>
              <div className="settings__foot">
                <PrimaryButton
                  onClick={handleChangePassword}
                  disabled={changingPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword ? 'Actualizando...' : <><LockKeyhole size={18} /> Cambiar contraseña</>}
                </PrimaryButton>
              </div>
            </>
          ) : section === 'Nube' ? (
            <>
              <div className="notice notice--info" style={{ marginBottom: 18 }}>
                <ShieldCheck size={18} /> <span>Solo es un respaldo: tu computador sigue siendo el único lugar donde se procesan ventas. Si no hay internet, la app sigue funcionando igual y sincroniza después.</span>
              </div>
              <div className="form-grid">
                {fields.map(f => (
                  <div className="field" key={f.key}>
                    <label className="field__label" htmlFor={f.key}>{f.label}</label>
                    <input id={f.key} className="input" type={f.type || 'text'} value={settings[f.key] || ''} placeholder={f.placeholder}
                      onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="field" style={{ marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.sync_enabled === '1'} onChange={e => toggleSync(e.target.checked)} />
                  Activar sincronización automática (cada 20 minutos, si hay internet)
                </label>
              </div>
              <div className="settings__foot" style={{ gap: 10, display: 'flex', flexWrap: 'wrap' }}>
                <PrimaryButton onClick={saveSection} disabled={saving}>
                  {saved ? <><Check size={18} /> Guardado</> : saving ? 'Guardando...' : 'Guardar credenciales'}
                </PrimaryButton>
                <PrimaryButton variant="soft" onClick={handleSyncNow} disabled={syncing}>
                  <RefreshCw size={16} /> {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
                </PrimaryButton>
              </div>
              {syncStatus && (
                <p className="page__sub" style={{ marginTop: 14 }}>
                  {syncStatus.skipped
                    ? syncStatus.reason
                    : syncStatus.ok
                      ? `Última sincronización: ${syncStatus.at ? new Date(syncStatus.at).toLocaleString('es-CO') : '—'} · ${syncStatus.products} productos, ${syncStatus.variants} variantes, ${syncStatus.sales} ventas`
                      : `Último intento falló: ${syncStatus.errors?.join(', ') || 'error desconocido'}`}
                </p>
              )}
            </>
          ) : section !== 'Respaldo' ? (
            <>
              <div className="form-grid">
                {fields.map(f => (
                  <div className="field" key={f.key}>
                    <label className="field__label" htmlFor={f.key}>{f.label}</label>
                    <input id={f.key} className="input" type={f.type || 'text'} value={settings[f.key] || ''} placeholder={f.placeholder}
                      onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="settings__foot">
                <PrimaryButton onClick={saveSection} disabled={saving}>
                  {saved ? <><Check size={18} /> Guardado</> : saving ? 'Guardando...' : 'Guardar cambios'}
                </PrimaryButton>
              </div>
            </>
          ) : (
            <>
              <div className="notice notice--info" style={{ marginBottom: 18 }}>
                <ShieldCheck size={18} /> <span>La copia contiene la base de datos del negocio. Ahora puedes elegir exactamente dónde guardarla y seleccionar un archivo existente para restaurarlo.</span>
              </div>
              <div className="page__actions">
                <PrimaryButton onClick={handleBackup}><DatabaseBackup size={18} /> Crear copia y elegir ubicación</PrimaryButton>
                <PrimaryButton variant="soft" onClick={handleRestore}><Upload size={18} /> Restaurar copia</PrimaryButton>
              </div>
            </>
          )}
        </section>
      </div>
    </PageContainer>
  )
}
