# J'97 POS — Informe de auditoría técnica, etapa 5

## Estado general del proyecto

La revisión encontró que el problema principal de arranque no estaba en SQLite como motor, sino en la organización de las migraciones: existían dos esquemas iniciales y varias migraciones posteriores que intentaban agregar elementos que ya estaban incluidos en `001_initial_clean.sql`.

También se encontraron restos de funcionalidades que ya no forman parte del alcance actual: roles múltiples y métodos de pago QR/tarjeta.

La lógica de variantes e imágenes estaba encaminada correctamente, pero necesitaba endurecimiento para garantizar que una creación de producto con varias variantes se tratara como una sola operación, que las imágenes no quedaran parcialmente guardadas y que la interfaz esperara la recarga de variantes después de crear/editar.

## Problemas encontrados

| Prioridad | Problema | Archivo | Riesgo | Estado |
|---|---|---|---|---|
| CRÍTICO | Dos migraciones iniciales (`001_init.sql` y `001_initial_clean.sql`) intentaban crear el mismo esquema. | `electron/database/migrations/` | La instalación limpia fallaba con `table users already exists`. | CORREGIDO |
| CRÍTICO | El esquema limpio eliminaba `roles`, pero `demo_data.js` y `AuthRepository.js` todavía consultaban esa tabla. | `electron/database/seeds/demo_data.js`, `electron/auth/AuthRepository.js` | Una base limpia podía fallar al crear/iniciar sesión. | CORREGIDO |
| ALTO | La creación de variantes dependía parcialmente de validaciones del frontend. | `ProductService.js`, migración base | Duplicados e inconsistencias. | CORREGIDO |
| ALTO | La combinación producto+talla+color no estaba protegida directamente por una restricción UNIQUE. | `001_initial_clean.sql` | Era posible depender solo del backend para evitar duplicados. | CORREGIDO |
| ALTO | Las imágenes se guardaban de forma directa y el límite de 800 KB podía rechazar imágenes WebP válidas generadas por el navegador. | `ProductImageService.js`, `processImage.js` | Fallos al guardar/cargar imágenes de variantes. | CORREGIDO |
| ALTO | La interfaz de variantes no esperaba explícitamente la recarga después de crear una variante. | `VariantModal.jsx` | La variante podía aparecer después de un retraso y dar la impresión de que no se guardó. | CORREGIDO |
| MEDIO | Existía un componente duplicado de cierre de caja y uno de ellos conservaba referencias históricas a tarjeta/QR. | `src/pages/Ventas/components/CashCloseModal.jsx`, `CashRegisterPage.jsx` | Inconsistencia de interfaz y código muerto. | CORREGIDO |
| MEDIO | El botón de confirmación de cierre utilizaba el estado del monto contado en lugar del estado de la operación de cierre. | `CashCloseModal.jsx` | Podía bloquear/desbloquear incorrectamente el botón. | CORREGIDO |
| MEDIO | `Database.js` ejecutaba la migración y luego registraba `_migrations` fuera de una transacción conjunta. | `electron/database/Database.js` | Una migración fallida después de modificar el esquema podía dejar un estado intermedio. | CORREGIDO |
| BAJO | El preload exponía APIs de administración de usuarios/roles que no son usadas por la aplicación actual. | `electron/preload.js`, `electron/ipc/AuthHandlers.js` | Superficie IPC innecesaria. | CORREGIDO |

## Correcciones realizadas

### Base de datos

Se dejó un único esquema inicial canónico en:

`electron/database/migrations/001_initial_clean.sql`

Se eliminaron las migraciones históricas duplicadas del ZIP actual. Futuras modificaciones deberán utilizar migraciones nuevas numeradas.

El esquema actual no contiene tabla `roles`, ni campos `role_id`, ni métodos `qr`/`tarjeta`.

### Autenticación

El modelo se simplificó a `admin`.

Se conservaron:

- inicio de sesión
- bloqueo por intentos fallidos
- auditoría
- cierre de sesión
- cambio de contraseña

Se retiraron las APIs IPC no utilizadas para creación/listado de usuarios y gestión de roles.

### Variantes

La creación de un producto con varias variantes se mantiene en una única transacción.

El backend valida:

- talla
- color
- stock
- precio especial
- código de barras
- duplicados de talla+color
- códigos de barras repetidos

La BD refuerza `UNIQUE(product_id, size, color)`.

### Imágenes

La imagen se guarda fuera de SQLite antes de confirmar la transacción y se elimina si la operación falla.

El almacenamiento físico utiliza UUID + WebP y escritura atómica.

La interfaz comprime progresivamente las imágenes antes de enviarlas al backend.

### Caja

La interfaz utiliza solamente los cuatro métodos activos y el cierre espera correctamente el resultado de la operación.

## Pruebas realizadas

| Prueba | Resultado | Observación |
|---|---|---|
| Sintaxis de todos los JS de Electron | OK | `node --check` sobre los archivos de Electron |
| Migración canónica sobre SQLite vacío | OK | Se crearon las tablas esperadas |
| Foreign keys | OK | `PRAGMA foreign_keys = 1` |
| Tabla `roles` ausente | OK | Esquema limpio |
| QR rechazado | OK | Restricción de `payments` |
| Tarjeta rechazada | OK | Restricción de `payments` |
| Duplicado producto+talla+color | OK | Restricción UNIQUE |
| Cliente con documento alfanumérico | OK | Rechazado por CHECK |
| Rollback controlado | OK | No quedó la variante temporal |
| Guardado de WebP | OK | Archivo creado y localizado |
| Eliminación de WebP | OK | Archivo eliminado correctamente |
| Creación de producto + 2 variantes | OK | Prueba unitaria del servicio |
| Duplicado de variante | OK | Rechazado antes de crear el producto |
| Pruebas de validación COP | OK | Suite parcial ejecutable |
| Pruebas de caja | OK | Suite parcial ejecutable |

## Verificaciones no realizadas

No se declara como probado todavía:

- `npm ci` completo en el entorno de auditoría.
- `npm run build` completo.
- Instalador NSIS real.
- Primera ejecución del instalador en otro computador.
- Flujo visual completo en Electron.
- Prueba real de lector de código de barras.
- Persistencia después de instalar en un segundo computador.

## Procedimiento final en Windows

Desde `D:\J97`:

```bat
npm ci
npm test
npm run build
npm run dev
```

Para una base de datos de pruebas desechable, eliminar antes:

```text
%APPDATA%\j97-pos\pos-ropa.db
```

y volver a ejecutar J97 para que se cree el esquema canónico.

No eliminar la base de datos de producción sin una migración/backup explícitos.

## Relación con Supabase

La estructura continúa siendo compatible con una futura arquitectura local-first:

- SQLite sigue siendo la base operativa local.
- Las imágenes permanecen fuera de SQLite.
- `image_path` continúa siendo una referencia, no un BLOB.
- Las futuras sincronizaciones pueden incorporar una capa `outbox` y posteriormente mapear IDs locales a IDs remotos de Supabase.

No se implementó todavía sincronización con Supabase en esta etapa.
