# J97 — estrategia para futura migración a Supabase

## ¿Se puede mantener SQLite local y Supabase al mismo tiempo?

Sí. Para J97 se recomienda una arquitectura **local-first**:

1. SQLite local sigue siendo la fuente de operación cuando el POS trabaja en el computador.
2. Las operaciones confirmadas se registran localmente dentro de transacciones.
3. Una futura cola de sincronización (`outbox`) registrará qué cambios deben enviarse a Supabase.
4. Un proceso de sincronización enviará los cambios cuando exista conexión.
5. Supabase funcionará como respaldo/sincronización central y permitirá consultar información desde otros dispositivos si posteriormente se habilita esa necesidad.

## Lo que no se debe hacer

No conviene escribir directamente a SQLite y Supabase en la misma operación esperando que ambas siempre respondan. Si una escritura remota falla después de guardar localmente, el POS podría quedar bloqueado o generar duplicados.

La sincronización debe ser **eventual y controlada**.

## Preparación importante

El esquema local actual utiliza claves primarias INTEGER. Antes de una sincronización real conviene definir un identificador estable por entidad (por ejemplo UUID) o una tabla de correspondencia `local_id` / `remote_id`.

Las ventas, movimientos de inventario, cierres de caja y cobros deben conservar su identidad y orden de eventos.

## Imágenes

Las imágenes locales pueden seguir funcionando en SQLite + almacenamiento local durante la etapa offline. Cuando se migre a Supabase, la referencia `image_path` debe convertirse progresivamente en una referencia de Storage (bucket + path), sin guardar el archivo binario dentro de SQLite/Postgres.

## Orden recomendado de una futura migración

1. Definir IDs estables.
2. Crear esquema equivalente en Supabase/Postgres.
3. Crear bucket de imágenes.
4. Crear capa de repositorios/adaptadores.
5. Implementar outbox local.
6. Implementar sincronización y reintentos idempotentes.
7. Resolver conflictos.
8. Migrar datos históricos.
9. Probar offline/online.
10. Solo después decidir si SQLite continúa como caché local o si determinadas áreas pasan a depender directamente de Supabase.
