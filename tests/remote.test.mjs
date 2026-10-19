import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseRemote } from '../src/data/remote.js'

// Cliente de Supabase simulado: cada consulta devuelve la siguiente respuesta de la cola.
function fakeClient({ responses = [], files = [], failDownload = false, session = true } = {}) {
  const calls = { download: 0, list: 0, refresh: 0, queries: 0 }
  const chain = () => {
    const c = { then: (res, rej) => { calls.queries += 1; return Promise.resolve(responses.shift() ?? { data: [], error: null, status: 200 }).then(res, rej) } }
    for (const m of ['select', 'gte', 'order', 'limit', 'upsert', 'insert', 'eq', 'in', 'like']) c[m] = () => c
    return c
  }
  return {
    calls,
    from: () => chain(),
    auth: {
      getSession: async () => ({ data: { session: session ? { expires_at: Date.now() / 1000 + 3600, user: { id: 'u1', email: 'a@b.co' } } : null } }),
      refreshSession: async () => { calls.refresh += 1; return { data: { session: { user: {} } }, error: null } },
    },
    storage: { from: () => ({
      list: async (folder, opts) => { calls.list += 1; return { data: files.filter((f) => f.includes(opts.search)).map((name) => ({ name })), error: null } },
      download: async () => { calls.download += 1; return failDownload ? { data: null, error: { message: 'x' } } : { data: new Blob(['ok']), error: null } },
    }) },
  }
}

test('fotos: si no existe en el servidor NO se pide (sin error 400 en la consola)', async () => {
  const sb = fakeClient({ files: ['existe.webp'] })
  const r = createSupabaseRemote(sb)
  assert.equal(await r.downloadImage('products/no-existe.webp'), null)
  assert.equal(sb.calls.download, 0)
  assert.ok(await r.downloadImage('products/existe.webp'))
  assert.equal(sb.calls.download, 1)
})

test('401: renueva la sesión y reintenta una vez', async () => {
  const sb = fakeClient({ responses: [{ data: null, error: { code: '42501', message: 'new row violates row-level security policy' }, status: 401 }, { data: [{ id: 'x' }], error: null, status: 201 }] })
  const rows = await createSupabaseRemote(sb).upsert('customers', [{ id: 'x' }], 'id')
  assert.deepEqual(rows, [{ id: 'x' }]); assert.equal(sb.calls.refresh, 1); assert.equal(sb.calls.queries, 2)
})

test('401 persistente: pide iniciar sesión de nuevo (no queda como error técnico)', async () => {
  const bad = { data: null, error: { code: '42501', message: 'rls' }, status: 401 }
  const sb = fakeClient({ responses: [bad, bad] })
  await assert.rejects(createSupabaseRemote(sb).upsert('customers', [{ id: 'x' }], 'id'), (e) => e.code === 'SESSION_EXPIRED')
})

test('sin conexión se reporta como OFFLINE', async () => {
  const sb = fakeClient({ responses: [{ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }] })
  await assert.rejects(createSupabaseRemote(sb).select('customers', { since: 'x', limit: 5 }), (e) => e.code === 'OFFLINE')
})

test('error normal (p. ej. llave foránea) se propaga con su código', async () => {
  const sb = fakeClient({ responses: [{ data: null, error: { code: '23503', message: 'fk' }, status: 409 }] })
  await assert.rejects(createSupabaseRemote(sb).upsert('products', [{ id: 'x' }], 'id'), (e) => e.code === '23503')
})
