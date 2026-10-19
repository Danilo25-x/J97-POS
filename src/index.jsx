// src/index.jsx — J97
import React    from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/montserrat'
import App      from './App'
import SyncStatus from './components/UI/SyncStatus'
import './styles.css'
import { applyTheme, getTheme } from './utils/theme'
applyTheme(getTheme())
import { installWebApi }    from './data/api'
import { installLegacyImageShim } from './data/legacyImageShim'
import { useSettingsStore } from './store/settingsStore'
import { useAuthStore }     from './store/authStore'

// Tras publicar una versión nueva, una pestaña abierta puede pedir un archivo viejo que ya no existe
// (404 → pantalla en blanco). Si pasa, se recarga una sola vez para tomar la versión nueva.
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem('j97_chunk_reload') || 0)
    if (Date.now() - last < 15000) return            // evita bucles de recarga
    sessionStorage.setItem('j97_chunk_reload', String(Date.now()))
  } catch { /* sessionStorage no disponible */ }
  window.location.reload()
}
window.addEventListener('vite:preloadError', (event) => { event.preventDefault(); reloadOnce() })
window.addEventListener('unhandledrejection', (event) => {
  if (/dynamically imported module|Importing a module script failed/i.test(String(event.reason?.message || event.reason))) {
    event.preventDefault(); reloadOnce()
  }
})

async function start() {
  // En el navegador no existe window.electronAPI: se crea con la base local + Supabase.
  const web = await installWebApi()
  if (web) installLegacyImageShim()   // puente temporal para las fotos
  // Pide al navegador (sobre todo Safari) que no borre los datos locales
  try { await navigator.storage?.persist?.() } catch {}

  // Restaura la sesión ANTES de pintar: así al recargar no se ve el login un instante.
  // (Máximo 3 s de espera; si tarda más, la sesión se aplica cuando llegue.)
  try {
    await Promise.race([
      useAuthStore.getState().restoreSession(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
  } catch (e) { console.error('[Bootstrap:sesión]', e) }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
      <SyncStatus />
    </React.StrictMode>
  )

  useSettingsStore.getState().loadSettings().catch(e => console.error('[Bootstrap:ajustes]', e))
}

start()
