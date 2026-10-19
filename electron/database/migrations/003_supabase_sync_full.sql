-- MIGRACIÓN 003 — Ampliación del respaldo en la nube: clientes y caja
-- Se agrega seguimiento de sincronización a las tablas necesarias para que
-- una restauración de emergencia (en un computador nuevo) recupere también
-- clientes, créditos internos y el historial de caja — no solo productos
-- y ventas.

ALTER TABLE customers       ADD COLUMN synced_at TEXT;
ALTER TABLE cash_registers  ADD COLUMN synced_at TEXT;
ALTER TABLE cash_expenses   ADD COLUMN synced_at TEXT;
ALTER TABLE cash_income     ADD COLUMN synced_at TEXT;
ALTER TABLE credits         ADD COLUMN synced_at TEXT;
ALTER TABLE credit_payments ADD COLUMN synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_synced      ON customers(synced_at);
CREATE INDEX IF NOT EXISTS idx_cash_registers_synced ON cash_registers(synced_at);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_synced  ON cash_expenses(synced_at);
CREATE INDEX IF NOT EXISTS idx_cash_income_synced    ON cash_income(synced_at);
CREATE INDEX IF NOT EXISTS idx_credits_synced        ON credits(synced_at);
CREATE INDEX IF NOT EXISTS idx_credit_payments_synced ON credit_payments(synced_at);

-- Las ventas ya sincronizadas con la versión anterior no incluían el
-- número de caja (cash_register_id). Se marcan como pendientes otra vez
-- para que se vuelvan a subir completas.
UPDATE sales SET synced_at = NULL;
