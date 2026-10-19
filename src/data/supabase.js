// src/data/supabase.js — cliente de Supabase (se crea al usarlo por primera vez).
import { createClient } from '@supabase/supabase-js'

let client = null
export function getSupabase() {
  if (!client) {
    const url = import.meta.env?.VITE_SUPABASE_URL
    const key = import.meta.env?.VITE_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Falta configurar Supabase en el archivo .env.local')
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  }
  return client
}
