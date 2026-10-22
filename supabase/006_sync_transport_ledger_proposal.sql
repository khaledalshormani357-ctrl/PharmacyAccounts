-- Smart Pharmacy ERP: sync transport ledger (proposal only).
-- This is NOT the operational source of truth and does not implement ERP sync.
-- Review in a disposable Supabase project before applying anywhere.
-- Business writes must later be implemented by validated, transactional RPCs.

begin;

create table if not exists public.pharmacy_sync_events (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  event_id uuid not null,
  client_id uuid not null,
  entity_type text not null check (
    entity_type in (
      'product', 'product_unit', 'batch', 'stock_movement',
      'sale', 'sale_item', 'sale_payment', 'sale_return',
      'purchase', 'purchase_item', 'purchase_return',
      'customer', 'supplier', 'cash_transaction', 'shift',
      'expense', 'audit_log'
    )
  ),
  entity_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  schema_version integer not null default 1 check (schema_version > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (pharmacy_id, event_id)
);

create index if not exists pharmacy_sync_events_pull_idx
  on public.pharmacy_sync_events (pharmacy_id, received_at, id);

create index if not exists pharmacy_sync_events_entity_idx
  on public.pharmacy_sync_events (pharmacy_id, entity_type, entity_id);

alter table public.pharmacy_sync_events enable row level security;

drop policy if exists pharmacy_sync_events_member_select on public.pharmacy_sync_events;
create policy pharmacy_sync_events_member_select
  on public.pharmacy_sync_events
  for select to authenticated
  using (pharmacy_id = public.current_pharmacy_id());

drop policy if exists pharmacy_sync_events_member_insert on public.pharmacy_sync_events;
create policy pharmacy_sync_events_member_insert
  on public.pharmacy_sync_events
  for insert to authenticated
  with check (
    pharmacy_id = public.current_pharmacy_id()
    and actor_id = auth.uid()
  );

-- Deliberately no UPDATE/DELETE policies: events are immutable for clients.
-- This table is transport/audit metadata only. Never replay its payload directly
-- into stock, sales, balances, or financial tables without server-side validation.

commit;
