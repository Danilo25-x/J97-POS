// electron/ipc/CustomerHandlers.js
const CustomerService = require('../customers/CustomerService')

function registerCustomerHandlers(ipcMain, db, authService) {
  const service = new CustomerService(db, authService)

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (...args) => {
      try {
        authService.requirePermission('customers')
        return await fn(...args)
      } catch (error) {
        console.error(`[IPC:${channel}]`, error)
        return { ok: false, error: error.message || 'Error interno' }
      }
    })
  }

  handle('customers:list', (_, params) => ({ ok: true, data: service.list(params) }))
  handle('customers:get', (_, id) => {
    const data = service.get(id)
    return data ? { ok: true, data } : { ok: false, error: 'Cliente no encontrado' }
  })
  handle('customers:create', (_, data) => service.create(data))
  handle('customers:update', (_, { id, ...data }) => service.update(id, data))
  handle('customers:deactivate', (_, id) => service.deactivate(id))
  handle('customers:registerPayment', (_, { creditId, amount, notes, paymentMethod }) =>
    service.registerCreditPayment(creditId, amount, notes, paymentMethod)
  )
}

module.exports = { registerCustomerHandlers }
