# J97 POS — Etapa 5: base de datos, variantes e imágenes

## Problemas corregidos

### 1. Migraciones duplicadas
El proyecto contenía una migración histórica `001_init.sql` y otra `001_initial_clean.sql`, seguidas de varias migraciones que volvían a agregar columnas/tablas ya presentes en el esquema limpio.

En una base vacía el arranque ejecutaba primero `001_init.sql` y después intentaba ejecutar `001_initial_clean.sql`, provocando:

`table users already exists`

Esto impedía iniciar una instalación limpia.

### 2. Esquema canónico
Se dejó `electron/database/migrations/001_initial_clean.sql` como esquema base único del proyecto actual.

El esquema incluye todas las tablas y columnas que usa la aplicación actualmente, incluyendo:

- usuarios admin
- configuración
- auditoría
- categorías
- marcas
- proveedores
- clientes
- productos
- variantes
- ventas
- pagos
- facturas
- caja
- egresos
- ingresos por abonos
- créditos internos
- abonos
- movimientos de inventario

Las futuras modificaciones deben agregarse como nuevas migraciones numeradas (`002_...sql`, `003_...sql`, etc.).

### 3. Eliminación de roles no utilizados
Se eliminó del esquema actual el sistema de `roles`, `role_id`, `supervisor` y `cajero`.

El usuario operativo queda como `admin` y la autenticación conserva el bloqueo por intentos y cambio de contraseña.

### 4. Métodos de pago obsoletos
Se eliminaron del esquema actual `tarjeta` y `qr`.

Los métodos válidos son únicamente:

- `efectivo`
- `transferencia`
- `credito`
- `sistecredito`

### 5. Variantes
La base de datos ahora impide duplicar la misma combinación de:

`producto + talla + color`

La capa de servicio también valida duplicados antes de iniciar la transacción y valida códigos de barras repetidos.

### 6. Creación de producto con varias variantes
La creación de un producto con varias variantes se realiza como una única operación de negocio:

1. Validar producto.
2. Validar todas las variantes.
3. Guardar las imágenes necesarias.
4. Abrir transacción SQLite.
5. Crear el producto una sola vez.
6. Crear todas las variantes asociadas al mismo `product_id`.
7. Registrar auditoría.
8. Confirmar la transacción.
9. Devolver `{ ok: true, id }` al frontend.

Si una variante falla, la transacción se revierte y las imágenes creadas para esa operación se eliminan.

### 7. Imágenes
Las imágenes se guardan como WebP en:

`%APPDATA%/j97-pos/product-images/products/`

La base de datos almacena únicamente la ruta relativa, por ejemplo:

`products/UUID.webp`

Se añadió escritura atómica mediante archivo temporal + rename para evitar archivos parcialmente escritos.

El frontend comprime progresivamente la imagen hasta un objetivo aproximado de 650 KB y mantiene un límite de entrada de 10 MB.

El backend acepta como máximo 2 MB para la imagen WebP ya procesada.

### 8. Carga de imágenes
El protocolo `j97-image://` sigue resolviendo únicamente rutas permitidas bajo `products/*.webp`.

Se eliminó el logging de cada solicitud de imagen para evitar ruido y lecturas innecesarias en producción.

Las imágenes generadas con UUID pueden utilizar caché de larga duración porque su nombre nunca cambia.

### 9. Cierre de caja
Se eliminó de la interfaz el uso de `tarjeta` y `QR`.

También se corrigió un error de estado en el botón de confirmación del cierre: anteriormente el botón podía quedar deshabilitado usando la variable del monto contado en lugar del estado real de la operación de cierre.

Se eliminó el componente duplicado de cierre de caja y `CashRegisterPage` utiliza ahora el componente canónico de `CashRegister/components`.

### 10. Migraciones atómicas
`Database.js` ahora ejecuta cada migración y su registro en `_migrations` dentro de una transacción.

Si una migración falla, no debe quedar una migración parcialmente aplicada y marcada como completada.

## Importante para la base de datos existente

El ZIP está preparado para una instalación limpia con el esquema canónico.

Si se utiliza una base de datos de pruebas que contiene únicamente datos desechables, se puede eliminar y dejar que J97 cree una nueva.

No se debe eliminar una base de datos real de producción. Para una base existente con el esquema histórico anterior se debe crear una migración de actualización específica antes de desplegarla.

## Verificaciones de esta etapa

- Sintaxis JavaScript de Electron: OK.
- Migración SQL canónica ejecutada sobre SQLite vacío: OK.
- Integridad referencial activada: OK.
- Tabla `roles`: no existe en el esquema canónico.
- Métodos QR/tarjeta: rechazados por la restricción SQL.
- Duplicado producto+talla+color: rechazado por SQLite.
- Validación de documento/teléfono de clientes: OK.
- Rollback SQLite en prueba controlada: OK.
- Guardado, existencia y eliminación de una imagen WebP: OK.
- Pruebas de variantes del `ProductService`: OK.

## Verificación pendiente

La compilación Vite/electron-builder y la ejecución de la interfaz completa deben ejecutarse en Windows con las dependencias instaladas mediante `npm ci`. En el entorno de auditoría no se pudo completar esa instalación, por lo que no se declara el instalador como probado aquí.
