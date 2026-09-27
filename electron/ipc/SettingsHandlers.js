// electron/ipc/SettingsHandlers.js

const SettingsService = require('../settings/SettingsService')
const path = require('path')

function registerSettingsHandlers(ipcMain, db, authService) {
  const service = new SettingsService(db)

  ipcMain.handle('settings:getAll', async () => {
    try {
      authService.requirePermission('settings')
      return { ok: true, data: service.getAll() }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('settings:set', async (_, { key, value } = {}) => {
    try {
      authService.requirePermission('settings')
      service.set(key, value)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('settings:backup', async () => {
    try {
      authService.requirePermission('settings')
      const { app, dialog } = require('electron')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const defaultPath = path.join(app.getPath('documents'), `J97-backup-${stamp}.db`)
      const result = await dialog.showSaveDialog({
        title: 'Guardar copia de seguridad',
        defaultPath,
        filters: [{ name: "Base de datos J'97", extensions: ['db'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
      const backupPath = await db.backupToFile(result.filePath)
      return { ok: true, path: backupPath }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('settings:restore', async () => {
    try {
      authService.requirePermission('settings')
      const { dialog } = require('electron')
      const result = await dialog.showOpenDialog({
        title: 'Seleccionar copia de seguridad',
        properties: ['openFile'],
        filters: [{ name: "Base de datos J'97", extensions: ['db'] }],
      })
      if (result.canceled || !result.filePaths?.[0]) return { ok: false, cancelled: true }
      await db.restoreFromFile(result.filePaths[0])
      // La sesión activa quedó referenciando al usuario de la base de datos
      // anterior. Se cierra para forzar un nuevo inicio de sesión contra
      // los datos restaurados y evitar permisos o IDs inconsistentes.
      authService.logout()
      return { ok: true, path: result.filePaths[0] }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerSettingsHandlers }
