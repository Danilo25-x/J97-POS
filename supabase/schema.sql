-- ============================================================
-- J97 POS — Esquema de Supabase (web, respaldo sincronizado)
-- Ejecutar UNA VEZ en: SQL Editor → New query (proyecto nuevo).
--
-- Seguridad:
--  · RLS activo en TODAS las tablas.
--  · Solo usuarios AUTENTICADOS con perfil activo pueden leer/escribir.
--    La llave anon (pública) no puede leer ni escribir nada.
--  · No hay llaves de servicio en el navegador.
-- IDs: texto (UUID) generados por la app, igual que la base local.
-- Fechas: texto ISO (igual que la app).
-- ============================================================

-- Perfiles de usuario (uno por cuenta de Supabase Auth).
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  role        text not null default 'cashier',
  is_active   boolean not null default true,
  updated_at  text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- Función de seguridad: ¿el usuario que llama tiene perfil activo?
create or replace function public.is_active_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

-- ---------- Tablas de datos (todas con updated_at para sincronizar por cambios) ----------
create table if not exists public.settings (
  key        text primary key,
  value      text,
  updated_at text not null
);

create table if not exists public.audit_logs (
  id          text primary key,
  user_id     text,
  action      text not null,
  entity      text,
  entity_id   text,
  details     text,
  ip          text,
  created_at  text not null,
  updated_at  text not null
);

create table if not exists public.categories (
  id          text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  text not null,
  updated_at  text not null
);

create table if not exists public.brands (
  id          text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  text not null,
  updated_at  text not null
);

create table if not exists public.suppliers (
  id          text primary key,
  name        text not null,
  phone       text,
  email       text,
  address     text,
  is_active   boolean not null default true,
  created_at  text not null,
  updated_at  text not null
);

create table if not exists public.customers (
  id          text primary key,
  name        text not null,
  document    text not null,
  phone       text not null,
  email       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  text not null,
  updated_at  text not null
);

create table if not exists public.products (
  id           text primary key,
  name         text not null,
  sku          text,
  barcode      text,
  description  text,
  category_id  text,
  brand_id     text,
  supplier_id  text,
  cost_price   numeric not null default 0,
  sale_price   numeric not null default 0,
  stock_min    integer not null default 0,
  image_path   text,
  is_active    boolean not null default true,
  created_at   text not null,
  updated_at   text not null
);

create table if not exists public.product_variants (
  id              text primary key,
  product_id      text not null,
  sku_variant     text,
  size            text not null,
  color           text not null,
  stock           integer not null default 0,
  price_override  numeric,
  barcode         text,
  image_path      text,
  is_active       boolean not null default true,
  created_at      text not null,
  updated_at      text not null
);

create table if not exists public.cash_registers (
  id                          text primary key,
  user_id                     text,
  opening_amount              numeric not null default 0,
  opened_at                   text not null,
  closed_at                   text,
  status                      text not null default 'open',
  closing_amount              numeric,
  expected_amount             numeric,
  difference                  numeric,
  total_sales                 numeric not null default 0,
  total_expenses              numeric not null default 0,
  cash_sales                  numeric not null default 0,
  transfer_sales              numeric not null default 0,
  credit_sales                numeric not null default 0,
  sistecredito_sales          numeric not null default 0,
  credit_collection_cash      numeric not null default 0,
  credit_collection_transfer  numeric not null default 0,
  total_credit_collections    numeric not null default 0,
  notes                       text,
  updated_at                  text not null
);

create table if not exists public.sales (
  id                 text primary key,
  invoice_number     text not null unique,
  user_id            text,
  cash_register_id   text not null,
  customer_id        text,
  subtotal           numeric not null default 0,
  tax_amt            numeric not null default 0,
  total              numeric not null default 0,
  status             text not null default 'completed',
  notes              text,
  created_at         text not null,
  cancelled_at       text,
  cancelled_by       text,
  cancel_reason      text,
  financing_method   text not null default 'none',
  financing_pct      numeric not null default 0,
  financing_base     numeric not null default 0,
  financing_total    numeric not null default 0,
  installment_count  integer not null default 1,
  installment_amount numeric not null default 0,
  final_installment  numeric not null default 0,
  updated_at         text not null
);

create table if not exists public.sale_items (
  id              text primary key,
  sale_id         text not null,
  variant_id      text,
  product_name    text not null,
  size            text,
  color           text,
  qty             integer not null,
  unit_price      numeric not null default 0,
  discount_pct    numeric not null default 0,
  discount_amount numeric not null default 0,
  line_total      numeric not null default 0,
  updated_at      text not null
);

create table if not exists public.payments (
  id         text primary key,
  sale_id    text not null,
  method     text not null,
  amount     numeric not null,
  reference  text,
  created_at text not null,
  updated_at text not null
);

create table if not exists public.invoices (
  id         text primary key,
  sale_id    text not null unique,
  created_at text not null,
  updated_at text not null
);

create table if not exists public.cash_expenses (
  id                text primary key,
  cash_register_id  text not null,
  user_id           text,
  description       text not null,
  category          text not null default 'Otros',
  amount            numeric not null,
  observation       text,
  created_at        text not null,
  updated_at        text not null
);

create table if not exists public.inventory_movements (
  id           text primary key,
  variant_id   text not null,
  user_id      text,
  type         text not null,
  qty          integer not null,
  stock_before integer not null,
  stock_after  integer not null,
  reference    text,
  notes        text,
  created_at   text not null,
  updated_at   text not null
);

create table if not exists public.credits (
  id                 text primary key,
  customer_id        text not null,
  sale_id            text not null unique,
  total_amount       numeric not null,
  installment_count  integer not null,
  installment_amount numeric not null,
  paid_amount        numeric not null default 0,
  balance            numeric not null,
  status             text not null default 'pending',
  created_at         text not null,
  updated_at         text not null
);

create table if not exists public.credit_payments (
  id             text primary key,
  credit_id      text not null,
  user_id        text,
  amount         numeric not null,
  notes          text,
  payment_method text not null default 'efectivo',
  created_at     text not null,
  updated_at     text not null
);

create table if not exists public.cash_income (
  id                text primary key,
  cash_register_id  text not null,
  user_id           text,
  source            text not null default 'credit_payment',
  reference_id      text,
  description       text not null,
  amount            numeric not null,
  payment_method    text not null,
  created_at        text not null,
  updated_at        text not null
);

-- ---------- Seguridad: RLS en todas las tablas, solo miembros activos ----------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','audit_logs','categories','brands','suppliers','customers','products',
    'product_variants','cash_registers','sales','sale_items','payments','invoices',
    'cash_expenses','inventory_movements','credits','credit_payments','cash_income'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "miembro_activo" on public.%I', t);
    execute format(
      'create policy "miembro_activo" on public.%I for all to authenticated
         using (public.is_active_member()) with check (public.is_active_member())', t);
  end loop;
end $$;

-- Perfiles: cada usuario ve su propio perfil; solo se cambia desde el panel de Supabase.
alter table public.profiles enable row level security;
drop policy if exists "perfil_propio" on public.profiles;
create policy "perfil_propio" on public.profiles for select to authenticated
  using (id = auth.uid());

-- ---------- Bucket de fotos de productos ----------
-- Público para que las fotos se vean por URL; subir, cambiar y borrar exige sesión activa.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "fotos_leer" on storage.objects;
drop policy if exists "fotos_subir" on storage.objects;
drop policy if exists "fotos_cambiar" on storage.objects;
drop policy if exists "fotos_borrar" on storage.objects;
create policy "fotos_leer"    on storage.objects for select to anon, authenticated using (bucket_id = 'product-images');
create policy "fotos_subir"   on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_active_member());
create policy "fotos_cambiar" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.is_active_member()) with check (bucket_id = 'product-images' and public.is_active_member());
create policy "fotos_borrar"  on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.is_active_member());

-- ---------- Crear el primer administrador (una sola vez, después de crear su cuenta en Auth) ----------
-- insert into public.profiles (id, name, role, is_active)
-- values ('UUID-DEL-USUARIO-DE-AUTH', 'Administrador', 'admin', true);
