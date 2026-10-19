// src/data/cash.js — port de electron/ipc/CashHandlers.js
import { db, uuid, nowIso, save, strip } from './db.js'
import { getUser } from './session.js'
import { audit } from './audit.js'
import { cop, positiveCop } from './validation.js'

class Biz extends Error {}
const fail = (msg) => { throw new Biz(msg) }
const TX = () => [db.cash_registers, db.cash_expenses, db.cash_income, db.audit_logs]
const sum = (rows, f = (x) => x.amount) => rows.reduce((s, r) => s + Number(f(r) || 0), 0)
const byAsc = (a, b) => String(a.created_at).localeCompare(String(b.created_at))

async function names() { return new Map((await db.profiles.toArray()).map((p) => [p.id, p.name])) }
const openRegister_ = () => db.cash_registers.where('status').equals('open').first()

async function totalsFor(registerId) {
  const sales = (await db.sales.where('cash_register_id').equals(registerId).toArray()).filter((s) => s.status === 'completed')
  const pays = sales.length ? await db.payments.where('sale_id').anyOf(sales.map((s) => s.id)).toArray() : []
  const by = (m) => sum(pays.filter((p) => p.method === m))
  return {
    cash_sales: by('efectivo'), transfer_sales: by('transferencia'),
    credit_sales: by('credito'), sistecredito_sales: by('sistecredito'),
    total_sales: sum(pays), num_sales: new Set(pays.map((p) => p.sale_id)).size,
  }
}

async function collectionsFor(registerId) {
  const rows = (await db.cash_income.where('cash_register_id').equals(registerId).toArray()).filter((r) => r.source === 'credit_payment')
  return {
    credit_collection_cash: sum(rows.filter((r) => r.payment_method === 'efectivo')),
    credit_collection_transfer: sum(rows.filter((r) => r.payment_method === 'transferencia')),
    total_credit_collections: sum(rows),
  }
}

async function expensesFor(registerId, order = 'DESC') {
  const [rows, nm] = await Promise.all([db.cash_expenses.where('cash_register_id').equals(registerId).toArray(), names()])
  const list = rows.sort(byAsc).map((e) => ({ ...strip(e), user_name: nm.get(e.user_id) ?? null }))
  if (order === 'DESC') list.reverse()
  return { total: sum(rows), list }
}

const expectedCash = (caja, t, c, g) => caja.opening_amount + t.cash_sales + c.credit_collection_cash - g.total

export async function openRegister({ openingAmount } = {}) {
  try {
    return await db.transaction('rw', TX(), async () => {
      if (await openRegister_()) fail('Ya hay una caja abierta')
      const userId = getUser()?.id
      if (!userId) fail('Sesión inválida')
      let amount
      try { amount = cop(openingAmount, 'Efectivo inicial') } catch (e) { fail(e.message) }
      const id = uuid()
      await save('cash_registers', {
        id, user_id: userId, opening_amount: amount, opened_at: nowIso(), closed_at: null, status: 'open',
        closing_amount: null, expected_amount: null, difference: null,
        total_sales: 0, total_expenses: 0, cash_sales: 0, transfer_sales: 0, credit_sales: 0, sistecredito_sales: 0,
        credit_collection_cash: 0, credit_collection_transfer: 0, total_credit_collections: 0, notes: null,
      })
      await audit('open_cash', 'cash_register', id, { opening_amount: amount })
      return { ok: true, id }
    })
  } catch (e) {
    if (e instanceof Biz) return { ok: false, error: e.message }
    console.error('[cash:open]', e); return { ok: false, error: 'Error al abrir la caja' }
  }
}

export async function getOpen() {
  const caja = await openRegister_()
  if (!caja) return { ok: true, data: null }
  const [t, c, g, nm] = await Promise.all([totalsFor(caja.id), collectionsFor(caja.id), expensesFor(caja.id), names()])
  return {
    ok: true,
    data: { ...strip(caja), cajero: nm.get(caja.user_id) ?? null, ...t, ...c, total_expenses: g.total, expected_cash: expectedCash(caja, t, c, g), expenses_list: g.list },
  }
}

export async function getClosePreview() {
  const caja = await openRegister_()
  if (!caja) return { ok: false, error: 'No hay caja abierta' }
  const [t, c, g, nm] = await Promise.all([totalsFor(caja.id), collectionsFor(caja.id), expensesFor(caja.id, 'ASC'), names()])
  return {
    ok: true,
    data: { caja: { ...strip(caja), cajero: nm.get(caja.user_id) ?? null }, totales: { ...t, ...c }, total_expenses: g.total, expected_cash: expectedCash(caja, t, c, g), expenses_list: g.list },
  }
}

export async function closeRegister({ closingAmount, notes } = {}) {
  try {
    return await db.transaction('rw', [...TX(), db.sales, db.payments, db.profiles, db.settings], async () => {
      const caja = await openRegister_()
      if (!caja) fail('No hay caja abierta')
      const userId = getUser()?.id
      if (!userId) fail('Sesión inválida')
      const [t, c, g] = await Promise.all([totalsFor(caja.id), collectionsFor(caja.id), expensesFor(caja.id, 'ASC')])
      const expected = expectedCash(caja, t, c, g)
      let closing
      try { closing = cop(closingAmount, 'Dinero contado') } catch (e) { fail(e.message) }
      const diff = closing - expected

      const closed = await save('cash_registers', {
        ...caja, status: 'closed', closed_at: nowIso(), closing_amount: closing, expected_amount: expected, difference: diff,
        cash_sales: t.cash_sales, transfer_sales: t.transfer_sales, credit_sales: t.credit_sales,
        sistecredito_sales: t.sistecredito_sales, total_sales: t.total_sales, total_expenses: g.total,
        credit_collection_cash: c.credit_collection_cash, credit_collection_transfer: c.credit_collection_transfer,
        total_credit_collections: c.total_credit_collections, notes: notes || null,
      })
      await audit('close_cash', 'cash_register', caja.id, { total_sales: t.total_sales, expected, closing, diff, total_credit_collections: c.total_credit_collections })

      const nm = await names()
      const settings = Object.fromEntries((await db.settings.toArray()).map((r) => [r.key, r.value]))
      return {
        ok: true,
        data: { ...strip(closed), ...t, ...c, cajero: nm.get(caja.user_id) ?? null, total_expenses: g.total, expected_cash: expected, difference: diff, expenses_list: g.list, settings },
      }
    })
  } catch (e) {
    if (e instanceof Biz) return { ok: false, error: e.message }
    console.error('[cash:close]', e); return { ok: false, error: 'Error al cerrar la caja' }
  }
}

export async function addExpense({ description, amount, category, notes } = {}) {
  try {
    return await db.transaction('rw', TX(), async () => {
      const caja = await openRegister_()
      if (!caja) fail('No hay caja abierta')
      if (!String(description ?? '').trim()) fail('La descripción es obligatoria')
      let amt
      try { amt = positiveCop(amount, 'Monto del gasto') } catch (e) { fail(e.message) }
      const userId = getUser()?.id
      if (!userId) fail('Sesión inválida')
      const id = uuid()
      await save('cash_expenses', {
        id, cash_register_id: caja.id, user_id: userId, description: String(description).trim(),
        category: category || 'Otros', amount: amt, observation: notes || null, created_at: nowIso(),
      })
      await audit('add_cash_expense', 'cash_expense', id, { cash_register_id: caja.id, amount: amt })
      return { ok: true }
    })
  } catch (e) {
    if (e instanceof Biz) return { ok: false, error: e.message }
    console.error('[cash:addExpense]', e); return { ok: false, error: 'Error al registrar el gasto' }
  }
}

export async function getHistory({ limit = 30 } = {}) {
  const safe = Math.min(Math.max(Number(limit) || 30, 1), 200)
  const [rows, nm] = await Promise.all([db.cash_registers.toArray(), names()])
  const data = rows.sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))).slice(0, safe)
    .map((r) => ({ ...strip(r), cajero: nm.get(r.user_id) ?? null }))
  return { ok: true, data }
}

export async function getDetail(id) {
  const caja = await db.cash_registers.get(String(id))
  if (!caja) return { ok: false, error: 'Caja no encontrada' }
  const [nm, exp, inc, sales, settings] = await Promise.all([
    names(), db.cash_expenses.where('cash_register_id').equals(caja.id).toArray(),
    db.cash_income.where('cash_register_id').equals(caja.id).toArray(),
    db.sales.where('cash_register_id').equals(caja.id).toArray(), db.settings.toArray(),
  ])
  const pays = sales.length ? await db.payments.where('sale_id').anyOf(sales.map((s) => s.id)).toArray() : []
  const summary = (sid) => pays.filter((p) => p.sale_id === sid).sort(byAsc).map((p) => `${p.method}:${Number(p.amount).toFixed(2)}`).join(' | ')
  return {
    ok: true,
    data: {
      ...strip(caja), cajero: nm.get(caja.user_id) ?? null,
      expenses_list: exp.sort(byAsc).map((e) => ({ ...strip(e), user_name: nm.get(e.user_id) ?? null })),
      collections_list: inc.sort(byAsc).map((e) => ({ ...strip(e), user_name: nm.get(e.user_id) ?? null })),
      sales_list: sales.sort(byAsc).map((s) => ({
        id: s.id, invoice_number: s.invoice_number, created_at: s.created_at, status: s.status,
        subtotal: s.subtotal, tax_amt: s.tax_amt, total: s.total, notes: s.notes,
        cajero: nm.get(s.user_id) ?? null, payments_summary: summary(s.id),
      })),
      settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
    },
  }
}
