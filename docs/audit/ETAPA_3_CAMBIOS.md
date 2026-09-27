# J97 POS — Etapa 3: caja, historial y Sistecrédito

## Cambios realizados

### 1. Historial de ventas dentro del cierre de caja
- `cash:getDetail` devuelve las ventas asociadas directamente al cierre.
- Para cierres históricos creados antes de que todas las ventas quedaran vinculadas a `cash_register_id`, se recuperan también ventas sin caja asociada cuyo `created_at` esté dentro del intervalo apertura/cierre.
- Se conservan factura, fecha, cajero, métodos de pago, estado y total.

### 2. Eliminación de la caja duplicada en Ventas
- Se eliminó la pestaña `Caja` de `VentasPage`.
- La apertura, gastos, cierre e historial de cajas quedan centralizados en `/cash`.
- La pantalla de Ventas conserva únicamente `Nueva venta` e `Historial`.
- Si no hay caja abierta, el botón dirige al módulo independiente de Caja.

### 3. Sistecrédito sin número de cuotas
- Sistecrédito solo solicita el porcentaje adicional.
- No solicita ni valida número de cuotas.
- Las ventas nuevas de Sistecrédito guardan `installment_count` e `installment_amount` como `NULL`.
- Crédito interno conserva cliente, porcentaje y número de cuotas.

### 4. Corrección de financiación
- `VentasPage` ahora envía `financingPct` al backend.
- Esto evita que el frontend muestre un total financiado diferente al total registrado por el backend.

### 5. Corrección del efectivo y el cambio
- El efectivo recibido puede ser mayor al valor de la venta.
- El pago registrado en la base de datos corresponde al valor real de la venta, no al efectivo entregado por el cliente.
- El cambio sigue calculándose y mostrándose en pantalla.
- Esto evita inflar las ventas de efectivo y provocar descuadres en el cierre de caja.

## Métodos de pago activos en ventas
- Efectivo
- Transferencia
- Crédito interno
- Sistecrédito

Tarjeta y QR no están disponibles para nuevas ventas desde el backend ni desde la interfaz.

## Archivos principales modificados
- `src/pages/Ventas/VentasPage.jsx`
- `src/pages/Ventas/components/PaymentModal.jsx`
- `electron/ipc/SalesHandlers.js`
- `electron/ipc/CashHandlers.js`

## Validación
- Se ejecutó `node --check` sobre los handlers backend modificados.
- Se realizaron comprobaciones semánticas sobre la eliminación de la pestaña Caja, Sistecrédito sin cuotas y envío del porcentaje de financiación.
- No se incluyeron `node_modules`, `dist` ni `dist-app`.
- El entorno de validación no tenía `node_modules` y la instalación automática de dependencias agotó el tiempo disponible; por ello no se declara una compilación Vite completa como verificada en este entorno.
