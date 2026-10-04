-- MIGRACIÓN 002 — Respaldo en la nube (Supabase)
-- Agrega columnas para saber qué registros ya se subieron a Supabase y
-- cuáles están pendientes (se comparan contra updated_at/created_at).
-- No afecta la lógica local: la base de datos SQLite sigue siendo la
-- única fuente de verdad. Esto es solo un respaldo de un solo sentido
-- (local → nube), nunca al revés.

ALTER TABLE products ADD COLUMN synced_at TEXT;
ALTER TABLE product_variants ADD COLUMN synced_at TEXT;
ALTER TABLE sales ADD COLUMN synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_products_synced ON products(synced_at);
CREATE INDEX IF NOT EXISTS idx_variants_synced ON product_variants(synced_at);
CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced_at);
