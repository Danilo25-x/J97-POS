// src/data/customers.js — port de electron/customers/CustomerService.js
import { db, uuid, nowIso, save, strip } from './db.js'
import { getUser } from './session.js'
import { audit } from './audit.js'
import { text, id as vid, positiveCop, documentNumber, phoneNumber } from './validation.js'

const TX = () => [db.customers, db.credits, db.credit_payments, db.cash_income, db.audit_logs]
const has = (v, q) => String(v ?? '').toLowerCase().includes(q)

function clean(data) {
  return {
    name: text(data.name, { required: true, max: 160, field: 'Nombre del cliente' }),
    document: documentNumber(data.document),
    phone: phoneNumber(data.phone),
    email: data.email ? text(data.email, { max: 120, field: 'Correo' }) : null,
    address: data.address ? text(data.address, { max: 180, field: 'Dirección' }) : null,
    notes: data.notes ? text(data.notes, { max: 500, field: 'Notas' }) : null,
  }
}

export async function list({ search = '', page = 1, pageSize = 30 } = {}) {
  page = Math.max(1, Number.parseInt(page, 10) || 1)
  pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 30))
  const q = String(search ?? '').trim().toLowerCase()

  const [customers, credits, sales] = await Promise.all([db.customers.toArray(), db.credits.toArray(), db.sales.toArray()])
  const pending = new Map(), inst = new Map(), buys = new Map()
  for (const c of credits) {
    inst.set(c.customer_id, (inst.get(c.customer_id) || 0) + c.installment_count)
    if (c.status === 'pending') pending.set(c.customer_id, (pending.get(c.customer_id) || 0) + c.balance)
  }
  for (const s of sales) if (s.status === 'completed' && s.customer_id) buys.set(s.customer_id, (buys.get(s.customer_id) || 0) + 1)

  let rows = customers.filter((c) => c.is_active)
  if (q) rows = rows.filter((c) => has(c.name, q) || has(c.document, q) || has(c.phone, q))
  rows.sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const items = rows.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
    ...strip(c),
    pending_balance: pending.get(c.id) || 0,
    installments: inst.get(c.id) || 0,
    purchase_count: buys.get(c.id) || 0,
  }))
  return { ok: true, data: { items, total: rows.length, page, pageSize } }
}

async function getRow(idValue) {
  const customerId = vid(idValue, 'Cliente')
  const customer = await db.customers.get(customerId)
  return customer?.is_active ? customer : null
}

export async function get(idValue) {
  const customer = await getRow(idValue)
  if (!customer) return { ok: false, error: 'Cliente no encontrado' }
  const [credits, sales] = await Promise.all([db.credits.where('customer_id').equals(customer.id).toArray(), db.sales.toArray()])
  const inv = new Map(sales.map((s) => [s.id, s.invoice_number]))
  return {
    ok: true,
    data: {
      ...strip(customer),
      credits: credits
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((c) => ({ ...strip(c), invoice_number: inv.get(c.sale_id) ?? null })),
    },
  }
}

export async function create(data = {}) {
  const c = clean(data)
  if (await db.customers.where('document').equals(c.document).filter((x) => x.is_active).first()) {
    return { ok: false, error: 'Ya existe un cliente con ese documento' }
  }
  const customerId = uuid()
  await db.transaction('rw', TX(), async () => {
    await save('customers', { id: customerId, ...c, is_active: true, created_at: nowIso() })
    await audit('create_customer', 'customer', customerId, { name: c.name })
  })
  return { ok: true, id: customerId }
}

export async function update(idValue, data = {}) {
  const existing = await getRow(idValue)
  if (!existing) return { ok: false, error: 'Cliente no encontrado' }
  const c = clean(data)
  if (await db.customers.where('document').equals(c.document).filter((x) => x.is_active && x.id !== existing.id).first()) {
    return { ok: false, error: 'Ya existe otro cliente con ese documento' }
  }
  await db.transaction('rw', TX(), async () => {
    await save('customers', { ...existing, ...c })
    await audit('update_customer', 'customer', existing.id, { name: c.name })
  })
  return { ok: true }
}

export async function deactivate(idValue) {
  const existing = await getRow(idValue)
  if (!existing) return { ok: false, error: 'Cliente no encontrado' }
  const debt = (await db.credits.where('customer_id').equals(existing.id).toArray())
    .filter((c) => c.status === 'pending').reduce((s, c) => s + c.balance, 0)
  if (debt > 0) return { ok: false, error: 'No se puede desactivar un cliente con saldo pendiente' }

  await db.transaction('rw', TX(), async () => {
    await save('customers', { ...existing, is_active: false })
    await audit('deactivate_customer', 'customer', existing.id, {})
  })
  return { ok: true }
}

export async function registerCreditPayment(creditIdValue, amountValue, notes, paymentMethod = 'efectivo') {
  const creditId = vid(creditIdValue, 'Crédito')
  const amount = positiveCop(amountValue, 'Abono')
  const credit = await db.credits.get(creditId)
  if (!credit || credit.status !== 'pending') return { ok: false, error: 'Crédito no encontrado o ya pagado' }
  if (amount > credit.balance) return { ok: false, error: 'El abono supera el saldo pendiente' }
  if (!['efectivo', 'transferencia'].includes(paymentMethod)) return { ok: false, error: 'Método de pago inválido' }

  const register = await db.cash_registers.where('status').equals('open').first()
  if (!register) return { ok: false, error: 'Debes abrir la caja antes de registrar un abono' }
  const customer = await db.customers.get(credit.customer_id)
  const userId = getUser()?.id ?? null
  const cleanNotes = notes ? text(notes, { max: 300, field: 'Nota' }) : null

  await db.transaction('rw', TX(), async () => {
    const newPaid = credit.paid_amount + amount
    const newBalance = credit.total_amount - newPaid
    await save('credit_payments', {
      id: uuid(), credit_id: creditId, user_id: userId, amount, notes: cleanNotes,
      payment_method: paymentMethod, created_at: nowIso(),
    })
    await save('cash_income', {
      id: uuid(), cash_register_id: register.id, user_id: userId, source: 'credit_payment',
      reference_id: creditId, description: `Abono crédito — ${customer?.name ?? ''}`,
      amount, payment_method: paymentMethod, created_at: nowIso(),
    })
    await save('credits', { ...credit, paid_amount: newPaid, balance: newBalance, status: newBalance === 0 ? 'paid' : 'pending' })
    await audit('credit_payment', 'customer', creditId, { amount })
  })
  return { ok: true, balance: credit.balance - amount }
}
