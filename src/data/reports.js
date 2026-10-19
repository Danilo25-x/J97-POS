// src/data/reports.js — port de electron/ipc/ReportHandlers.js
import { db } from './db.js'
import { localDay, localMonth, todayLocal, daysAgoLocal } from './dates.js'

const sum = (rows, f) => rows.reduce((s, r) => s + Number(f(r) || 0), 0)

async function threshold() {
  const r = await db.settings.get('low_stock_threshold')
  return parseInt(r?.value || '5', 10)
}

async function activeStock() {
  const [variants, products] = await Promise.all([db.product_variants.toArray(), db.products.toArray()])
  const active = new Map(products.filter((p) => p.is_active).map((p) => [p.id, p]))
  return { products: [...active.values()], pairs: variants.filter((v) => v.is_active && active.has(v.product_id)).map((v) => ({ v, p: active.get(v.product_id) })) }
}

export async function getDashboard() {
  const today = todayLocal(), month = today.slice(0, 7)
  const [allSales, allPays, cajaRow, thr, st] = await Promise.all([
    db.sales.toArray(), db.payments.toArray(), db.cash_registers.where('status').equals('open').first(), threshold(), activeStock(),
  ])
  const done = allSales.filter((s) => s.status === 'completed')
  const agg = (rows) => ({ total: sum(rows, (s) => s.total), count: rows.length })
  const ventasHoy = agg(done.filter((s) => localDay(s.created_at) === today))
  const ventasMes = agg(done.filter((s) => localMonth(s.created_at) === month))

  const inventarioStats = {
    total_products: st.products.length,
    total_units: sum(st.pairs, ({ v }) => v.stock),
    inventory_value: sum(st.pairs, ({ v, p }) => v.stock * p.cost_price),
  }

  let cajaAbierta = null
  if (cajaRow) {
    const ids = new Set(done.filter((s) => s.cash_register_id === cajaRow.id).map((s) => s.id))
    const mine = allPays.filter((p) => ids.has(p.sale_id))
    cajaAbierta = { id: cajaRow.id, opening_amount: cajaRow.opening_amount, total_sales: sum(mine, (p) => p.amount), num_sales: new Set(mine.map((p) => p.sale_id)).size }
  }

  const from7 = daysAgoLocal(6)
  const perDay = new Map()
  for (const s of done) {
    const d = localDay(s.created_at)
    if (d < from7) continue
    const cur = perDay.get(d) || { dia: d, total: 0, count: 0 }
    cur.total += s.total; cur.count += 1; perDay.set(d, cur)
  }
  const ventas7dias = [...perDay.values()].sort((a, b) => a.dia.localeCompare(b.dia))

  const monthIds = new Set(done.filter((s) => localMonth(s.created_at) === month).map((s) => s.id))
  const perMethod = new Map()
  for (const p of allPays) {
    if (!monthIds.has(p.sale_id)) continue
    const cur = perMethod.get(p.method) || { method: p.method, total: 0, count: 0 }
    cur.total += p.amount; cur.count += 1; perMethod.set(p.method, cur)
  }

  return {
    ok: true,
    data: {
      ventasHoy, ventasMes, inventarioStats, cajaAbierta, ventas7dias,
      ventasPorMetodo: [...perMethod.values()],
      stockBajo: st.pairs.filter(({ v }) => v.stock > 0 && v.stock <= thr).length,
      sinStock: st.pairs.filter(({ v }) => v.stock === 0).length,
    },
  }
}

const inRange = (s, from, to) => (!from || localDay(s.created_at) >= from) && (!to || localDay(s.created_at) <= to)

export async function getSalesReport(params = {}) {
  const { from, to } = params
  const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500)
  const offset = Math.max(Number(params.offset) || 0, 0)
  const [sales, pays, profiles] = await Promise.all([db.sales.toArray(), db.payments.toArray(), db.profiles.toArray()])
  const nm = new Map(profiles.map((p) => [p.id, p.name]))
  const filtered = sales.filter((s) => inRange(s, from, to))
  const items = [...filtered].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(offset, offset + limit)
    .map(({ _dirty, ...s }) => ({
      ...s, cajero: nm.get(s.user_id) ?? null,
      payments_summary: pays.filter((p) => p.sale_id === s.id).map((p) => `${p.method}:${p.amount}`).join(',') || null,
    }))
  const done = filtered.filter((s) => s.status === 'completed')
  return { ok: true, data: { items, grand_total: sum(done, (s) => s.total), total_count: done.length } }
}

export async function getTopProducts({ limit = 10, from, to } = {}) {
  const safe = Math.min(Math.max(Number(limit) || 10, 1), 100)
  const [sales, items, variants, products] = await Promise.all([db.sales.toArray(), db.sale_items.toArray(), db.product_variants.toArray(), db.products.toArray()])
  const okSales = new Set(sales.filter((s) => s.status === 'completed' && inRange(s, from, to)).map((s) => s.id))
  const vm = new Map(variants.map((v) => [v.id, v])), pm = new Map(products.map((p) => [p.id, p]))
  const acc = new Map()
  for (const it of items) {
    if (!okSales.has(it.sale_id)) continue
    const v = vm.get(it.variant_id), p = v ? pm.get(v.product_id) : null
    if (!p) continue
    const cur = acc.get(p.id) || { name: p.name, sku: p.sku, total_qty: 0, total_revenue: 0, sales: new Set() }
    cur.total_qty += it.qty; cur.total_revenue += it.line_total; cur.sales.add(it.sale_id); acc.set(p.id, cur)
  }
  const data = [...acc.values()].sort((a, b) => b.total_qty - a.total_qty).slice(0, safe)
    .map(({ sales: s, ...r }) => ({ ...r, num_sales: s.size }))
  return { ok: true, data }
}

export async function getInventoryReport() {
  const [thr, st, cats] = await Promise.all([threshold(), activeStock(), db.categories.toArray()])
  const cm = new Map(cats.map((c) => [c.id, c.name]))
  const data = st.products.map((p) => {
    const vs = st.pairs.filter(({ p: pp }) => pp.id === p.id).map(({ v }) => v)
    return {
      name: p.name, sku: p.sku, category: cm.get(p.category_id) ?? null,
      total_stock: sum(vs, (v) => v.stock), variants: vs.length,
      sale_price: p.sale_price, cost_price: p.cost_price, value: sum(vs, (v) => v.stock * p.cost_price),
    }
  }).sort((a, b) => a.total_stock - b.total_stock)
  return { ok: true, data, threshold: thr }
}
