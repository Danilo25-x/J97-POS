# J97 POS — Etapa 4: correcciones de cobro y validaciones

## Cambios aplicados

### Clientes
- Documento: obligatorio, únicamente dígitos, 5–15 dígitos.
- Teléfono: obligatorio, únicamente dígitos, 7–15 dígitos.
- Frontend elimina automáticamente letras y símbolos al escribir.
- `inputMode=numeric` para teclado numérico en dispositivos compatibles.
- Backend mantiene la validación como fuente de verdad.

### Efectivo
- El monto recibido se escribe como texto numérico y se formatea automáticamente con separador de miles colombiano.
- Ejemplo: `100000` → `100.000`.
- La venta se registra por el valor real de la venta; el excedente corresponde al cambio.

### Métodos de pago
- Se mantienen únicamente: efectivo, transferencia, crédito interno y Sistecrédito.
- Una venta solo puede tener un método de pago.
- Transferencia, crédito interno y Sistecrédito deben coincidir exactamente con el total que corresponde.
- Sistecrédito no requiere cliente ni cuotas.
- Crédito interno requiere cliente y número de cuotas.

## Pruebas recomendadas
1. Crear/editar cliente con documento `ABC123`: debe bloquearse y mostrar error.
2. Crear/editar cliente con teléfono `300ABC1234`: debe bloquearse y mostrar error.
3. Crear cliente con documento `12345678` y teléfono `3001234567`: debe permitirlo.
4. Venta de `$10.000`, efectivo recibido `$100.000`: debe registrar `$10.000` y mostrar `$90.000` de cambio.
5. Venta de `$10.000` por transferencia: debe registrar exactamente `$10.000`.
6. Venta por Sistecrédito con 5%: debe calcular el recargo y no solicitar cuotas ni cliente.
