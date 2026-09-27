# J'97 POS — Auditoría técnica del ZIP J97_v4(1)

## Alcance

Se revisó directamente el código fuente del ZIP recibido, incluyendo Electron, React, IPC/preload,
SQLite/migraciones, autenticación, inventario, ventas, caja, clientes, reportes, documentos,
imágenes, configuración, dependencias y pruebas existentes.

También se ejecutaron comprobaciones estáticas y pruebas disponibles en el entorno.

## Arquitectura encontrada

- Desktop: Electron.
- Frontend: React 18 + React Router + Zustand.
- Build: Vite + electron-builder.
- Base de datos: SQLite mediante better-sqlite3.
- Comunicación: IPC mediante `contextBridge`/`ipcRenderer.invoke`.
- Persistencia: `%APPDATA%/j97-pos/pos-ropa.db` mediante `app.getPath('userData')`.
- Imágenes: WebP local bajo `app.getPath('userData')/product-images`.
- Autenticación: bcryptjs, sesiones en memoria, permisos por rol y bloqueo por intentos.
- Migraciones: scripts SQL ordenados y tabla `_migrations`.
- Reportes/documentos: generación de PDF desde Electron.

## Hallazgos principales

| Prioridad | Problema | Archivo(s) | Riesgo | Estado |
|---|---|---|---|---|
| CRÍTICO | La cancelación de una venta restituía stock pero no tenía un mecanismo de reembolso financiero. Una cancelación de una venta en efectivo puede dejar el efectivo físico distinto del esperado si se devuelve el dinero; una venta a crédito podía dejar el crédito pendiente. | `electron/ipc/SalesHandlers.js`, `electron/database/migrations/008_customers_credit.sql` | Inconsistencia de caja/crédito | Parcialmente corregido: el crédito se marca cancelado y la auditoría conserva los pagos originales. El reembolso físico/electrónico requiere definir la política de devolución antes de automatizarlo. |
| ALTO | Las entradas monetarias del backend aceptaban `parseFloat()` o `Number()` en caja/ventas/productos, permitiendo decimales o cadenas malformadas. | `electron/ipc/CashHandlers.js`, `electron/ipc/SalesHandlers.js`, `electron/inventory/ProductService.js` | Descuadres y datos monetarios inconsistentes | Corregido en el ZIP auditado: validación COP estricta como entero y soporte para `100.000`. |
| ALTO | `cop()` eliminaba todos los caracteres no numéricos; por ejemplo, una entrada malformada podía convertirse silenciosamente en dinero válido. | `electron/lib/validation.js` | Validación insuficiente | Corregido. |
| ALTO | Varias operaciones mutaban la BD y luego escribían auditoría fuera de la transacción. Si la auditoría fallaba, el usuario podía recibir error después de una operación ya confirmada. | `ProductService.js`, `AuthService.js`, `CustomerService.js`, `CashHandlers.js`, `SalesHandlers.js` | Reintentos/duplicados y trazabilidad inconsistente | Corregido en las operaciones principales del ZIP auditado. |
| ALTO | El arranque no capturaba explícitamente un fallo de bootstrap/migración; una migración fallida podía terminar como promesa no manejada y dejar la aplicación sin un flujo de error claro para el usuario. | `electron/main.js` | Fallo de primera ejecución/actualización | Corregido con manejo de bootstrap y diálogo de error. |
| MEDIO | El esquema SQL histórico todavía permite `tarjeta` y `qr`, aunque la aplicación actual solo admite efectivo, transferencia, crédito interno y Sistecrédito. | `migrations/002_pos_core.sql`, `007_payment_methods.sql` | Inconsistencia entre aplicación y BD | Endurecido con `016_payment_methods_hardening.sql`: se conservan datos históricos, pero nuevas inserciones/modificaciones inválidas son rechazadas. |
| MEDIO | El valor del inventario se calculaba con precio de venta mientras la interfaz lo presentaba como valor a precio de costo. | `ProductRepository.js`, `ReportHandlers.js` | Reportes/KPI incorrectos | Corregido a `cost_price`. |
| MEDIO | Al desactivar un producto, su imagen principal podía quedar como archivo huérfano. | `ProductService.js` | Acumulación de archivos | Corregido para eliminar la referencia física cuando corresponde. |
| BAJO | No existe una gestión completa de usuarios visible en el frontend aunque el backend sí tiene operaciones de usuarios. | `AuthService.js`, `preload.js`, `src/` | Trazabilidad limitada si trabajan varios empleados | Pendiente funcional; requiere decisión de flujo de administración. |
| BAJO | No se pudo ejecutar una compilación Vite completa ni la suite completa porque la instalación de dependencias en el entorno de auditoría quedó incompleta y faltan módulos como `bcryptjs`. | `package.json`, `package-lock.json` | Verificación incompleta | Pendiente de ejecución en entorno con dependencias completas. |
| BAJO | La generación/instalación NSIS en Windows no pudo probarse en este entorno. | `package.json` | Riesgo de producción | Pendiente de prueba real en Windows. |

## Correcciones realizadas en esta auditoría

1. Validación monetaria COP estricta en `electron/lib/validation.js`.
2. Ventas: pagos validados como pesos enteros.
3. Caja: apertura, cierre y egresos validados como pesos enteros.
4. Productos/variantes: precios normalizados como pesos enteros.
5. Auditoría integrada en transacciones para operaciones principales de inventario, autenticación, clientes y caja.
6. Cancelación: el crédito interno asociado se marca `cancelled` para evitar dejar saldo pendiente después de cancelar la venta; los pagos originales quedan registrados para trazabilidad.
7. Arranque de Electron con manejo explícito de error de bootstrap/migración.
8. Nueva migración `016_payment_methods_hardening.sql` que bloquea futuros métodos distintos de los cuatro permitidos sin borrar históricos.
9. Valor de inventario corregido para usar `cost_price`.
10. Limpieza de imagen principal al desactivar producto.
11. Nuevas pruebas de validación de dinero.

## Verificaciones realizadas

### Migraciones SQLite

Se ejecutaron todas las migraciones con SQLite y `foreign_keys=ON` desde una base vacía:

- 001 a 016: OK.
- `PRAGMA foreign_keys`: 1.
- Se verificó que una inserción con `qr` sea rechazada por la nueva migración.
- Se verificó que efectivo, transferencia, crédito interno y Sistecrédito sean aceptados por la restricción de aplicación de la migración.

### Sintaxis backend

`node --check` sobre todos los archivos JavaScript de `electron/`: OK.

### Pruebas automatizadas ejecutables sin dependencias externas faltantes

Resultado: **12/12 OK** en:

- `audit-fixes.test.js`
- `audit-hardening.test.js`
- `cash-integrity.test.js`
- `customer-credit.test.js`

### Suite completa

La suite completa no pudo declararse OK porque `npm ci` no terminó de instalar todas las dependencias en este entorno. Al ejecutar `npm test`, las pruebas que dependen de `bcryptjs` fallaron por `MODULE_NOT_FOUND`. Las demás pruebas ejecutables sí pasaron.

### Build

No se pudo declarar `npm run build` verificado. La instalación incompleta dejó el binario `vite` sin disponibilidad funcional en `node_modules/.bin`.

## Pendientes que deben verificarse en Windows

1. `npm ci`.
2. `npm test` completo.
3. `npm run build`.
4. Instalación NSIS.
5. Primera ejecución con base vacía.
6. Inicio de sesión.
7. Crear producto + variante + imagen.
8. Venta en efectivo con cambio.
9. Venta por transferencia.
10. Crédito interno con cliente/cuotas.
11. Sistecrédito sin cliente/cuotas.
12. Cierre de caja y revisión del historial.
13. Backup y restauración.
14. Reinicio de la aplicación y persistencia.
15. Prueba en un computador distinto al de desarrollo.

## Punto importante sobre cancelaciones

La cancelación de una venta es una zona que no conviene automatizar parcialmente. El código original no definía si "cancelar" significa anular antes de entregar el dinero o realizar un reembolso. En el ZIP auditado se evita una inconsistencia especialmente peligrosa del crédito interno, pero la devolución monetaria completa debe definirse como regla de negocio antes de declarar esa función lista para producción.

## Conclusión

La base del proyecto es sólida: utiliza Electron con aislamiento de contexto, IPC explícito,
SQLite con claves foráneas/WAL, transacciones en los flujos principales, validaciones backend,
bcrypt para contraseñas y almacenamiento de imágenes bajo `userData`.

Los principales riesgos detectados están en consistencia monetaria, trazabilidad transaccional,
cancelaciones/reembolsos y endurecimiento del esquema de métodos de pago. Los cambios realizados
reducen esos riesgos, pero la verificación final de build, instalador y UI real debe ejecutarse
en Windows con las dependencias completas.
