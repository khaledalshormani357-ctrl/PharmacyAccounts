-- Pharmacy Accounts — Cloud sync schema (phase 1: manual sync)
-- ============================================================================
-- Apply MANUALLY in Supabase Dashboard > SQL Editor, AFTER 001-005.
-- The mobile app never applies this file automatically.
--
-- Design:
-- - One remote table per local collection that 001 did not cover, mirroring
--   the local interfaces in services/erp-database.ts field for field.
-- - Every row has a global identity `client_id` (the local `syncId` UUID),
--   so two devices never collide on the local numeric `id`. The local
--   numeric id is never stored remotely and never used as a remote key.
-- - Cross-entity references are `*_client_id` UUIDs (e.g. a sale item
--   points at `sale_client_id`, not at a numeric sale id). No foreign keys
--   between sync tables on purpose: rows may arrive out of order during a
--   sync, and a foreign key would reject a child pushed before its parent.
--   Only `pharmacy_id` references public.pharmacies(id).
-- - `deleted_at` implements soft-delete: a deleted local row is pushed as
--   `deleted_at = now()` instead of a hard DELETE, so other devices learn
--   about the deletion on their next pull.
-- - `updated_at` drives the pull (`updated_at > lastPullAt`) and the
--   last-write-wins conflict rule. `device_id` breaks exact ties
--   deterministically (lexicographically larger device id wins).
-- - Row Level Security mirrors 001: an authenticated user only sees rows
--   of their own pharmacy, via public.current_pharmacy_id().
-- - `users` (local accounts with password hashes) are deliberately NOT
--   synced: local credentials must never leave the device.
-- - Invoice numbers (`invoice_number`, INV-######) are per-device and are
--   synced as plain text; two devices may produce the same invoice number.
--   A server-side sequence is a later phase.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── Common sync columns (repeated per table; no shared composite type,
--     so each table stays readable in the dashboard) ───────────────────────
-- id uuid primary key default gen_random_uuid(),
-- pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
-- client_id uuid not null unique,
-- updated_at timestamptz not null default now(),
-- deleted_at timestamptz,
-- device_id text

-- ─── Batches ────────────────────────────────────────────────────────────
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  product_client_id uuid,
  batch_number text not null,
  expiry_date date,
  received_date date,
  purchase_price numeric not null default 0,
  selling_price numeric,
  quantity numeric not null default 0,
  initial_quantity numeric not null default 0,
  supplier_client_id uuid,
  purchase_client_id uuid,
  status text not null default 'ACTIVE',
  notes text,
  is_opening boolean not null default false,
  quarantined_quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Stock movements ────────────────────────────────────────────────────
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  product_client_id uuid,
  batch_client_id uuid,
  type text not null,
  quantity numeric not null default 0,
  unit text not null default '',
  quantity_in_inventory_unit numeric not null default 0,
  reference_type text,
  reference_id bigint,
  note text,
  user_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Sales ──────────────────────────────────────────────────────────────
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  invoice_number text not null,
  sale_type text not null default 'cash',
  customer_client_id uuid,
  customer_name text,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  change_given numeric not null default 0,
  remaining numeric not null default 0,
  cogs numeric not null default 0,
  gross_profit numeric not null default 0,
  date timestamptz not null default now(),
  shift_client_id uuid,
  user_id bigint,
  notes text,
  cancelled boolean not null default false,
  cancelled_by bigint,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Sale items ─────────────────────────────────────────────────────────
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  sale_client_id uuid,
  product_client_id uuid,
  product_name text not null default '',
  batch_client_id uuid,
  unit text not null default '',
  unit_name text,
  quantity numeric not null default 0,
  quantity_entered numeric,
  conversion_factor numeric,
  quantity_in_inventory_unit numeric not null default 0,
  unit_price numeric not null default 0,
  base_purchase_price numeric,
  discount numeric not null default 0,
  line_total numeric not null default 0,
  cogs numeric not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Sale batch allocations ─────────────────────────────────────────────
create table if not exists public.sale_batch_allocations (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  sale_item_client_id uuid,
  batch_client_id uuid,
  quantity_allocated numeric not null default 0,
  purchase_price numeric not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Sale payments ──────────────────────────────────────────────────────
create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  sale_client_id uuid,
  amount numeric not null default 0,
  payment_method text not null default '',
  date timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Sale returns (line items travel as jsonb inside the return row) ───
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  sale_client_id uuid,
  return_number text,
  invoice_number text not null,
  customer_client_id uuid,
  user_id bigint,
  user_name text,
  settlement_method text,
  condition text,
  is_direct boolean not null default false,
  notes text,
  status text,
  idempotency_key text,
  total numeric not null default 0,
  cash_refund numeric not null default 0,
  credit_reduction numeric not null default 0,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Purchases ──────────────────────────────────────────────────────────
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  invoice_number text not null,
  supplier_client_id uuid,
  supplier_name text,
  date timestamptz not null default now(),
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  remaining numeric not null default 0,
  notes text,
  cancelled boolean not null default false,
  cancelled_by bigint,
  cancelled_at timestamptz,
  cancel_reason text,
  user_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Purchase items ─────────────────────────────────────────────────────
create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  purchase_client_id uuid,
  product_client_id uuid,
  product_name text not null default '',
  batch_number text not null default '',
  expiry_date date,
  unit text not null default '',
  unit_name text,
  quantity numeric not null default 0,
  quantity_entered numeric,
  batch_client_id uuid,
  conversion_factor numeric,
  quantity_in_inventory_unit numeric not null default 0,
  purchase_price numeric not null default 0,
  base_purchase_price numeric,
  free_quantity numeric not null default 0,
  discount numeric not null default 0,
  line_total numeric not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Purchase returns (line items travel as jsonb inside the return) ───
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  purchase_client_id uuid,
  return_number text,
  invoice_number text not null,
  supplier_client_id uuid,
  user_id bigint,
  user_name text,
  settlement_method text,
  is_direct boolean not null default false,
  notes text,
  status text,
  idempotency_key text,
  total numeric not null default 0,
  cash_refund numeric not null default 0,
  payable_reduction numeric not null default 0,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Customers ──────────────────────────────────────────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  name text not null,
  phone text,
  address text,
  credit_limit numeric not null default 0,
  balance numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Customer transactions ──────────────────────────────────────────────
create table if not exists public.customer_transactions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  customer_client_id uuid,
  type text not null,
  amount numeric not null default 0,
  balance_after numeric not null default 0,
  reference_id bigint,
  note text,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Suppliers ──────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  name text not null,
  phone text,
  address text,
  credit_limit numeric not null default 0,
  balance numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Supplier transactions ──────────────────────────────────────────────
create table if not exists public.supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  supplier_client_id uuid,
  type text not null,
  amount numeric not null default 0,
  balance_after numeric not null default 0,
  reference_id bigint,
  note text,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Cash transactions ──────────────────────────────────────────────────
create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  type text not null,
  amount numeric not null default 0,
  cashbox_id text,
  reference_type text,
  reference_id bigint,
  shift_client_id uuid,
  note text,
  user_id bigint,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Shifts ─────────────────────────────────────────────────────────────
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  user_id bigint,
  user_name text,
  opening_cash numeric not null default 0,
  expected_cash numeric,
  actual_cash numeric,
  difference numeric,
  difference_reason text,
  total_sales numeric not null default 0,
  total_collections numeric not null default 0,
  total_expenses numeric not null default 0,
  total_purchases_paid numeric not null default 0,
  status text not null default 'OPEN',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Expenses ───────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  category text not null,
  amount numeric not null default 0,
  date timestamptz not null default now(),
  shift_client_id uuid,
  note text,
  user_id bigint,
  cashbox_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Audit logs (append-only history; synced read-only for other devices)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  client_id uuid not null unique,
  user_id bigint,
  user_name text,
  action text not null,
  entity text not null,
  entity_id bigint,
  before_data text,
  after_data text,
  reason text,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ─── Extend the 001 tables with the sync columns ────────────────────────
alter table public.products
  add column if not exists client_id uuid unique,
  add column if not exists catalog_source_id text,
  add column if not exists deleted_at timestamptz,
  add column if not exists device_id text;

alter table public.product_units
  add column if not exists client_id uuid unique,
  add column if not exists product_client_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists device_id text;

-- product_units.product_id references the remote products row (uuid). The
-- sync link is product_client_id; product_id is filled best-effort when the
-- referenced product row is known, so it must be nullable for sync.
alter table public.product_units alter column product_id drop not null;

-- Backfill client_id for rows created before sync existed (e.g. products
-- seeded directly in Supabase), so they can be pulled exactly once.
update public.products set client_id = gen_random_uuid() where client_id is null;
update public.product_units set client_id = gen_random_uuid() where client_id is null;

-- ─── Indexes: pull filters on (pharmacy_id, updated_at); upsert/delete
--     look up by (pharmacy_id, client_id). ───────────────────────────────
create index if not exists batches_pharmacy_updated_idx on public.batches (pharmacy_id, updated_at);
create index if not exists batches_pharmacy_client_idx on public.batches (pharmacy_id, client_id);
create index if not exists stock_movements_pharmacy_updated_idx on public.stock_movements (pharmacy_id, updated_at);
create index if not exists stock_movements_pharmacy_client_idx on public.stock_movements (pharmacy_id, client_id);
create index if not exists sales_pharmacy_updated_idx on public.sales (pharmacy_id, updated_at);
create index if not exists sales_pharmacy_client_idx on public.sales (pharmacy_id, client_id);
create index if not exists sale_items_pharmacy_updated_idx on public.sale_items (pharmacy_id, updated_at);
create index if not exists sale_items_pharmacy_client_idx on public.sale_items (pharmacy_id, client_id);
create index if not exists sale_batch_allocations_pharmacy_updated_idx on public.sale_batch_allocations (pharmacy_id, updated_at);
create index if not exists sale_batch_allocations_pharmacy_client_idx on public.sale_batch_allocations (pharmacy_id, client_id);
create index if not exists sale_payments_pharmacy_updated_idx on public.sale_payments (pharmacy_id, updated_at);
create index if not exists sale_payments_pharmacy_client_idx on public.sale_payments (pharmacy_id, client_id);
create index if not exists sale_returns_pharmacy_updated_idx on public.sale_returns (pharmacy_id, updated_at);
create index if not exists sale_returns_pharmacy_client_idx on public.sale_returns (pharmacy_id, client_id);
create index if not exists purchases_pharmacy_updated_idx on public.purchases (pharmacy_id, updated_at);
create index if not exists purchases_pharmacy_client_idx on public.purchases (pharmacy_id, client_id);
create index if not exists purchase_items_pharmacy_updated_idx on public.purchase_items (pharmacy_id, updated_at);
create index if not exists purchase_items_pharmacy_client_idx on public.purchase_items (pharmacy_id, client_id);
create index if not exists purchase_returns_pharmacy_updated_idx on public.purchase_returns (pharmacy_id, updated_at);
create index if not exists purchase_returns_pharmacy_client_idx on public.purchase_returns (pharmacy_id, client_id);
create index if not exists customers_pharmacy_updated_idx on public.customers (pharmacy_id, updated_at);
create index if not exists customers_pharmacy_client_idx on public.customers (pharmacy_id, client_id);
create index if not exists customer_transactions_pharmacy_updated_idx on public.customer_transactions (pharmacy_id, updated_at);
create index if not exists customer_transactions_pharmacy_client_idx on public.customer_transactions (pharmacy_id, client_id);
create index if not exists suppliers_pharmacy_updated_idx on public.suppliers (pharmacy_id, updated_at);
create index if not exists suppliers_pharmacy_client_idx on public.suppliers (pharmacy_id, client_id);
create index if not exists supplier_transactions_pharmacy_updated_idx on public.supplier_transactions (pharmacy_id, updated_at);
create index if not exists supplier_transactions_pharmacy_client_idx on public.supplier_transactions (pharmacy_id, client_id);
create index if not exists cash_transactions_pharmacy_updated_idx on public.cash_transactions (pharmacy_id, updated_at);
create index if not exists cash_transactions_pharmacy_client_idx on public.cash_transactions (pharmacy_id, client_id);
create index if not exists shifts_pharmacy_updated_idx on public.shifts (pharmacy_id, updated_at);
create index if not exists shifts_pharmacy_client_idx on public.shifts (pharmacy_id, client_id);
create index if not exists expenses_pharmacy_updated_idx on public.expenses (pharmacy_id, updated_at);
create index if not exists expenses_pharmacy_client_idx on public.expenses (pharmacy_id, client_id);
create index if not exists audit_logs_pharmacy_updated_idx on public.audit_logs (pharmacy_id, updated_at);
create index if not exists audit_logs_pharmacy_client_idx on public.audit_logs (pharmacy_id, client_id);
create index if not exists products_pharmacy_updated_idx on public.products (pharmacy_id, updated_at);
create index if not exists products_pharmacy_client_idx on public.products (pharmacy_id, client_id);
create index if not exists product_units_pharmacy_updated_idx on public.product_units (pharmacy_id, updated_at);
create index if not exists product_units_pharmacy_client_idx on public.product_units (pharmacy_id, client_id);

-- ─── Row Level Security (same pattern as 001) ───────────────────────────
alter table public.batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_batch_allocations enable row level security;
alter table public.sale_payments enable row level security;
alter table public.sale_returns enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.purchase_returns enable row level security;
alter table public.customers enable row level security;
alter table public.customer_transactions enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_transactions enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.shifts enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists batches_member_all on public.batches;
create policy batches_member_all on public.batches for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists stock_movements_member_all on public.stock_movements;
create policy stock_movements_member_all on public.stock_movements for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists sales_member_all on public.sales;
create policy sales_member_all on public.sales for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists sale_items_member_all on public.sale_items;
create policy sale_items_member_all on public.sale_items for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists sale_batch_allocations_member_all on public.sale_batch_allocations;
create policy sale_batch_allocations_member_all on public.sale_batch_allocations for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists sale_payments_member_all on public.sale_payments;
create policy sale_payments_member_all on public.sale_payments for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists sale_returns_member_all on public.sale_returns;
create policy sale_returns_member_all on public.sale_returns for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists purchases_member_all on public.purchases;
create policy purchases_member_all on public.purchases for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists purchase_items_member_all on public.purchase_items;
create policy purchase_items_member_all on public.purchase_items for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists purchase_returns_member_all on public.purchase_returns;
create policy purchase_returns_member_all on public.purchase_returns for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists customers_member_all on public.customers;
create policy customers_member_all on public.customers for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists customer_transactions_member_all on public.customer_transactions;
create policy customer_transactions_member_all on public.customer_transactions for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists suppliers_member_all on public.suppliers;
create policy suppliers_member_all on public.suppliers for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists supplier_transactions_member_all on public.supplier_transactions;
create policy supplier_transactions_member_all on public.supplier_transactions for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists cash_transactions_member_all on public.cash_transactions;
create policy cash_transactions_member_all on public.cash_transactions for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists shifts_member_all on public.shifts;
create policy shifts_member_all on public.shifts for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists expenses_member_all on public.expenses;
create policy expenses_member_all on public.expenses for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());

drop policy if exists audit_logs_member_all on public.audit_logs;
create policy audit_logs_member_all on public.audit_logs for all to authenticated
using (pharmacy_id = public.current_pharmacy_id())
with check (pharmacy_id = public.current_pharmacy_id());
