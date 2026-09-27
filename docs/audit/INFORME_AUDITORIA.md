# J'97 POS — Informe de auditoría técnica

Proyecto: `J97` (Electron + React + SQLite/better-sqlite3), recibido como `J97.zip`.
Este informe cubre lo que se pudo comprobar directamente: instalación de dependencias,
lectura completa del backend (Electron/IPC/SQLite), lectura del frontend crítico
(auth, ventas, caja, clientes, inventario, ajustes), ejecución de la suite de pruebas
existente, compilación del frontend con Vite y ejecución real de las migraciones con
el runtime de Electron (`ELECTRON_RUN_AS_NODE=1`, tras `electron-rebuild`).

No se generó el instalador `.exe` (NSIS) porque este entorno es Linux sin GUI; esa
parte queda como pendiente explícito, no como "probado".

## Estado general del proyecto

El proyecto llega en un estado **bueno, no en estado inicial**: ya había pasado por
rondas previas de endurecimiento (documentadas en `ETAPA_3_CAMBIOS.md` y
`ETAPA_4_CORRECCIONES_VALIDACIONES.md`, y en los `.patch` incluidos). Lo ya existente
y que se comprobó correcto:

- Dinero manejado como enteros de pesos colombianos (sin floats) en el backend
  (`electron/lib/validation.js`), y formato `es-CO` correcto en el frontend
  (`src/utils/format.js`).
- Ventas, cancelaciones y cierres de caja envueltos en transacciones SQLite
  (`db.transaction`) con `better-sqlite3`, WAL activado, `foreign_keys=ON`.
- Esquema con `CHECK` constraints extensos (stock ≥ 0, precios ≥ 0, montos ≥ 0,
  descuentos 0–100, etc.) y hasta *triggers* de integridad (clientes con
  nombre/documento/teléfono obligatorios a nivel de base de datos, no solo en la app).
- Backend como fuente de verdad de los cálculos de venta (el frontend nunca decide
  el total que se guarda).
- Electron con `contextIsolation: true`, `nodeIntegration: false`, `preload.js` con
  superficie mínima y explícita (sin exponer `ipcRenderer` crudo).
- Autenticación con `bcryptjs`, bloqueo tras 5 intentos fallidos, permisos por rol
  verificados en el backend (no solo en el frontend).
- Imágenes de productos: solo WebP validado por *magic bytes*, tamaño máximo,
  nombre de archivo aleatorio (UUID), ruta protegida contra *path traversal*
  (`ProductImageService.getAbsolutePath`), y todo guardado bajo `app.getPath('userData')`
  (no depende de rutas del computador del desarrollador).
- Backups con `integrity_check` antes de restaurar.

## Problemas encontrados

| Prioridad | Problema | Archivo | Riesgo | Estado |
|---|---|---|---|---|
| CRÍTICO | No existe pantalla de gestión de usuarios en el frontend (`auth:createUser`, `listUsers`, `toggleUser` no se usan desde `src/`) | *(falta módulo nuevo)* | Con un solo usuario admin, todo el personal comparte una misma cuenta: la auditoría (`audit_logs`), el `cajero` en cada venta y la trazabilidad de caja pierden sentido en una tienda con varios empleados | **Pendiente** — requiere construir una pantalla nueva (ver más abajo) |
| ALTO | `audit.log()` se ejecutaba **después** de confirmar la transacción en `createSale`, `cancelSale` y `registerCreditPayment`. Si esa escritura fallaba, la operación ya estaba guardada pero el backend respondía error, y un reintento del cajero podía duplicar la venta/abono (doble descuento de stock, doble ingreso) | `electron/ipc/SalesHandlers.js`, `electron/customers/CustomerService.js` | Corrupción real de inventario/caja por reintento tras un falso error | **Corregido** |
| ALTO | `updateVariant` no validaba talla/color/precio (sí lo hacía `createVariant`) | `electron/inventory/ProductService.js` | Se podían guardar variantes con talla/color vacíos, y solo el `CHECK` de SQLite (mensaje técnico crudo) frenaba precios negativos | **Corregido** |
| ALTO | Tras restaurar un backup, la sesión en memoria del proceso principal no se limpiaba | `electron/ipc/SettingsHandlers.js` | El usuario seguía "logueado" con permisos/ID de la base de datos anterior tras restaurar otra base de datos | **Corregido** |
| MEDIO/ALTO | `invoice_prefix` no se validaba; se usa para construir el nombre del PDF de factura en disco | `electron/settings/SettingsService.js` | Un admin podía introducir `../../` u otros caracteres y afectar la ruta de escritura del PDF | **Corregido** |
| MEDIO | `updateProduct`/`updateVariant` no comprobaba variantes duplicadas (talla+color) al editar, solo al crear | `electron/inventory/ProductService.js` | Dos variantes idénticas para el mismo producto tras una edición | **Corregido** (se añadió el chequeo también en edición) |
| MEDIO | `update()` de clientes no validaba longitud/formato de correo, dirección y notas (sí lo hacía `create()`) | `electron/customers/CustomerService.js` | Inconsistencia de validación entre alta y edición | **Corregido** |
| BAJO | El contador de "stock bajo" del dashboard usaba un umbral fijo (`5`) en vez del umbral configurable en Ajustes | `electron/ipc/ReportHandlers.js` | El dashboard podía mostrar una cifra distinta a la del módulo de Inventario | **Corregido** |
| BAJO | Los mensajes de error de `SalesHandlers.createSale` devuelven `e.message` crudo (detalle técnico interno) al frontend | `electron/ipc/SalesHandlers.js` | Exposición de detalle técnico a usuarios autenticados de la propia tienda (no a terceros); impacto bajo en una app de escritorio de un solo negocio | **Pendiente** (recomendación, no bloqueante) |
| INFO | `npm audit` reporta vulnerabilidades altas/críticas, casi todas en herramientas de *build* (`electron-builder`, `tar`, `js-yaml`, etc., dependencias de desarrollo) y una moderada en `react-router-dom` (redirección abierta) | `package.json` | Bajo para el binario final (herramientas de build no viajan en el instalador); el caso de `react-router-dom` es de impacto bajo porque la app no navega con URLs externas | **Pendiente** — ver recomendaciones |

## Correcciones realizadas

1. **Auditoría dentro de la transacción** (`SalesHandlers.js`, `CustomerService.js`):
   se movió `audit.log()` / `_audit()` para que ocurra **dentro** de la misma
   transacción SQLite que la venta, la cancelación o el abono de crédito. Así, si
   la auditoría falla, toda la operación se revierte de forma limpia (nada queda
   a medias) en vez de quedar guardada mientras el backend informa un error.
2. **Validación de variantes al editar** (`ProductService.js`): `updateVariant`
   ahora pasa por las mismas reglas que `createVariant` (talla/color obligatorios,
   precio ≥ 0) y además detecta si la edición produce una variante duplicada
   (misma talla+color que otra ya existente del mismo producto).
3. **Cierre de sesión tras restaurar backup** (`SettingsHandlers.js`): después de
   `db.restoreFromFile(...)` se llama `authService.logout()`, para forzar un nuevo
   inicio de sesión contra los datos restaurados (el frontend ya recargaba la
   ventana; ahora el backend también invalida la sesión en memoria).
4. **Validación de `invoice_prefix`** (`SettingsService.js`): solo se acepta
   `[A-Z0-9-]` con máximo 10 caracteres, evitando que ese valor afecte la ruta del
   PDF de factura generado en disco.
5. **Validación de clientes al editar** (`CustomerService.js`): `update()` ahora
   valida correo, dirección y notas igual que `create()`.
6. **Umbral de stock bajo unificado** (`ReportHandlers.js`): el dashboard usa el
   mismo `low_stock_threshold` configurable que el resto de la aplicación.

Todos los cambios son *deltas* mínimos sobre los archivos existentes — no se
reescribió ningún archivo completo ni se tocó el frontend salvo donde el propio
backend ya lo requería.

## Pruebas realizadas

| Prueba | Resultado | Observación |
|---|---|---|
| Suite existente (`node --test tests/*.test.js`) antes de los cambios | ✅ 9/9 | Cubre caja, financiación, cuotas, crédito de clientes |
| Suite existente + 3 pruebas nuevas (`tests/audit-fixes.test.js`) después de los cambios | ✅ 12/12 | Nuevas pruebas cubren `invoice_prefix` inválido/válido y `updateVariant` con talla/color/precio inválidos |
| `node --check` sobre los 6 archivos modificados | ✅ Sin errores de sintaxis | |
| `npx vite build` (compilación del frontend) | ✅ Compila sin errores ni advertencias de build | 1622 módulos, bundle final ~186 KB (gzip ~61 KB) |
| Migraciones SQL desde cero, con el runtime real de Electron (`electron-rebuild` + `ELECTRON_RUN_AS_NODE=1`) | ✅ 13 migraciones aplicadas, 22 tablas creadas, `foreign_keys=1` | Simula la primera ejecución en un computador nuevo |
| `npm audit` | ✅ Ejecutado, revisado manualmente | Ver tabla de hallazgos (fila INFO) |
| Generación del instalador Windows (`electron-builder`, NSIS) | ❌ No ejecutado | Este entorno es Linux sin entorno gráfico; no es posible generar ni firmar un `.exe` aquí. Debe probarse en un Windows real, incluyendo primera ejecución, creación de `pos-ropa.db` en `%APPDATA%`, e imágenes en `product-images/` |
| Pruebas manuales de UI (crear venta desde la pantalla, imprimir factura PDF real, etc.) | ❌ No ejecutado | Requiere una ventana Electron real; no disponible en este entorno |

## Problemas pendientes (no solucionados en esta ronda)

1. **Gestión de usuarios sin interfaz (CRÍTICO para uso real).** El backend ya
   tiene todo lo necesario (`AuthService.createUser/listUsers/toggleUser`,
   permisos por rol `admin/supervisor/cajero`), pero no existe ninguna pantalla
   en `src/pages` para usarlo. Hoy la única cuenta que existe es el `admin` que
   se crea automáticamente en el primer arranque. Para una tienda con más de una
   persona en caja, esto es necesario antes de producción. **No lo construí en
   esta ronda porque implica una pantalla nueva completa** (no es una corrección
   puntual) — puedo hacerlo en la siguiente ronda si lo confirmas.
2. **Mensajes de error técnicos expuestos en ventas.** Bajo impacto, pero se
   podría envolver en un mensaje genérico y dejar el detalle solo en el log de
   consola del proceso principal.
3. **Vulnerabilidades de `npm audit`.** La mayoría son de `electron-builder` y su
   cadena de dependencias (herramienta de *build*, no viaja en el `.exe` final).
   Antes de actualizar `electron`, `electron-builder` o `react-router-dom` a
   versiones mayores hay que probar que el build y el login/rutas siguen
   funcionando — no lo hice en esta ronda para no arriesgar romper algo que
   funciona, tal como pediste.
4. **Build de instalador Windows real.** No se puede generar ni probar en este
   entorno. Debe verificarse en una máquina Windows: instalación, primera
   ejecución, creación de la base de datos y carpeta de imágenes, desinstalación.
5. Zonas que se revisaron por lectura de código pero sin pruebas automatizadas
   dedicadas: `ReportHandlers` (dashboard/reportes), `DocumentHandlers` (PDF de
   factura y de cierre de caja), `AuthRepository`/`AuditLogger`.

## Recomendaciones

- Priorizar la pantalla de **gestión de usuarios** antes de poner la app en
  producción con más de un empleado.
- Antes de generar el instalador final, hacerlo en un Windows real (no en este
  entorno) y verificar los puntos de la fila "Generación del instalador" arriba.
- Revisar `react-router-dom` en la próxima actualización de dependencias
  (vulnerabilidad moderada de redirección abierta); impacto bajo aquí porque la
  app no navega con URLs externas, pero conviene no dejarlo indefinidamente.
- Mantener la práctica ya presente en el proyecto de encerrar operaciones
  multi-tabla en `db.transaction(...)`, incluyendo cualquier registro de
  auditoría asociado, como se corrigió en esta ronda.
