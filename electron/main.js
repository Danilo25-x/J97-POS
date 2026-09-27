// electron/main.js
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const { getDB }        = require('./database/Database')
const { seedDemoData } = require('./database/seeds/demo_data')

const { registerAuthHandlers }      = require('./ipc/AuthHandlers')
const { registerInventoryHandlers } = require('./ipc/InventoryHandlers')
const { registerSalesHandlers }     = require('./ipc/SalesHandlers')
const { registerSettingsHandlers }  = require('./ipc/SettingsHandlers')
const { registerCashHandlers }      = require('./ipc/CashHandlers')
const { registerCustomerHandlers }  = require('./ipc/CustomerHandlers')
const { registerReportHandlers }    = require('./ipc/ReportHandlers')
const { registerDocumentHandlers }  = require('./ipc/DocumentHandlers')

const AuthService = require('./auth/AuthService')
const ProductImageService = require('./media/ProductImageService')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'j97-image',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

let mainWindow, db, authService, productImageService

function getDBPath() {
  return path.join(app.getPath('userData'), 'pos-ropa.db')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1024, minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

async function bootstrap() {
  db = getDB(getDBPath())
  productImageService = new ProductImageService(app)
  const bootstrapAdmin = await seedDemoData(db)
  authService = new AuthService(db)

  if (bootstrapAdmin?.created) {
    await dialog.showMessageBox({
      type: 'info',
      title: "J'97 POS — Administrador inicial",
      message: 'Se creó el usuario administrador inicial.',
      detail: `Usuario: ${bootstrapAdmin.username}\nContraseña inicial: ${bootstrapAdmin.password}\n\nPuedes cambiarla posteriormente desde Configuración > Seguridad.`,
      buttons: ['Entendido'],
    })
  }

  registerAuthHandlers(ipcMain, authService)
  registerInventoryHandlers(ipcMain, db, authService, app)
  registerSalesHandlers(ipcMain, db, authService)
  registerSettingsHandlers(ipcMain, db, authService)
  registerCashHandlers(ipcMain, db, authService)
  registerCustomerHandlers(ipcMain, db, authService)
  registerReportHandlers(ipcMain, db, authService)
  registerDocumentHandlers(ipcMain, db, app, authService)

  console.log('[App] Bootstrap OK')
}

app.whenReady().then(async () => {
  protocol.handle('j97-image', async (request) => {
    try {
      const url = new URL(request.url)
      // En j97-image://products/UUID.webp, "products" es el hostname
      // y "UUID.webp" es el pathname. Ambos deben reconstruirse.
      const host = decodeURIComponent(url.hostname || '')
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const relativePath = [host, pathname].filter(Boolean).join('/')

      const absolutePath = productImageService?.getAbsolutePath(relativePath)
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        return new Response('Not found', { status: 404 })
      }
      const data = await fs.promises.readFile(absolutePath)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
  try {
    await bootstrap()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (error) {
    console.error('[App] Bootstrap fallido:', error)
    if (db) {
      try { db.close() } catch {}
    }
    await dialog.showMessageBox({
      type: 'error',
      title: "J'97 POS — Error de inicio",
      message: 'No se pudo iniciar la aplicación.',
      detail: 'La base de datos o una migración no pudo inicializarse correctamente. No se realizaron operaciones de venta. Revisa el registro técnico antes de volver a intentarlo.',
      buttons: ['Cerrar']
    })
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { db?.close(); app.quit() }
})
