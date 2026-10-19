// src/components/UI/SyncStatus.jsx — indicador flotante de sincronización (arriba a la derecha).
// Solo aparece con sesión iniciada. Al tocarlo sincroniza en el acto.
import { useSyncExternalStore } from 'react'
import { getSyncStatus, subscribeSync, syncNow } from '../../data/sync'
import { useAuthStore } from '../../store/authStore'

export default function SyncStatus() {
  const user = useAuthStore((s) => s.user)
  const s = useSyncExternalStore(subscribeSync, getSyncStatus)
  if (!user) return null

  const pend = s.pending > 0 ? `${s.pending} pendiente${s.pending === 1 ? '' : 's'}` : ''
  let text = 'Sincronizado', color = 'var(--ok)'
  if (s.state === 'syncing') { text = 'Sincronizando…'; color = 'var(--plum-600)' }
  else if (s.state === 'offline') { text = pend ? `Sin conexión · ${pend}` : 'Sin conexión'; color = 'var(--warn)' }
  else if (s.state === 'error') { text = 'Error al sincronizar · tocar para reintentar'; color = 'var(--bad)' }
  else if (s.state === 'signedout') { text = s.error ? 'Sesión vencida · inicia sesión' : 'Inicia sesión para sincronizar'; color = 'var(--warn)' }
  else if (pend) { text = pend; color = 'var(--warn)' }

  const detail = [s.lastSync && `Última: ${new Date(s.lastSync).toLocaleString('es-CO')}`, s.error].filter(Boolean).join(' — ')

  return (
    <button
      type="button"
      onClick={() => syncNow()}
      title={detail || 'Sincronizar ahora'}
      aria-live="polite"
      style={{
        position: 'fixed', top: 'max(8px, env(safe-area-inset-top))', right: 12, zIndex: 1500,
        display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: 'calc(100vw - 24px)',
        padding: '5px 12px', borderRadius: 999, border: '1px solid var(--line-strong)',
        background: 'var(--surface)', color: 'var(--ink-2)', boxShadow: 'var(--sh-sm)',
        font: '600 12px var(--font-ui)', cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </button>
  )
}
