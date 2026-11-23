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

## Phase 2 (proposed)

- Typed tables for the hot collections (products, batches, sales,
  sale items) with indexes on `product_id`, `batch_number` and `date`.
- FEFO allocation and the report summaries as SQL queries against
  those tables, behind the same public service functions.
- A migration that moves rows out of the generic `collections` table
  into typed tables, with the same keep-the-old-copy rollback rule.
- Remove the AsyncStorage backend only after Phase 2 is proven on
  device, keeping the JSON backup format as the interchange format.
