-- ============================================================
-- J'97 POS — Esquema de respaldo en Supabase
-- Ejecutar UNA SOLA VEZ en: Supabase → tu proyecto → SQL Editor → New query
-- ============================================================
-- Esto crea un ESPEJO de solo respaldo. La app de escritorio (SQLite)
-- sigue siendo la única fuente de verdad: esta base de datos en la nube
-- nunca se edita desde aquí, solo recibe lo que la app le envía.
-- Los IDs son los mismos que en tu base de datos local (no se regeneran),
-- así que el respaldo siempre queda sincronizado 1 a 1 con tu SQLite.

create table if not exists products (
  id              bigint primary key,
  sku             text not null,
  name            text not null,
  description     text,
  category_name   text,
  brand_name      text,
  cost_price      numeric not null default 0,
  sale_price      numeric not null default 0,
  image_url       text,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now(),
  synced_at       timestamptz not null default now()
);

create table if not exists product_variants (
  id              bigint primary key,
  product_id      bigint not null references products(id) on delete cascade,
  sku_variant     text not null,
  size            text not null,
  color           text not null,
  stock           integer not null default 0,
  price_override  numeric,
  barcode         text,
  image_url       text,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now(),
  synced_at       timestamptz not null default now()
);
create index if not exists idx_variants_product on product_variants(product_id);

create table if not exists sales (
  id                  bigint primary key,
  invoice_number      text not null,
  customer_id         bigint,
  subtotal            numeric not null,
  tax_amt             numeric not null default 0,
  total               numeric not null,
  status              text not null,
  financing_method    text,
  financing_total     numeric,
  created_at          timestamptz not null,
  cancelled_at        timestamptz,
  cancel_reason       text,
  synced_at           timestamptz not null default now()
);

create table if not exists sale_items (
  id              bigint primary key,
  sale_id         bigint not null references sales(id) on delete cascade,
  variant_id      bigint,
  product_name    text not null,
  size            text,
  color           text,
  qty             integer not null,
  unit_price      numeric not null,
  discount_pct    numeric not null default 0,
  line_total      numeric not null
);
create index if not exists idx_sale_items_sale on sale_items(sale_id);

create table if not exists payments (
  id          bigint primary key,
  sale_id     bigint not null references sales(id) on delete cascade,
  method      text not null,
  amount      numeric not null,
  reference   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_payments_sale on payments(sale_id);

-- ── Almacenamiento de imágenes ────────────────────────────────
-- Bucket público: así una futura página web puede mostrar las imágenes
-- directamente con la URL, sin pasar por tu app.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ── Seguridad (RLS) ────────────────────────────────────────────
-- Este proyecto lo usa únicamente tu app de escritorio (no es una app
-- pública con miles de usuarios), así que se usa la llave "anon" con
-- permisos solo de lectura/escritura sobre estas tablas de respaldo
-- (nunca de borrado de filas; el borrado de imágenes se hace aparte,
-- vía Storage, cuando un producto se queda sin stock).
alter table products         enable row level security;
alter table product_variants enable row level security;
alter table sales             enable row level security;
alter table sale_items        enable row level security;
alter table payments          enable row level security;

create policy "app_backup_read"   on products         for select using (true);
create policy "app_backup_write"  on products         for insert with check (true);
create policy "app_backup_update" on products         for update using (true);

create policy "app_backup_read"   on product_variants for select using (true);
create policy "app_backup_write"  on product_variants for insert with check (true);
create policy "app_backup_update" on product_variants for update using (true);

create policy "app_backup_read"   on sales             for select using (true);
create policy "app_backup_write"  on sales             for insert with check (true);
create policy "app_backup_update" on sales             for update using (true);

create policy "app_backup_read"   on sale_items        for select using (true);
create policy "app_backup_write"  on sale_items        for insert with check (true);

create policy "app_backup_read"   on payments          for select using (true);
create policy "app_backup_write"  on payments          for insert with check (true);
