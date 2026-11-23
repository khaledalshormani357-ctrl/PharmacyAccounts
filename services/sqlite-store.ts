// SQLite persistence — Phase 1 of the SQLite migration.
//
// This module replaces only the *storage* layer. The in-memory store in
// services/erp-database.ts keeps its shape and its public API; this file
// only decides how a snapshot of that store reaches the disk.
//
// Design (see docs/SQLITE_MIGRATION.md for the full rationale):
// - One row per entity row: `collections(collection, row_id, data)` where
//   `data` is the JSON of one row. `settings` and `pharmacy` (singletons)
//   and the id counters live as JSON in `meta(key, value)` — a single
//   `settings` JSON blob, not one row per setting, so a settings change
//   is one meta upsert instead of N key writes.
// - Writes are differential: `diffSnapshots` compares serialised rows and
//   only changed/new/deleted rows (plus changed meta) are written, inside
//   one SQLite transaction.
// - `expo-sqlite` is never imported statically here. The native module is
//   loaded lazily (dynamic import through a variable, so the TypeScript
//   unit-test build does not need the module to exist), and the platform is
//   detected synchronously via `navigator.product === 'ReactNative'`.
//   Node (unit tests) and web therefore fall back to AsyncStorage.
//
// Expo SQLite API used (verified against the official Expo docs and the
// expo-sqlite 15 type declarations):
//   openDatabaseAsync(name), execAsync(sql), runAsync(sql, params),
//   getAllAsync(sql, params), getFirstAsync(sql, params).
// Transactions are explicit `BEGIN IMMEDIATE / COMMIT / ROLLBACK` via
// execAsync rather than withTransactionAsync, so the code does not depend
// on a helper that may differ between versions.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ──────────────────────────────────────────────────────────

/** A full copy of the in-memory store, as erp-database serialises it. */
export interface StoredSnapshot {
  store: Record<string, unknown>;
  ids: Record<string, number>;
  invoiceCounter: number;
}

export interface SnapshotRow {
  collection: string;
  rowId: number;
  data: string;
}

export interface SnapshotRows {
  meta: Array<[string, string]>;
  rows: SnapshotRow[];
}

export interface SnapshotDiff {
  upserts: SnapshotRow[];
  deletes: Array<{ collection: string; rowId: number }>;
  metaUpserts: Array<[string, string]>;
  metaDeletes: string[];
}

/** Minimal persistence contract. `saveDiff` is optional; adapters without
 * it are used with full `saveSnapshot` writes. */
export interface PersistenceAdapter {
  readonly name: string;
  loadSnapshot(): Promise<StoredSnapshot | null>;
  saveSnapshot(snapshot: StoredSnapshot): Promise<void>;
  saveDiff?(diff: SnapshotDiff): Promise<void>;
  /** Read one adapter-level meta flag (e.g. `migrated_from_asyncstorage`). */
  getMeta?(key: string): Promise<string | null>;
}

// ─── Store shape ────────────────────────────────────────────────────

/** Entity collections stored as rows. `settings` and `pharmacy` are
 * singletons and live in `meta` instead. */
export const COLLECTION_NAMES = [
  'users',
  'products',
  'productUnits',
  'batches',
  'stockMovements',
  'sales',
  'saleItems',
  'saleBatchAllocations',
  'salePayments',
  'saleReturns',
  'purchases',
  'purchaseItems',
  'purchaseReturns',
  'customers',
  'customerTransactions',
  'suppliers',
  'supplierTransactions',
  'cashTransactions',
  'shifts',
  'expenses',
  'auditLogs',
  // Outbox of local changes waiting for cloud sync (services/cloud-sync.ts).
  // It is a collection like any other so it survives restarts, but the
  // outbox builder in erp-database never records entries about itself.
  'syncOutbox',
] as const;

export const STORE_KEY = '@pharmacy_accounts/store/v1';
export const DATABASE_FILE_NAME = 'pharmacy.db';
export const SCHEMA_VERSION = '1';
export const MIGRATED_FROM_ASYNC_STORAGE_KEY = 'migrated_from_asyncstorage';

/** An empty store with every collection present, so a round-trip never
 * drops a collection that happens to be empty. */
export function emptyStore(): Record<string, unknown> {
  const store: Record<string, unknown> = { settings: {}, pharmacy: null };
  for (const name of COLLECTION_NAMES) store[name] = [];
  return store;
}

function emptySnapshot(): StoredSnapshot {
  return { store: emptyStore(), ids: {}, invoiceCounter: 1000 };
}

// ─── Schema ─────────────────────────────────────────────────────────

export function buildSchemaSql(): string {
  return [
    'CREATE TABLE IF NOT EXISTS meta (',
    '  key TEXT PRIMARY KEY,',
    '  value TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS collections (',
    '  collection TEXT NOT NULL,',
    '  row_id INTEGER NOT NULL,',
    '  data TEXT NOT NULL,',
    '  PRIMARY KEY (collection, row_id)',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_collections_collection ON collections (collection);',
  ].join('\n');
}

// ─── Pure snapshot <-> rows conversion ──────────────────────────────

function safeJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function snapshotToRows(snapshot: StoredSnapshot): SnapshotRows {
  const store = snapshot.store ?? {};
  const meta: Array<[string, string]> = [
    ['schema_version', SCHEMA_VERSION],
    ['ids', JSON.stringify(snapshot.ids ?? {})],
    ['invoice_counter', String(snapshot.invoiceCounter ?? 1000)],
    ['settings', JSON.stringify((store['settings'] as Record<string, string> | undefined) ?? {})],
    ['pharmacy', JSON.stringify('pharmacy' in store ? store['pharmacy'] : null)],
  ];
  const rows: SnapshotRow[] = [];
  for (const collection of COLLECTION_NAMES) {
    const list = store[collection];
    if (!Array.isArray(list)) continue;
    for (const row of list as Array<Record<string, unknown>>) {
      const rowId = row?.['id'];
      // Every entity row in this app carries a numeric id. A row without
      // one cannot be addressed for differential writes, so it is skipped
      // rather than crashing the persist.
      if (typeof rowId !== 'number' || !Number.isFinite(rowId)) continue;
      rows.push({ collection, rowId, data: JSON.stringify(row) });
    }
  }
  return { meta, rows };
}

export function rowsToSnapshot(rows: SnapshotRows): StoredSnapshot {
  const meta = new Map<string, string>(rows.meta);
  const idsRaw = safeJsonObject(meta.get('ids'));
  const ids: Record<string, number> = {};
  for (const [key, value] of Object.entries(idsRaw)) {
    if (typeof value === 'number' && Number.isFinite(value)) ids[key] = value;
  }
  const invoiceCounter = Number(meta.get('invoice_counter') ?? '1000');
  const store = emptyStore();
  store['settings'] = safeJsonObject(meta.get('settings'));
  // `pharmacy` is a single object-or-null value, not a record of fields,
  // so it is parsed as a value (JSON.parse('null') gives null).
  const pharmacyRaw = meta.get('pharmacy');
  if (pharmacyRaw !== undefined) {
    try {
      store['pharmacy'] = JSON.parse(pharmacyRaw) as unknown;
    } catch {
      store['pharmacy'] = null;
    }
  }
  const byCollection = new Map<string, unknown[]>();
  for (const row of rows.rows) {
    const list = byCollection.get(row.collection) ?? [];
    try {
      list.push(JSON.parse(row.data) as unknown);
    } catch {
      // A single unreadable row must not lose the whole snapshot.
      continue;
    }
    byCollection.set(row.collection, list);
  }
  for (const [collection, list] of byCollection) {
    if ((COLLECTION_NAMES as readonly string[]).includes(collection)) {
      list.sort((a, b) => {
        const aId = (a as { id?: unknown })?.['id'];
        const bId = (b as { id?: unknown })?.['id'];
        return (typeof aId === 'number' ? aId : 0) - (typeof bId === 'number' ? bId : 0);
      });
      store[collection] = list;
    }
  }
  return {
    store,
    ids,
    invoiceCounter: Number.isFinite(invoiceCounter) ? invoiceCounter : 1000,
  };
}

/** Apply a diff to a snapshot and return the resulting snapshot. Used by
 * adapters that cannot apply a diff natively (AsyncStorage). */
export function applyDiffToSnapshot(snapshot: StoredSnapshot, diff: SnapshotDiff): StoredSnapshot {
  const rows = snapshotToRows(snapshot);
  const byKey = new Map(rows.rows.map(r => [`${r.collection}:${r.rowId}`, r]));
  for (const row of diff.upserts) byKey.set(`${row.collection}:${row.rowId}`, row);
  for (const d of diff.deletes) byKey.delete(`${d.collection}:${d.rowId}`);
  const meta = new Map(rows.meta);
  for (const [key, value] of diff.metaUpserts) meta.set(key, value);
  for (const key of diff.metaDeletes) meta.delete(key);
  return rowsToSnapshot({ meta: [...meta.entries()], rows: [...byKey.values()] });
}

export function diffRows(prev: SnapshotRows, next: SnapshotRows): SnapshotDiff {
  const prevMeta = new Map(prev.meta);
  const nextMeta = new Map(next.meta);
  const metaUpserts: Array<[string, string]> = [];
  for (const [key, value] of nextMeta) {
    if (prevMeta.get(key) !== value) metaUpserts.push([key, value]);
  }
  const metaDeletes = [...prevMeta.keys()].filter(key => !nextMeta.has(key));
  const keyOf = (row: SnapshotRow) => `${row.collection}:${row.rowId}`;
  const prevByKey = new Map(prev.rows.map(row => [keyOf(row), row.data]));
  const nextByKey = new Map(next.rows.map(row => [keyOf(row), row.data]));
  const upserts: SnapshotRow[] = [];
  for (const row of next.rows) {
    if (prevByKey.get(keyOf(row)) !== row.data) upserts.push(row);
  }
  const deletes = prev.rows
    .filter(row => !nextByKey.has(keyOf(row)))
    .map(row => ({ collection: row.collection, rowId: row.rowId }));
  return { upserts, deletes, metaUpserts, metaDeletes };
}

export function diffSnapshots(prev: StoredSnapshot, next: StoredSnapshot): SnapshotDiff {
  return diffRows(snapshotToRows(prev), snapshotToRows(next));
}

// ─── AsyncStorage adapter (legacy backend, web, tests) ──────────────

export class AsyncStorageAdapter implements PersistenceAdapter {
  readonly name = 'async-storage';

  async loadSnapshot(): Promise<StoredSnapshot | null> {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return null;
    // Throws on corrupt JSON; the caller quarantines the raw text.
    return JSON.parse(raw) as StoredSnapshot;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
  }

  async saveDiff(diff: SnapshotDiff): Promise<void> {
    // AsyncStorage has no transactions: read-modify-write the whole
    // snapshot. Writes are serialised by the caller's persist queue, so
    // no two diffs interleave inside one app process.
    const current = (await this.loadSnapshot()) ?? emptySnapshot();
    await this.saveSnapshot(applyDiffToSnapshot(current, diff));
  }

  async getMeta(): Promise<string | null> {
    return null;
  }
}

// ─── In-memory adapter (tests only) ─────────────────────────────────

export class InMemoryAdapter implements PersistenceAdapter {
  readonly name = 'in-memory';
  private stored: StoredSnapshot | null = null;
  private metaFlags = new Map<string, string>();
  private failBeforeCommit?: () => boolean;

  constructor(options?: { failBeforeCommit?: () => boolean }) {
    this.failBeforeCommit = options?.failBeforeCommit;
  }

  /** Replace the failure hook (lets a test inject a mid-save failure). */
  setFailBeforeCommit(hook?: () => boolean): void {
    this.failBeforeCommit = hook;
  }

  async loadSnapshot(): Promise<StoredSnapshot | null> {
    if (!this.stored) return null;
    // Deep clone so callers can never mutate the stored snapshot.
    return JSON.parse(JSON.stringify(this.stored)) as StoredSnapshot;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    // Serialise first: a value that cannot be serialised (circular, BigInt)
    // throws before anything is committed, so the stored snapshot is intact.
    const clone = JSON.parse(JSON.stringify(snapshot)) as StoredSnapshot;
    if (this.failBeforeCommit?.()) throw new Error('injected in-memory save failure');
    this.stored = clone;
  }

  async saveDiff(diff: SnapshotDiff): Promise<void> {
    const current = (await this.loadSnapshot()) ?? emptySnapshot();
    const next = applyDiffToSnapshot(current, diff);
    // Serialise before committing, same as saveSnapshot.
    const clone = JSON.parse(JSON.stringify(next)) as StoredSnapshot;
    if (this.failBeforeCommit?.()) throw new Error('injected in-memory save failure');
    this.stored = clone;
    for (const [key, value] of diff.metaUpserts) this.metaFlags.set(key, value);
    for (const key of diff.metaDeletes) this.metaFlags.delete(key);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.metaFlags.get(key) ?? null;
  }
}

// ─── expo-sqlite adapter ────────────────────────────────────────────

interface ExpoSQLiteDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export class ExpoSqliteAdapter implements PersistenceAdapter {
  readonly name = 'expo-sqlite';
  private dbPromise: Promise<ExpoSQLiteDb> | null = null;

  private async ensureDb(): Promise<ExpoSQLiteDb> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        // Variable indirection: the TypeScript unit-test build must not
        // need the native module to exist.
        const moduleName = 'expo-sqlite';
        const mod = await import(moduleName);
        const open = mod.openDatabaseAsync ?? mod.default?.openDatabaseAsync;
        if (typeof open !== 'function') {
          throw new Error('expo-sqlite openDatabaseAsync is unavailable');
        }
        const db = (await open(DATABASE_FILE_NAME)) as ExpoSQLiteDb;
        try {
          await db.execAsync('PRAGMA journal_mode = WAL;');
        } catch {
          // WAL is not available on every platform (e.g. web builds).
        }
        try {
          await db.execAsync('PRAGMA foreign_keys = ON;');
        } catch {
          // No foreign keys exist in this schema yet; advisory only.
        }
        await db.execAsync(buildSchemaSql());
        return db;
      })();
      // Allow a later retry after a failed open instead of caching the
      // rejection forever.
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  private async withTransaction(db: ExpoSQLiteDb, task: () => Promise<void>): Promise<void> {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      await task();
      await db.execAsync('COMMIT');
    } catch (error) {
      try {
        await db.execAsync('ROLLBACK');
      } catch {
        // The rollback itself failed; the original error is the one to report.
      }
      throw error;
    }
  }

  async loadSnapshot(): Promise<StoredSnapshot | null> {
    const db = await this.ensureDb();
    const metaRows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM meta',
    );
    const rows = await db.getAllAsync<{ collection: string; row_id: number; data: string }>(
      'SELECT collection, row_id, data FROM collections ORDER BY collection, row_id',
    );
    if (metaRows.length === 0 && rows.length === 0) return null;
    return rowsToSnapshot({
      meta: metaRows.map(r => [r.key, r.value] as [string, string]),
      rows: rows.map(r => ({ collection: r.collection, rowId: r.row_id, data: r.data })),
    });
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const rows = snapshotToRows(snapshot);
    const db = await this.ensureDb();
    await this.withTransaction(db, async () => {
      await db.runAsync('DELETE FROM collections');
      for (const row of rows.rows) {
        await db.runAsync(
          'INSERT OR REPLACE INTO collections (collection, row_id, data) VALUES (?, ?, ?)',
          [row.collection, row.rowId, row.data],
        );
      }
      // Upsert only the keys this snapshot owns; other meta keys (e.g.
      // the one-time migration flag) are preserved.
      for (const [key, value] of rows.meta) {
        await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
      }
    });
  }

  async saveDiff(diff: SnapshotDiff): Promise<void> {
    const db = await this.ensureDb();
    await this.withTransaction(db, async () => {
      for (const row of diff.upserts) {
        await db.runAsync(
          'INSERT OR REPLACE INTO collections (collection, row_id, data) VALUES (?, ?, ?)',
          [row.collection, row.rowId, row.data],
        );
      }
      for (const d of diff.deletes) {
        await db.runAsync('DELETE FROM collections WHERE collection = ? AND row_id = ?', [
          d.collection,
          d.rowId,
        ]);
      }
      for (const [key, value] of diff.metaUpserts) {
        await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
      }
      for (const key of diff.metaDeletes) {
        await db.runAsync('DELETE FROM meta WHERE key = ?', [key]);
      }
    });
  }

  async getMeta(key: string): Promise<string | null> {
    const db = await this.ensureDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }
}

// ─── Default adapter ────────────────────────────────────────────────

/**
 * SQLite on native devices, AsyncStorage elsewhere. Detection is
 * synchronous and dependency-free: React Native sets
 * `navigator.product` to `'ReactNative'`; Node (unit tests) has no
 * navigator and web browsers report a browser product string. If the
 * SQLite database cannot be opened at runtime, the caller
 * (erp-database hydrate) falls back to AsyncStorage.
 */
export function createDefaultAdapter(): PersistenceAdapter {
  const nav = (globalThis as unknown as { navigator?: { product?: string } }).navigator;
  if (nav?.product === 'ReactNative') return new ExpoSqliteAdapter();
  return new AsyncStorageAdapter();
}
