// electron/ipc/SyncHandlers.js

function registerSyncHandlers(ipcMain, authService, sync, settingsService) {
  ipcMain.handle('sync:runNow', async () => {
    try {
      authService.requirePermission('settings')
      return await sync.runSync(settingsService)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('sync:getStatus', async () => {
    try {
      authService.requirePermission('settings')
      return { ok: true, data: sync.lastResult }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // Restauración de emergencia: solo sobre una base de datos local vacía
  // (sync.restoreFromCloud ya lo valida por su cuenta). Se exige además
  // una palabra de confirmación explícita desde la interfaz, porque es
  // una operación que trae datos masivos de vuelta.
  ipcMain.handle('sync:restoreFromCloud', async (_, { confirm } = {}) => {
    try {
      authService.requirePermission('settings')
      if (confirm !== 'RESTAURAR') {
        return { ok: false, error: 'Confirmación inválida' }
      }
      return await sync.restoreFromCloud(settingsService)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
}

module.exports = { registerSyncHandlers }
