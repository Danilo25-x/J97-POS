// src/data/api.js — recrea window.electronAPI (misma forma que electron/preload.js)
// para que las pantallas funcionen sin cambios en el navegador.
import * as auth from './auth.js'
import * as inv from './inventory.js'
import * as cust from './customers.js'
import * as settings from './settings.js'
import * as sales from './sales.js'
import * as cash from './cash.js'
import * as reports from './reports.js'
import * as docs from './documents.js'
import { requirePermission } from './session.js'
import { startAutoSync } from './sync.js'

const guard = (permission, fn) => async (...args) => {
  try {
    if (permission) requirePermission(permission)
    return await fn(...args)
  } catch (e) {
    console.error('[api]', e)
    return { ok: false, error: e?.message || 'Error interno' }
  }
}

export function buildApi() {
  const I = (fn) => guard('inventory', fn)
  const C = (fn) => guard('customers', fn)
  const S = (fn) => guard('sales', fn)
  const K = (fn) => guard('cash_register', fn)
  const R = (fn) => guard('reports', fn)
  return {
    auth: {
      login: guard(null, auth.login),
      logout: guard(null, auth.logout),
      getSession: guard(null, auth.getSession),
      changePassword: guard(null, auth.changePassword),
    },
    inventory: {
      getProducts: I(inv.getProducts), getProduct: I(inv.getProduct),
      createProduct: I(inv.createProduct),
      updateProduct: I(({ id, ...data } = {}) => inv.updateProduct(id, data)),
      deleteProduct: I(inv.deleteProduct),
      getVariants: I(inv.getVariants), createVariant: I(inv.createVariant),
      updateVariant: I(({ id, ...data } = {}) => inv.updateVariant(id, data)),
      deleteVariant: I(inv.deleteVariant),
      adjustStock: I(inv.adjustStock), getMovements: I((id) => inv.getMovements(id)),
      getLowStock: I(inv.getLowStock), getStats: I(inv.getStats),
      searchByBarcode: I(inv.searchByBarcode),
      getCategories: I(inv.getCategories), getBrands: I(inv.getBrands), getSuppliers: I(inv.getSuppliers),
      createCategory: I(inv.createCategory), createBrand: I(inv.createBrand),
    },
    customers: {
      list: C(cust.list), get: C(cust.get), create: C(cust.create),
      update: C(({ id, ...data } = {}) => cust.update(id, data)),
      deactivate: C(cust.deactivate),
      registerPayment: C(({ creditId, amount, notes, paymentMethod } = {}) =>
        cust.registerCreditPayment(creditId, amount, notes, paymentMethod)),
    },
    settings: {
      // getAll sin permiso: la app lo pide al arrancar, antes de que se restaure la sesión
      getAll: guard(null, async () => ({ ok: true, data: await settings.getAll() })),
      set: guard('settings', async ({ key, value } = {}) => { await settings.set(key, value); return { ok: true } }),
      backup: async () => ({ ok: false, error: 'Tus datos se respaldan automáticamente en Supabase' }),
      restore: async () => ({ ok: false, error: 'Tus datos se respaldan automáticamente en Supabase' }),
    },
    sales: {
      createSale: S(sales.createSale), getSales: S(sales.getSales), getSale: S(sales.getSale),
      cancelSale: S(sales.cancelSale), scanBarcode: S(sales.scanBarcode),
    },
    cash: {
      openRegister: K(cash.openRegister), closeRegister: K(cash.closeRegister), getOpen: K(cash.getOpen),
      getClosePreview: K(cash.getClosePreview), addExpense: K(cash.addExpense),
      getHistory: K(cash.getHistory), getDetail: K(cash.getDetail),
    },
    reports: {
      getDashboard: guard('dashboard', reports.getDashboard),
      getSalesReport: R(reports.getSalesReport), getTopProducts: R(reports.getTopProducts),
      getInventoryReport: R(reports.getInventoryReport),
    },
    documents: {
      invoicePdf: S(docs.invoicePdf),
      cashPdf: K(docs.cashPdf),
    },
  }
}

/** Llamar al arrancar: en el navegador no existe electronAPI, así que se crea aquí. */
export async function installWebApi() {
  if (typeof window === 'undefined' || window.electronAPI) return false
  await settings.ensureDefaults()
  window.electronAPI = buildApi()
  startAutoSync()
  return true
}
