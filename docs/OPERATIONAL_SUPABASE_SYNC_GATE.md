# Operational Supabase Sync — Implementation Gate

Status: design/verification notes only. This document does not implement synchronization and does not authorize applying SQL to a live Supabase project.

## Verified from the repository
- `services/erp-database.ts` persists the ERP repository through AsyncStorage; the business records are not shown being written to operational Supabase tables.
- `template/core/client.ts` creates a shared Supabase client with the public URL/key and persisted auth session.
- `supabase/001_pharmacy_schema.sql` defines pharmacies, pharmacy_profiles, products, product_units, and `current_pharmacy_id()`.
- `supabase/005_admin_permissions_yemeni_rial.sql` extends profile permissions and administrator policies.
- The SQL migrations currently inspected do not define a complete operational schema for sales, sale items, batch allocations, purchases, payments, returns, cash transactions, expenses, shifts, and audit events.

## Required before operational sync can be called complete
1. Define a tenant-scoped schema for every operational aggregate and its child rows. Preserve relationships and constraints; do not upload/overwrite the entire local snapshot.
2. Use stable UUIDs for cross-device entities. Existing local interfaces use numeric IDs, so add an explicit, tested local-to-cloud ID strategy before syncing records.
3. Add a durable local outbox with event UUID/idempotency key, entity type/id, operation, schema version, timestamps, retry count, and error state. Enqueue in the same local atomic mutation as the business operation.
4. Apply tenant isolation with RLS on every table using `public.current_pharmacy_id()`; verify that function ownership, grants, and policies cannot be bypassed by client-supplied pharmacy IDs.
5. Implement server-side transactional RPCs for sales, returns, purchases, and stock allocation. Enforce FEFO and stock invariants on the server; clients must not resolve concurrent stock writes independently.
6. Use idempotent acknowledgements and conflict handling. Do not use last-write-wins for financial or inventory transactions; use append-only business events or explicit conflict resolution.
7. Realtime is a notification/refresh channel, not a substitute for durable pull cursors, retries, and reconciliation.
8. Add tenant-isolation tests, duplicate replay tests, offline/reconnect tests, two-device concurrent-sale tests, and migration rollback/recovery tests.
9. Verify the actual Supabase project and Auth configuration before any migration is applied. No live database changes are made by this document.

## Rollout order
A. Schema and RLS proposal + static review.
B. Local outbox and event contracts with unit tests.
C. Server-side atomic transaction RPCs with database tests.
D. Pull/push sync worker and conflict UI.
E. Two-device staging validation, then a separately approved production rollout.

## Explicit non-goals for the first migration
- No snapshot replacement of another device's state.
- No service-role key in the app or repository.
- No automatic execution of SQL against a live project.
- No claim of working multi-device sync until the end-to-end tests pass.
