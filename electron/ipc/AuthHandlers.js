// electron/ipc/AuthHandlers.js

function registerAuthHandlers(ipcMain, authService) {
  ipcMain.handle('auth:login', async (_, { username, password }) => {
    try { return await authService.login(username, password) }
    catch (e) { return { ok:false, error:e.message } }
  })

  ipcMain.handle('auth:logout', async () => authService.logout())

  ipcMain.handle('auth:getSession', async () => {
    const user = authService.getSession()
    return { ok:!!user, user }
  })

  ipcMain.handle('auth:changePassword', async (_, { userId, newPassword }) => {
    try { return await authService.changePassword(userId, newPassword) }
    catch (e) { return { ok:false, error:e.message } }
  })
}

module.exports = { registerAuthHandlers }
