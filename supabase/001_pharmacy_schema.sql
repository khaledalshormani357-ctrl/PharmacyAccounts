-- Pharmacy Accounts — Supabase foundation schema
-- Run this file once in Supabase Dashboard > SQL Editor.
-- Never place the service_role key in the mobile app.

create extension if not exists pgcrypto;

create type public.pharmacy_role as enum ('ADMIN', 'PHARMACIST', 'CASHIER', 'STOREKEEPER', 'ACCOUNTANT');

create table if not exists public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text,
  currency text not null default 'ريال سعودي',
  currency_symbol text not null default 'ر.س',
  phone text,
  address text,
  license_number text,
  tax_number text,
  receipt_header text,
  receipt_footer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pharmacy_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  username text not null,
  full_name text not null,
  phone text,
  role public.pharmacy_role not null default 'CASHIER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, username)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  barcode text,
  internal_code text,
  trade_name text not null,
  generic_name text,
  active_ingredient text,
  strength text,
  dosage_form text,
  manufacturer text,
  category text,
  prescription_required boolean not null default false,
  controlled boolean not null default false,
  inventory_unit text not null default 'قطعة',
  minimum_stock numeric not null default 0 check (minimum_stock >= 0),
  reorder_level numeric not null default 0 check (reorder_level >= 0),
  selling_price numeric not null default 0 check (selling_price >= 0),
  default_purchase_price numeric not null default 0 check (default_purchase_price >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, barcode),
  unique (pharmacy_id, internal_code)
);

create table if not exists public.product_units (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  unit_name text not null,
  conversion_factor numeric not null check (conversion_factor > 0),
  sale_price numeric not null default 0 check (sale_price >= 0),
  purchase_price numeric not null default 0 check (purchase_price >= 0),
  is_purchase_default boolean not null default false,
  is_sale_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, unit_name)
);

create index if not exists products_pharmacy_id_idx on public.products(pharmacy_id);
create index if not exists product_units_product_id_idx on public.product_units(product_id);
create index if not exists pharmacy_profiles_pharmacy_id_idx on public.pharmacy_profiles(pharmacy_id);

create or replace function public.current_pharmacy_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pharmacy_id from public.pharmacy_profiles where id = auth.uid() and active = true limit 1;
$$;

create or replace function public.current_pharmacy_role()
returns public.pharmacy_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.pharmacy_profiles where id = auth.uid() and active = true limit 1;
$$;

create or replace function public.is_pharmacy_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_pharmacy_role() = 'ADMIN', false);
$$;

alter table public.pharmacies enable row level security;
alter table public.pharmacy_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_units enable row level security;

drop policy if exists pharmacies_member_select on public.pharmacies;
create policy pharmacies_member_select on public.pharmacies for select to authenticated
using (id = public.current_pharmacy_id());

drop policy if exists pharmacies_admin_update on public.pharmacies;
create policy pharmacies_admin_update on public.pharmacies for update to authenticated
using (id = public.current_pharmacy_id() and public.is_pharmacy_admin())
with check (id = public.current_pharmacy_id() and public.is_pharmacy_admin());

drop policy if exists profiles_same_pharmacy_select on public.pharmacy_profiles;
create policy profiles_same_pharmacy_select on public.pharmacy_profiles for select to authenticated
using (pharmacy_id = public.current_pharmacy_id());

drop policy if exists profiles_admin_insert on public.pharmacy_profiles;
create policy profiles_admin_insert on public.pharmacy_profiles for insert to authenticated
with check (pharmacy_id = public.current_pharmacy_id() and public.is_pharmacy_admin());

drop policy if exists profiles_admin_update on public.pharmacy_profiles;
create policy profiles_admin_update on public.pharmacy_profiles for update to authenticated
using (pharmacy_id = public.current_pharmacy_id() and public.is_pharmacy_admin())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists products_member_all on public.products;
create policy products_member_all on public.products for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists product_units_member_all on public.product_units;
create policy product_units_member_all on public.product_units for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

-- Create a profile automatically when an Auth user is created.
-- The first user must be linked to a pharmacy by the bootstrap SQL below.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_pharmacy uuid;
  requested_role public.pharmacy_role;
begin
  target_pharmacy := nullif(new.raw_user_meta_data->>'pharmacy_id', '')::uuid;
  requested_role := coalesce(nullif(new.raw_user_meta_data->>'role', '')::public.pharmacy_role, 'CASHIER');
  if target_pharmacy is not null then
    insert into public.pharmacy_profiles (id, pharmacy_id, username, full_name, role)
    values (
      new.id,
      target_pharmacy,
      coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
      coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
      requested_role
    )
    on conflict (id) do update set
      username = excluded.username,
      full_name = excluded.full_name;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Bootstrap helper: run after creating the first Auth user.
-- Replace the two placeholders, then run once:
-- insert into public.pharmacies (name, owner_name) values ('اسم الصيدلية', 'اسم المالك') returning id;
-- insert into public.pharmacy_profiles (id, pharmacy_id, username, full_name, role)
-- values ('AUTH_USER_UUID', 'PHARMACY_UUID', 'admin', 'المدير', 'ADMIN');
