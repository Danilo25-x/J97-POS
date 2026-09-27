// electron/ipc/InventoryHandlers.js

const ProductService = require('../inventory/ProductService')

function registerInventoryHandlers(ipcMain, db, authService, app) {
  const service = new ProductService(db, authService, app)

  // ── Productos ──────────────────────────────────────────
  ipcMain.handle('inventory:getProducts', async (_, filters) => {
    try { authService.requirePermission('inventory'); return service.getProducts(filters) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getProduct', async (_, id) => {
    try { authService.requirePermission('inventory'); return service.getProduct(id) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:createProduct', async (_, data) => {
    try { authService.requirePermission('inventory'); return service.createProduct(data) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:updateProduct', async (_, { id, ...data }) => {
    try { authService.requirePermission('inventory'); return service.updateProduct(id, data) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:deleteProduct', async (_, id) => {
    try { authService.requirePermission('inventory'); return service.deleteProduct(id) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:searchByBarcode', async (_, code) => {
    try { authService.requirePermission('inventory'); return service.searchByBarcode(code) }
    catch (e) { return { ok: false, error: e.message } }
  })

  // ── Variantes ───────────────────────────────────────────
  ipcMain.handle('inventory:getVariants', async (_, productId) => {
    try { authService.requirePermission('inventory'); return service.getVariants(productId) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:createVariant', async (_, data) => {
    try { authService.requirePermission('inventory'); return service.createVariant(data) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:updateVariant', async (_, { id, ...data }) => {
    try { authService.requirePermission('inventory'); return service.updateVariant(id, data) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:deleteVariant', async (_, id) => {
    try { authService.requirePermission('inventory'); return service.deleteVariant(id) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:adjustStock', async (_, data) => {
    try { authService.requirePermission('inventory'); return service.adjustStock(data) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getMovements', async (_, variantId) => {
    try { authService.requirePermission('inventory'); return service.getMovements(variantId) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getLowStock', async () => {
    try { authService.requirePermission('inventory'); return service.getLowStock() }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getStats', async () => {
    try { authService.requirePermission('inventory'); return service.getStats() }
    catch (e) { return { ok: false, error: e.message } }
  })

  // ── Catálogos ───────────────────────────────────────────
  ipcMain.handle('inventory:getCategories', async () => {
    try { authService.requirePermission('inventory'); return service.getCategories() }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getBrands', async () => {
    try { authService.requirePermission('inventory'); return service.getBrands() }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:getSuppliers', async () => {
    try { authService.requirePermission('inventory'); return service.getSuppliers() }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:createCategory', async (_, name) => {
    try { authService.requirePermission('inventory'); return service.createCategory(name) }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('inventory:createBrand', async (_, name) => {
    try { authService.requirePermission('inventory'); return service.createBrand(name) }
    catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerInventoryHandlers }
