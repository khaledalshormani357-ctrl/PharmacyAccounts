# SQLite Migration — Phase 1: Persistence Layer

## Why

Until this phase the whole store was a single JSON snapshot in
AsyncStorage under `@pharmacy_accounts/store/v1`, re-serialised and
re-written in full on every mutation — including every `addAuditLog`
call. That meant:

- No real transactions on disk: a crash mid-write could leave a torn
  snapshot (the corrupt-snapshot quarantine from PR #35 was the
  safety net, not a fix).
- No differential writes: changing one row rewrote every product,
  batch, sale and audit log.
- No durable atomicity: `commitReturnAtomically()` rolled back the
  in-memory store, but `addAuditLog()` inside the commit already
  persisted an intermediate snapshot to disk.

Phase 1 replaces only the persistence layer. The in-memory store in
`services/erp-database.ts` keeps its shape, and every public service
function keeps its signature and behaviour.

## Schema (`services/sqlite-store.ts`, `buildSchemaSql()`)

Database file: `pharmacy.db` (expo-sqlite).

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
  collection TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (collection, row_id)
);
CREATE INDEX IF NOT EXISTS idx_collections_collection
  ON collections (collection);
```

- `collections`: one row per entity row, `data` is the JSON of that row.
  The 21 collections are the entity arrays of the store
  (`users`, `products`, `productUnits`, `batches`, `stockMovements`,
  `sales`, `saleItems`, `saleBatchAllocations`, `salePayments`,
  `saleReturns`, `purchases`, `purchaseItems`, `purchaseReturns`,
  `customers`, `customerTransactions`, `suppliers`,
  `supplierTransactions`, `cashTransactions`, `shifts`, `expenses`,
  `auditLogs`). Nested data (e.g. the `items` inside a `SaleReturn`)
  stays embedded in its parent row, exactly as in the JSON snapshot.
- `meta`: singletons and counters as JSON — `schema_version`,
  `ids` (next-id counters), `invoice_counter`, `settings` (one JSON
  blob, not one row per setting), `pharmacy` (object or `null`), and
  `migrated_from_asyncstorage` (`'1'` after the one-time migration).
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` are
  applied best-effort at open (WAL is not available on every platform).

## How writes work

- `erp-database.ts` keeps a serialised-rows baseline of the last
  successfully saved snapshot (`lastSavedRows`). Every `persistStore()`
  computes `diffRows(baseline, current)` and writes only changed, new
  and deleted rows plus changed meta, through the adapter's `saveDiff`.
  The first persist after a load (or after a backend swap) writes a
  full snapshot.
- Every adapter save runs inside one transaction (`BEGIN IMMEDIATE /
  COMMIT`, `ROLLBACK` on failure). `ExpoSqliteAdapter` uses the
  expo-sqlite async API (`openDatabaseAsync`, `execAsync`, `runAsync`,
  `getAllAsync`, `getFirstAsync` — verified against the official Expo
  docs and the expo-sqlite 15 type declarations).
- `commitReturnAtomically()` now defers persistence while the commit
  runs (`deferPersistCount`): `addAuditLog()` inside a commit no longer
  writes an intermediate snapshot. The deferred write is flushed
  exactly once when the outermost commit exits — after a success, or
  after a rollback restores the previous state. Nested atomic commits
  share the counter.
- Writes are still serialised through the existing `persistQueue`, and
  `flushDatabaseWrites()` still resolves only after queued writes
  reach storage. A failed write leaves the baseline untouched, so the
  next persist retries the same diff.

## Adapters (`PersistenceAdapter`)

| Adapter | When | Notes |
| --- | --- | --- |
| `ExpoSqliteAdapter` | Native devices | `pharmacy.db`, real transactions, differential writes. |
| `AsyncStorageAdapter` | Web, Node (unit tests) | Same legacy snapshot key; `saveDiff` is read-modify-write (no transactions in AsyncStorage) and is only used where the caller serialises writes. |
| `InMemoryAdapter` | Tests only | Deep-clones on save; a serialisation failure or an injected `failBeforeCommit` hook throws before anything is committed. |

`createDefaultAdapter()` returns SQLite on native devices and
AsyncStorage elsewhere. Detection is synchronous and dependency-free:
React Native sets `navigator.product` to `'ReactNative'`; Node and web
browsers do not. `expo-sqlite` is loaded lazily (dynamic import), so
the unit-test build never needs the native module. If the SQLite
database cannot be opened at startup, `hydrateStore()` falls back to
the legacy AsyncStorage snapshot rather than starting empty.

Test hooks: `setPersistenceBackend(adapter)`,
`getPersistenceBackendName()`, `getMigrationStatus()`.

## One-time migration

On first launch with an empty SQLite database, `hydrateStore()` calls
`migrateFromAsyncStorageIfNeeded()` (also exported for tests and for
the system-tools screen):

1. Read the legacy AsyncStorage snapshot.
2. If it parses, apply it to the in-memory store and save it into
   SQLite, then set meta `migrated_from_asyncstorage = '1'`.
3. The legacy AsyncStorage copy is **kept as-is** — it is the rollback.

A corrupt legacy snapshot is quarantined exactly as before (PR #35)
under `@pharmacy_accounts/store/v1/corrupt-<timestamp>`, and the app
opens with defaults.

`getMigrationStatus()` reports `{ backend, migratedFromAsyncStorage,
corruptSnapshotKey }` for the system-tools screen.

## Rollback plan

- **Before the migration runs:** nothing changed on disk; delete
  `pharmacy.db` and the app re-reads AsyncStorage (or migrates again).
- **After the migration runs:** the legacy AsyncStorage snapshot is
  still intact. To roll back manually: delete the app's `pharmacy.db`
  file (or clear app storage for SQLite only, if the platform exposes
  it) — the next launch migrates the legacy snapshot again. Do not
  delete the AsyncStorage snapshot itself; it is the only copy of
  pre-migration data until the user makes a new backup.
- The JSON backup/restore flow (`createBackup` / `restoreBackup`) is
  unchanged and works the same on either backend.

## What Phase 1 deliberately does NOT do

- No service function was rewritten into SQL queries; the services
  still operate on the in-memory store. Reads, FEFO allocation,
  reports and the atomic commit logic are unchanged.
- No screen in `app/` was changed.
- AsyncStorage was not removed: it remains the backend on web and in
  tests, and the legacy snapshot remains the rollback copy on native.

## Phase 2 (implemented)

Typed tables and a SQL read layer, in `services/sqlite-typed.ts`
(`SCHEMA_VERSION = '2'`).

### Typed tables (`buildTypedSchemaSql()`)

16 tables, one per hot collection plus the two return collections
the report summaries need: `products`, `batches`, `sales`,
`sale_items`, `sale_batch_allocations`, `sale_payments`,
`sale_returns`, `customers`, `suppliers`, `purchases`,
`purchase_items`, `purchase_returns`, `stock_movements`,
`cash_transactions`, `shifts`, `expenses`. Columns mirror the
TypeScript interfaces in `erp-database.ts` (INTEGER/REAL/TEXT,
booleans as INTEGER 0/1 with NULL preserved for legacy rows, dates as
TEXT in the same shapes as the in-memory store). Every table carries
`sync_id TEXT UNIQUE`, `sync_device_id TEXT` and `updated_at TEXT`
(the cloud-sync identity from PR #38); `products` additionally keeps
its domain `updated_at` column *and* a `sync_updated_at` column,
because `Product` has both fields. Return line items stay embedded
as `items_json TEXT`, and `sale_returns` also stores a precomputed
`returned_cogs_total` so report queries never need `json_each()`.
A `schema_migrations(version, applied_at)` table ledgers migrations.

Indexes: `batches(product_id, expiry_date)`, `sales(date)`,
`sale_items(sale_id, product_id)`, `stock_movements(product_id,
created_at)`, `customers`/`suppliers` on name, plus per-table
foreign-key-ish lookup indexes (see `buildTypedSchemaSql()`). No
UNIQUE constraints besides `id` and `sync_id`, so legacy rows can
never fail the migration on a duplicate business key.

Collections with no typed table (`users`, `productUnits`,
`customerTransactions`, `supplierTransactions`, `auditLogs`,
`syncOutbox`) stay in the generic `collections` table only.

### Migration v2 (`migrateToTypedTables()`)

Runs when `meta.schema_version` is `'1'` or absent: reads every row
of `collections`, inserts it into its typed table, stamps
`schema_version = '2'` and records the migration — all inside one
transaction (or inside the caller's transaction when the adapters
invoke it with `inTransaction: true`). It is idempotent: at version
2 or newer it does nothing. Corrupt rows (unparseable JSON) are
counted in `skipped` and never abort the migration. The generic
`collections` table is **never dropped**: it stays the rollback
source. The `ExpoSqliteAdapter` creates the typed tables at open and
runs the migration inside its first write transaction, so the generic
and typed tables can never disagree afterwards.

### Dual-write

Every adapter write mirrors the same diff into both stores in one
transaction: `applyDiffToGenericTables` + `applyDiffToTypedTables`
for diffs, `applySnapshotToGenericTables` +
`rebuildTypedTablesFromRows` for full saves. The `AsyncStorage` and
`InMemory` adapters have no SQLite behind them and ignore the typed
tables; reads then fall back to the in-memory store.

### SQL read layer

Pure functions over a small `TypedDb` interface (`exec`/`run`/`all`/
`get`), so the same code runs on expo-sqlite in the app and on
`node:sqlite` in the tests — no expo or node import lives in
`services/`:

- `allocateFefo(db, productId, quantity)` — earliest-expiry ACTIVE
  batches with stock first (no expiry date sorts last); returns `[]`
  when stock cannot cover the quantity (the in-memory version returns
  `null` there). It only allocates; it never mutates.
- `getLowStock(db)` — total ACTIVE quantity below `minimum_stock`,
  including products with no batches (quantity 0), active products
  only. This is broader than the dashboard count, which excludes
  out-of-stock products and uses `<= minimum_stock`.
- `getExpiringBatches(db, days)` / `getExpiredBatches(db)` /
  `getInventorySummary(db, productId)` — day differences use
  `CAST(julianday(expiry) - julianday(today) AS INTEGER)`, exact for
  date-only strings (`ceil()` is avoided: it is not compiled into
  every SQLite build).
- `getSalesSummary` / `getReportSummarySql` / `getDashboardKpisSql`
  / `getExpiryRadarSql` / `getInventoryListSql` — SQL equivalents of
  `getReportSummary`, `getDashboardKpis`, `getExpiryRadar` and
  `getInventoryList`, matching their rules exactly (cancelled sales /
  purchases / returns excluded; `mixed` sales split into
  `amount_paid` cash and `remaining` credit; returns reduce cash /
  credit sales and COGS; inventory status precedence
  expired > expiring > out > low > ok).

### Wiring in `erp-database.ts` (reads only, safe fallback)

The public synchronous read functions are unchanged — expo-sqlite is
async, so a synchronous function cannot query it without changing
its signature. New `*Async` variants sit next to them
(`getDashboardKpisAsync`, `getReportSummaryAsync`,
`getExpiryRadarAsync`, `getInventoryListAsync`,
`getLowStockProductsAsync`): they prefer SQL when the typed store is
ready and fall back to the in-memory computation on any failure
(wrong backend, migration not run, SQL error — swallowed with a
`console.warn`), so a read can never fail because of the typed
store. `ensureTypedStoreReady()` / `isTypedStoreReady()` /
`getTypedStoreStatus()` expose readiness for tests and the
system-tools screen. The FEFO path inside `createSale` is unchanged
(still in-memory); the tests prove the SQL allocator returns the
same allocation for the same sale.

## Rollback plan (Phase 2)

- The generic `collections` table still holds every row, so deleting
  `pharmacy.db` and re-migrating from the AsyncStorage snapshot (or a
  JSON backup) rebuilds everything, typed tables included.
- If a typed table is ever found inconsistent, it can be rebuilt from
  `collections` alone: `rebuildTypedTablesFromRows()` does exactly
  that from a snapshot (it is the full-save path).
- Reads never depend on the typed tables: any SQL failure falls back
  to the in-memory computation with identical results.

## What Phase 2 deliberately does NOT do

- The write path is still in-memory: mutations go through
  `persistStore()` and are mirrored to SQLite; no service function
  writes through SQL directly, and the atomic commit logic is
  unchanged.
- No screen in `app/` was changed (the `*Async` variants are
  available for screens to adopt incrementally).
- AsyncStorage was not removed.

## Phase 3 (implemented) — the sale write moves to SQL

Scope: **only `createSale`** writes through SQL. Purchases, returns
and cancellations still use the old in-memory path (see «What Phase 3
deliberately does NOT do» below). No screen in `app/` was changed and
no public function signature changed.

### The plan-then-execute model (`services/sqlite-writes.ts`)

A sale is split into two steps that are deliberately kept apart:

1. **Plan** — `buildSaleWritePlan(input, snapshot): SaleWritePlan`
   is a pure function: it takes the sale inputs and a read-only
   snapshot of the current state (products, batches, customer,
   counters) and builds the complete set of rows the sale will
   write, **without writing anything**. It validates the credit
   limit and stock availability, allocates FEFO by reusing the
   Phase 2 `allocateFefo` (no third FEFO logic), computes totals,
   COGS and profit, and assigns identifiers from the current
   counters. On any validation failure it returns a clear error
   before any write happens.
2. **Execute** — `executeSaleTransaction(db, plan): SaleWriteResult`
   runs the plan inside one SQL transaction (`BEGIN IMMEDIATE` …
   `COMMIT`, `ROLLBACK` on any failure) over the Phase 2 `TypedDb`
   interface — no expo-sqlite or node:sqlite import inside
   services. The steps inside the transaction, in order:
   1. **Reserve the counters**: read `ids` and `invoiceCounter`
      from `meta` and verify the database is not ahead of the
      memory the plan was built from (a database ahead of memory
      would mean a previous sale was lost); the new values are
      stored in the same transaction, so two concurrent sales can
      never take the same invoice number.
   2. **Deduct the batches** with a guarded update —
      `UPDATE batches SET quantity = quantity - ? WHERE id = ? AND
      quantity >= ?` — and check the affected-row count: zero
      means the stock is gone and the whole transaction aborts
      with `INSUFFICIENT_STOCK`.
   3. **Write every row** (sale, items, batch allocations, stock
      movements, customer/cash transactions, audit log, updated
      batches/customer/shift) to the generic `collections` table
      and the typed tables via the Phase 2 dual-write helpers, and
      store the reserved counters.
   4. **Commit.** Any error at any step rolls everything back.

### Wiring in `erp-database.ts` (`createSale` only)

- `createSaleAsync(data, actor?)` is the new entry point; the
  synchronous `createSale` is unchanged. After the permission
  checks and input validation, if the typed store is ready
  (`isTypedStoreReady()`), it builds the plan and executes it
  through the SQLite adapter (`withTypedDb(fn)` on
  `PersistenceAdapter`, implemented by `ExpoSqliteAdapter`; the
  test adapter implements the same method).
- After a successful SQL transaction the **same plan rows** are
  applied to the in-memory store (no recomputation), the in-memory
  counters are updated, and the plan is recorded in the sync
  outbox through the existing `persistStore()` mechanism — no new
  outbox code. The returned `SaleResult` is identical to the old
  path's result on the same inputs.
- **No silent fallback.** If the SQL transaction fails for any
  reason the database has already rolled back, memory is
  untouched, and `createSale` returns a failure `SaleResult` in
  the old path's error shape — it does **not** retry through the
  old in-memory path. A silent fallback could sell twice: the SQL
  transaction may have failed after the sale was actually written
  (for example a commit that timed out), and re-running the sale
  in memory would create a second, duplicate sale. Failing loudly
  lets the user retry explicitly with the same invoice number.
- If the typed store is not ready (web, old tests, a v1
  database), the old in-memory path runs exactly as before.
- `isSqlSaleWriteEnabled(): boolean` is exported for tests and
  for screens to adopt later.

### Tests (`tests/sqlite-phase3.test.cjs`, real `node:sqlite`)

- A successful SQL sale leaves every table consistent (sale +
  items + allocations + deducted batches + stock movements +
  customer/cash transactions + audit log), advances the counters,
  leaves the in-memory store exactly matching the typed tables,
  and returns a `SaleResult` identical to the legacy path's.
- An injected failure mid-transaction (hook throwing at the
  commit step) leaves zero rows changed in every table, memory
  and counters untouched, and a retry with the same inputs
  succeeds with the same invoice number.
- Two consecutive sales for the last units: the first succeeds,
  the second fails with a clean stock error and no partial trace.
- Three consecutive SQL sales take sequential invoice numbers
  with no duplicates or gaps (after the setup purchases, which
  share the same `invoiceCounter`).
- A plan built on stale stock is rejected by the guarded
  `UPDATE` and rolls back.
- The legacy path still works when the typed store is absent
  (AsyncStorage backend) and writes nothing to SQLite.

### What Phase 3 deliberately does NOT do

- Purchases, sale/purchase returns and cancellations still use
  the old in-memory path; only the sale write moved to SQL.
- The in-memory store is still the source of truth for reads:
  the SQL transaction writes first, then memory is updated from
  the same plan. Removing the in-memory store is Phase 4 work.
- Backup/restore and cloud sync behaviour are unchanged.

## Phase 4 (proposed)

- Move the remaining writes (purchases, returns, cancellations)
  to SQL with the same plan-then-execute model, then make SQL the
  single source of truth and remove the in-memory store.
- Per-row `updated_at` triggers or application-level stamping for
  conflict detection, reusing the typed tables for the cloud-sync
  outbox instead of the JSON diff.
- Remove the AsyncStorage backend only after Phase 3 is proven on
  device, keeping the JSON backup format as the interchange format.
