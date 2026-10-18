# Operational Supabase Sync — Implementation Gate

Status: partial foundation only. No live Supabase database was changed. No operational multi-device sync is implemented yet.

## Verified from the repository
- `services/erp-database.ts` persists the ERP repository through AsyncStorage; the business records are not shown being written to operational Supabase tables.
- `template/core/client.ts` creates a shared Supabase client with the public URL/key and persisted auth session.
- `supabase/001_pharmacy_schema.sql` defines pharmacies, pharmacy_profiles, products, product_units, and `current_pharmacy_id()`.
- `supabase/005_admin_permissions_yemeni_rial.sql` extends profile permissions and administrator policies.
- Existing local entity interfaces use numeric IDs, while the pharmacy schema uses UUIDs.
- The inspected SQL does not define a complete operational schema for sales, sale items, batch allocations, purchases, payments, returns, cash transactions, expenses, shifts, and audit events.

## Change in this branch
- `supabase/006_sync_transport_ledger_proposal.sql` proposes an immutable, tenant-scoped event transport ledger with event idempotency, client ID, schema version, actor, timestamps, and RLS.
- This is a **proposal only**. It has not been applied to any Supabase project, and there is no client worker writing to or reading from this table.
- Its payload is untrusted input. It must not be replayed directly into inventory, sales, balances, or financial tables. RLS prevents cross-pharmacy access only if the existing profile mapping and `current_pharmacy_id()` are correctly configured; that has not been runtime-tested here.

## Required before operational sync can be called complete
1. Define and migrate a tenant-scoped operational schema for every aggregate and child row. Preserve relationships and constraints; do not upload/overwrite the entire local snapshot.
2. Introduce a tested stable local-to-cloud ID mapping; do not assume numeric local IDs equal cloud UUIDs.
3. Add a durable local outbox with event UUID/idempotency key, entity type/id, operation, schema version, timestamps, retry count, and error state. Enqueue in the same durable local transaction as each business operation.
4. Verify RLS, function ownership/grants, profile mapping, and tenant isolation against a disposable Supabase project.
5. Implement server-side transactional RPCs for sales, returns, purchases, and stock allocation. Enforce FEFO and stock invariants on the server; clients must not resolve concurrent stock writes independently.
6. Use idempotent acknowledgements and explicit conflict handling. Do not use last-write-wins for financial or inventory transactions.
7. Implement durable pull cursors, retries, reconciliation, and realtime refresh notifications.
8. Add tenant-isolation tests, duplicate replay tests, offline/reconnect tests, two-device concurrent-sale tests, and migration rollback/recovery tests.
9. Verify the actual Supabase project and Auth configuration before any migration is applied. Never put a service-role key in the app or repository.

## Rollout order
A. Review schema/RLS proposal in a disposable project.
B. Implement local outbox and event contracts with unit tests.
C. Implement server-side atomic transaction RPCs with database tests.
D. Implement push/pull worker, acknowledgement, retry, and conflict UI.
E. Validate on two devices in staging, then seek separate approval for production rollout.

## Explicit non-goals
- No snapshot replacement of another device's state.
- No service-role key in the app or repository.
- No automatic execution of SQL against a live project.
- No claim of working multi-device sync until end-to-end tests pass.
