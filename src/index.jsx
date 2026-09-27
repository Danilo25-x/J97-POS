// src/index.jsx
import React    from 'react'
import ReactDOM from 'react-dom/client'
import App      from './App'
import './styles.css'
import { useSettingsStore } from './store/settingsStore'
import { useAuthStore }     from './store/authStore'

// Renderizar inmediatamente — no bloquear por sesión
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Restaurar sesión y configuración en segundo plano
Promise.all([
  useAuthStore.getState().restoreSession(),
  useSettingsStore.getState().loadSettings(),
]).catch(e => console.error('[Bootstrap]', e))