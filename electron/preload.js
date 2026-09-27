// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')
const invoke = (channel, data) => ipcRenderer.invoke(channel, data)

contextBridge.exposeInMainWorld('electronAPI', {

  auth: {
    login:          (data) => invoke('auth:login', data),
    logout:         ()     => invoke('auth:logout'),
    getSession:     ()     => invoke('auth:getSession'),
    changePassword: (data) => invoke('auth:changePassword', data),
  },

  inventory: {
    getProducts:     (data) => invoke('inventory:getProducts', data),
    getProduct:      (id)   => invoke('inventory:getProduct', id),
    createProduct:   (data) => invoke('inventory:createProduct', data),
    updateProduct:   (data) => invoke('inventory:updateProduct', data),
    deleteProduct:   (id)   => invoke('inventory:deleteProduct', id),
    getVariants:     (id)   => invoke('inventory:getVariants', id),
    createVariant:   (data) => invoke('inventory:createVariant', data),
    updateVariant:   (data) => invoke('inventory:updateVariant', data),
    deleteVariant:   (id)   => invoke('inventory:deleteVariant', id),
    adjustStock:     (data) => invoke('inventory:adjustStock', data),
    getMovements:    (id)   => invoke('inventory:getMovements', id),
    getLowStock:     ()     => invoke('inventory:getLowStock'),
    getStats:        ()     => invoke('inventory:getStats'),
    searchByBarcode: (code) => invoke('inventory:searchByBarcode', code),
    getCategories:   ()     => invoke('inventory:getCategories'),
    getBrands:       ()     => invoke('inventory:getBrands'),
    getSuppliers:    ()     => invoke('inventory:getSuppliers'),
    createCategory:  (name) => invoke('inventory:createCategory', name),
    createBrand:     (name) => invoke('inventory:createBrand', name),
  },

  sales: {
    createSale:  (data) => invoke('sales:createSale', data),
    getSales:    (data) => invoke('sales:getSales', data),
    getSale:     (id)   => invoke('sales:getSale', id),
    cancelSale:  (data) => invoke('sales:cancelSale', data),
    scanBarcode: (code) => invoke('sales:scanBarcode', code),
  },

  customers: {
    list:            (data) => invoke('customers:list', data),
    get:             (id)   => invoke('customers:get', id),
    create:          (data) => invoke('customers:create', data),
    update:          (data) => invoke('customers:update', data),
    deactivate:      (id)   => invoke('customers:deactivate', id),
    registerPayment: (data) => invoke('customers:registerPayment', data),
  },

  cash: {
    openRegister:    (data) => invoke('cash:openRegister', data),
    closeRegister:   (data) => invoke('cash:closeRegister', data),
    getOpen:         ()     => invoke('cash:getOpen'),
    getClosePreview: ()     => invoke('cash:getClosePreview'),
    addExpense:      (data) => invoke('cash:addExpense', data),
    getHistory:      (data) => invoke('cash:getHistory', data),
    getDetail:       (id)   => invoke('cash:getDetail', id),
  },

  reports: {
    getDashboard:       ()     => invoke('reports:getDashboard'),
    getSalesReport:     (data) => invoke('reports:getSalesReport', data),
    getTopProducts:     (data) => invoke('reports:getTopProducts', data),
    getInventoryReport: ()     => invoke('reports:getInventoryReport'),
  },

  settings: {
    getAll:  ()     => invoke('settings:getAll'),
    set:     (data) => invoke('settings:set', data),
    backup:  ()     => invoke('settings:backup'),
    restore: ()     => invoke('settings:restore')
  },

  documents: {
    invoicePdf: (saleId) => invoke('documents:invoicePdf', saleId),
    cashPdf:    (data)   => invoke('documents:cashPdf', data),
  },
})
