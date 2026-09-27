// src/store/authStore.js
import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
  user:    null,
  loading: false,
  error:   null,

  clearError: () => set({ error: null }),

  restoreSession: async () => {
    set({ loading: true })
    try {
      const r = await window.electronAPI.auth.getSession()
      set({ user: r?.user || null, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },

  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      const r = await window.electronAPI.auth.login({ username, password })
      if (r.ok) {
        set({ user: r.user, loading: false, error: null })
        return { ok: true }
      } else {
        set({ error: r.error, loading: false })
        return { ok: false, error: r.error }
      }
    } catch (e) {
      set({ error: e.message, loading: false })
      return { ok: false, error: e.message }
    }
  },

  logout: async () => {
    try { await window.electronAPI.auth.logout() } catch {}
    set({ user: null, error: null, loading: false })
  },

  hasPermission: (permission) =>
    get().user?.permissions?.includes(permission) ?? false,
}))
