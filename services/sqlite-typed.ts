// SQLite persistence — Phase 2 of the SQLite migration.
//
// Phase 1 (services/sqlite-store.ts) stored every row as JSON in two
// generic tables (`meta` + `collections`). This module adds *typed*
// tables — one per hot collection, with real columns, indexes and a
// `schema_migrations` ledger — plus a read-only SQL query layer on top
// of them. The write path is unchanged: services keep mutating the
// in-memory store, and the adapters mirror each diff into the typed
// tables inside the same transaction (dual-write). Reads may use SQL
// when the typed store is ready and fall back to the in-memory
// computation otherwise (see the `*Async` variants in erp-database.ts).
//
// No expo-sqlite or node:sqlite import lives in this file: every
// function takes a `TypedDb` (a tiny structural interface), so the same
// code runs on expo-sqlite in the app and on node:sqlite in the tests.
//
// Conventions:
// - Dates are TEXT in the same shape as the in-memory store
//   ('YYYY-MM-DD' for business dates, 'YYYY-MM-DD HH:MM:SS' for
//   created_at). Day differences use julianday() arithmetic cast to
//   INTEGER, which is exact for date-only strings; `ceil()` is avoided
//   because it is not compiled into every SQLite build.
// - Booleans are INTEGER 0/1; NULL stays NULL (legacy rows may lack a
//   value, and a NULL must not become a false 0 on migration).
// - Every typed table carries `sync_id TEXT UNIQUE` (the cloud-sync
//   global identity), `sync_device_id TEXT`, and `updated_at TEXT`.
//   `products` additionally keeps its domain `updated_at` column *and*
//   a `sync_updated_at` column, because Product has both a domain
//   `updated_at` field and the SyncFields `updatedAt` field.
// - `sale_returns` / `purchase_returns` keep their embedded line items
//   as `items_json TEXT`, and `sale_returns` also stores a precomputed
//   `returned_cogs_total` so report queries never need json_each().
// - The generic `collections` table is never dropped: it stays the
//   rollback source and the store for collections with no typed table
//   (users, productUnits, customer/supplier transactions, auditLogs,
//   syncOutbox).

import type { SnapshotDiff, SnapshotRows } from './sqlite-store';
import type { Batch, ExpiryRadarItem, InventoryItem, Product } from './erp-database';

// ─── TypedDb ────────────────────────────────────────────────────────

/** Minimal database surface. Methods may be sync (node:sqlite) or async
 * (expo-sqlite); callers always `await` them. */
export interface TypedDb {
  exec(sql: string): Promise<void> | void;
  run(sql: string, params?: unknown[]): Promise<unknown> | unknown;
  all<T>(sql: string, params?: unknown[]): Promise<T[]> | T[];
  get<T>(sql: string, params?: unknown[]): Promise<T | null> | (T | null);
}

// ─── Typed schema ───────────────────────────────────────────────────

type ColKind = 'integer' | 'real' | 'text' | 'boolean' | 'json';

interface TypedColumn {
  name: string;
  /** Field on the in-memory row object. `__`-prefixed fields are computed. */
  field: string;
  kind: ColKind;
}

interface TypedTableSpec {
  collection: string;
  table: string;
  columns: TypedColumn[];
}

const SYNC_ID_COL: TypedColumn = { name: 'sync_id', field: 'syncId', kind: 'text' };
const SYNC_DEVICE_COL: TypedColumn = { name: 'sync_device_id', field: 'syncDeviceId', kind: 'text' };
/** `updated_at` driven by the SyncFields `updatedAt` timestamp. */
const SYNC_UPDATED_COL: TypedColumn = { name: 'updated_at', field: 'updatedAt', kind: 'text' };
/** Products only: the domain `updated_at` field, distinct from the sync stamp. */
const DOMAIN_UPDATED_COL: TypedColumn = { name: 'updated_at', field: 'updated_at', kind: 'text' };
const SYNC_STAMP_COL: TypedColumn = { name: 'sync_updated_at', field: 'updatedAt', kind: 'text' };

function col(name: string, field: string, kind: ColKind): TypedColumn {
  return { name, field, kind };
}

const TYPED_TABLES: TypedTableSpec[] = [
  {
    collection: 'products', table: 'products',
    columns: [
      col('id', 'id', 'integer'),
      col('barcode', 'barcode', 'text'),
      col('internal_code', 'internal_code', 'text'),
      col('trade_name', 'trade_name', 'text'),
      col('generic_name', 'generic_name', 'text'),
      col('active_ingredient', 'active_ingredient', 'text'),
      col('strength', 'strength', 'text'),
      col('dosage_form', 'dosage_form', 'text'),
      col('manufacturer', 'manufacturer', 'text'),
      col('category', 'category', 'text'),
      col('prescription_required', 'prescription_required', 'boolean'),
      col('controlled', 'controlled', 'boolean'),
      col('inventory_unit', 'inventory_unit', 'text'),
      col('minimum_stock', 'minimum_stock', 'real'),
      col('reorder_level', 'reorder_level', 'real'),
      col('selling_price', 'selling_price', 'real'),
      col('default_purchase_price', 'default_purchase_price', 'real'),
      col('active', 'active', 'boolean'),
      col('notes', 'notes', 'text'),
      col('catalog_source_id', 'catalog_source_id', 'text'),
      col('created_at', 'created_at', 'text'),
      DOMAIN_UPDATED_COL,
      SYNC_STAMP_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'batches', table: 'batches',
    columns: [
      col('id', 'id', 'integer'),
      col('product_id', 'product_id', 'integer'),
      col('batch_number', 'batch_number', 'text'),
      col('expiry_date', 'expiry_date', 'text'),
      col('received_date', 'received_date', 'text'),
      col('purchase_price', 'purchase_price', 'real'),
      col('selling_price', 'selling_price', 'real'),
      col('quantity', 'quantity', 'real'),
      col('initial_quantity', 'initial_quantity', 'real'),
      col('supplier_id', 'supplier_id', 'integer'),
      col('purchase_id', 'purchase_id', 'integer'),
      col('status', 'status', 'text'),
      col('notes', 'notes', 'text'),
      col('is_opening', 'is_opening', 'boolean'),
      col('quarantined_quantity', 'quarantined_quantity', 'real'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'sales', table: 'sales',
    columns: [
      col('id', 'id', 'integer'),
      col('invoice_number', 'invoice_number', 'text'),
      col('sale_type', 'sale_type', 'text'),
      col('customer_id', 'customer_id', 'integer'),
      col('customer_name', 'customer_name', 'text'),
      col('subtotal', 'subtotal', 'real'),
      col('discount', 'discount', 'real'),
      col('total', 'total', 'real'),
      col('amount_paid', 'amount_paid', 'real'),
      col('change_given', 'change_given', 'real'),
      col('remaining', 'remaining', 'real'),
      col('cogs', 'cogs', 'real'),
      col('gross_profit', 'gross_profit', 'real'),
      col('date', 'date', 'text'),
      col('shift_id', 'shift_id', 'integer'),
      col('user_id', 'user_id', 'integer'),
      col('notes', 'notes', 'text'),
      col('cancelled', 'cancelled', 'boolean'),
      col('cancelled_by', 'cancelled_by', 'integer'),
      col('cancelled_at', 'cancelled_at', 'text'),
      col('cancel_reason', 'cancel_reason', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'saleItems', table: 'sale_items',
    columns: [
      col('id', 'id', 'integer'),
      col('sale_id', 'sale_id', 'integer'),
      col('product_id', 'product_id', 'integer'),
      col('product_name', 'product_name', 'text'),
      col('batch_id', 'batch_id', 'integer'),
      col('unit', 'unit', 'text'),
      col('unit_name', 'unit_name', 'text'),
      col('quantity', 'quantity', 'real'),
      col('quantity_entered', 'quantity_entered', 'real'),
      col('conversion_factor', 'conversion_factor', 'real'),
      col('quantity_in_inventory_unit', 'quantity_in_inventory_unit', 'real'),
      col('unit_price', 'unit_price', 'real'),
      col('base_purchase_price', 'base_purchase_price', 'real'),
      col('discount', 'discount', 'real'),
      col('line_total', 'line_total', 'real'),
      col('cogs', 'cogs', 'real'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'saleBatchAllocations', table: 'sale_batch_allocations',
    columns: [
      col('id', 'id', 'integer'),
      col('sale_item_id', 'sale_item_id', 'integer'),
      col('batch_id', 'batch_id', 'integer'),
      col('quantity_allocated', 'quantity_allocated', 'real'),
      col('purchase_price', 'purchase_price', 'real'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'salePayments', table: 'sale_payments',
    columns: [
      col('id', 'id', 'integer'),
      col('sale_id', 'sale_id', 'integer'),
      col('amount', 'amount', 'real'),
      col('payment_method', 'payment_method', 'text'),
      col('date', 'date', 'text'),
      col('note', 'note', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'saleReturns', table: 'sale_returns',
    columns: [
      col('id', 'id', 'integer'),
      col('sale_id', 'sale_id', 'integer'),
      col('return_number', 'return_number', 'text'),
      col('invoice_number', 'invoice_number', 'text'),
      col('customer_id', 'customer_id', 'integer'),
      col('user_id', 'user_id', 'integer'),
      col('user_name', 'user_name', 'text'),
      col('settlement_method', 'settlement_method', 'text'),
      col('condition', 'condition', 'text'),
      col('is_direct', 'is_direct', 'boolean'),
      col('notes', 'notes', 'text'),
      col('status', 'status', 'text'),
      col('idempotency_key', 'idempotency_key', 'text'),
      col('total', 'total', 'real'),
      col('cash_refund', 'cash_refund', 'real'),
      col('credit_reduction', 'credit_reduction', 'real'),
      col('returned_cogs_total', '__returned_cogs_total', 'real'),
      col('date', 'date', 'text'),
      col('created_at', 'created_at', 'text'),
      col('items_json', 'items', 'json'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'customers', table: 'customers',
    columns: [
      col('id', 'id', 'integer'),
      col('name', 'name', 'text'),
      col('phone', 'phone', 'text'),
      col('address', 'address', 'text'),
      col('credit_limit', 'credit_limit', 'real'),
      col('balance', 'balance', 'real'),
      col('notes', 'notes', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'suppliers', table: 'suppliers',
    columns: [
      col('id', 'id', 'integer'),
      col('name', 'name', 'text'),
      col('phone', 'phone', 'text'),
      col('address', 'address', 'text'),
      col('credit_limit', 'credit_limit', 'real'),
      col('balance', 'balance', 'real'),
      col('notes', 'notes', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'purchases', table: 'purchases',
    columns: [
      col('id', 'id', 'integer'),
      col('invoice_number', 'invoice_number', 'text'),
      col('supplier_id', 'supplier_id', 'integer'),
      col('supplier_name', 'supplier_name', 'text'),
      col('date', 'date', 'text'),
      col('subtotal', 'subtotal', 'real'),
      col('discount', 'discount', 'real'),
      col('total', 'total', 'real'),
      col('amount_paid', 'amount_paid', 'real'),
      col('remaining', 'remaining', 'real'),
      col('notes', 'notes', 'text'),
      col('cancelled', 'cancelled', 'boolean'),
      col('cancelled_by', 'cancelled_by', 'integer'),
      col('cancelled_at', 'cancelled_at', 'text'),
      col('cancel_reason', 'cancel_reason', 'text'),
      col('user_id', 'user_id', 'integer'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'purchaseItems', table: 'purchase_items',
    columns: [
      col('id', 'id', 'integer'),
      col('purchase_id', 'purchase_id', 'integer'),
      col('product_id', 'product_id', 'integer'),
      col('product_name', 'product_name', 'text'),
      col('batch_number', 'batch_number', 'text'),
      col('expiry_date', 'expiry_date', 'text'),
      col('unit', 'unit', 'text'),
      col('unit_name', 'unit_name', 'text'),
      col('quantity', 'quantity', 'real'),
      col('quantity_entered', 'quantity_entered', 'real'),
      col('batch_id', 'batch_id', 'integer'),
      col('conversion_factor', 'conversion_factor', 'real'),
      col('quantity_in_inventory_unit', 'quantity_in_inventory_unit', 'real'),
      col('purchase_price', 'purchase_price', 'real'),
      col('base_purchase_price', 'base_purchase_price', 'real'),
      col('free_quantity', 'free_quantity', 'real'),
      col('discount', 'discount', 'real'),
      col('line_total', 'line_total', 'real'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'purchaseReturns', table: 'purchase_returns',
    columns: [
      col('id', 'id', 'integer'),
      col('purchase_id', 'purchase_id', 'integer'),
      col('return_number', 'return_number', 'text'),
      col('invoice_number', 'invoice_number', 'text'),
      col('supplier_id', 'supplier_id', 'integer'),
      col('user_id', 'user_id', 'integer'),
      col('user_name', 'user_name', 'text'),
      col('settlement_method', 'settlement_method', 'text'),
      col('is_direct', 'is_direct', 'boolean'),
      col('notes', 'notes', 'text'),
      col('status', 'status', 'text'),
      col('idempotency_key', 'idempotency_key', 'text'),
      col('total', 'total', 'real'),
      col('cash_refund', 'cash_refund', 'real'),
      col('payable_reduction', 'payable_reduction', 'real'),
      col('date', 'date', 'text'),
      col('created_at', 'created_at', 'text'),
      col('items_json', 'items', 'json'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'stockMovements', table: 'stock_movements',
    columns: [
      col('id', 'id', 'integer'),
      col('product_id', 'product_id', 'integer'),
      col('batch_id', 'batch_id', 'integer'),
      col('type', 'type', 'text'),
      col('quantity', 'quantity', 'real'),
      col('unit', 'unit', 'text'),
      col('quantity_in_inventory_unit', 'quantity_in_inventory_unit', 'real'),
      col('reference_type', 'reference_type', 'text'),
      col('reference_id', 'reference_id', 'integer'),
      col('note', 'note', 'text'),
      col('user_id', 'user_id', 'integer'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'cashTransactions', table: 'cash_transactions',
    columns: [
      col('id', 'id', 'integer'),
      col('type', 'type', 'text'),
      col('amount', 'amount', 'real'),
      col('cashbox_id', 'cashbox_id', 'text'),
      col('reference_type', 'reference_type', 'text'),
      col('reference_id', 'reference_id', 'integer'),
      col('shift_id', 'shift_id', 'integer'),
      col('note', 'note', 'text'),
      col('user_id', 'user_id', 'integer'),
      col('date', 'date', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'shifts', table: 'shifts',
    columns: [
      col('id', 'id', 'integer'),
      col('user_id', 'user_id', 'integer'),
      col('user_name', 'user_name', 'text'),
      col('opening_cash', 'opening_cash', 'real'),
      col('expected_cash', 'expected_cash', 'real'),
      col('actual_cash', 'actual_cash', 'real'),
      col('difference', 'difference', 'real'),
      col('difference_reason', 'difference_reason', 'text'),
      col('total_sales', 'total_sales', 'real'),
      col('total_collections', 'total_collections', 'real'),
      col('total_expenses', 'total_expenses', 'real'),
      col('total_purchases_paid', 'total_purchases_paid', 'real'),
      col('status', 'status', 'text'),
      col('opened_at', 'opened_at', 'text'),
      col('closed_at', 'closed_at', 'text'),
      col('notes', 'notes', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
  {
    collection: 'expenses', table: 'expenses',
    columns: [
      col('id', 'id', 'integer'),
      col('category', 'category', 'text'),
      col('amount', 'amount', 'real'),
      col('date', 'date', 'text'),
      col('shift_id', 'shift_id', 'integer'),
      col('note', 'note', 'text'),
      col('user_id', 'user_id', 'integer'),
      col('cashbox_id', 'cashbox_id', 'text'),
      col('created_at', 'created_at', 'text'),
      SYNC_UPDATED_COL,
      SYNC_ID_COL,
      SYNC_DEVICE_COL,
    ],
  },
];

const SPEC_BY_COLLECTION = new Map(TYPED_TABLES.map(spec => [spec.collection, spec]));

/** Collection names that have a typed table (16: the 14 hot collections
 * plus sale_returns / purchase_returns, which the report summaries need). */
export const TYPED_COLLECTIONS: readonly string[] = TYPED_TABLES.map(spec => spec.collection);

const SQL_TYPE_BY_KIND: Record<ColKind, string> = {
  integer: 'INTEGER',
  real: 'REAL',
  text: 'TEXT',
  boolean: 'INTEGER',
  json: 'TEXT',
};

export function buildTypedSchemaSql(): string {
  const statements: string[] = [
    'CREATE TABLE IF NOT EXISTS schema_migrations (',
    '  version TEXT PRIMARY KEY,',
    '  applied_at TEXT NOT NULL',
    ');',
  ];
  for (const spec of TYPED_TABLES) {
    const defs = spec.columns.map(column => {
      if (column.name === 'id') return 'id INTEGER PRIMARY KEY';
      if (column.name === 'sync_id') return 'sync_id TEXT UNIQUE';
      return `${column.name} ${SQL_TYPE_BY_KIND[column.kind]}`;
    });
    statements.push(`CREATE TABLE IF NOT EXISTS ${spec.table} (`, `  ${defs.join(',\n  ')}`, ');');
  }
  statements.push(
    'CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);',
    'CREATE INDEX IF NOT EXISTS idx_products_name ON products (trade_name);',
    'CREATE INDEX IF NOT EXISTS idx_batches_product_expiry ON batches (product_id, expiry_date);',
    'CREATE INDEX IF NOT EXISTS idx_batches_status ON batches (status);',
    'CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (date);',
    'CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);',
    'CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product ON sale_items (sale_id, product_id);',
    'CREATE INDEX IF NOT EXISTS idx_sale_allocations_batch ON sale_batch_allocations (batch_id);',
    'CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments (sale_id);',
    'CREATE INDEX IF NOT EXISTS idx_sale_returns_date ON sale_returns (sale_id, date);',
    'CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);',
    'CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);',
    'CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (date);',
    'CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);',
    'CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_product ON purchase_items (purchase_id, product_id);',
    'CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns (purchase_id, date);',
    'CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date ON stock_movements (product_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements (batch_id);',
    'CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions (date);',
    'CREATE INDEX IF NOT EXISTS idx_cash_transactions_type_date ON cash_transactions (type, date);',
    'CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status);',
    'CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);',
  );
  return statements.join('\n');
}

// ─── Row mapping ────────────────────────────────────────────────────

/** Sum of `returned_cogs` over a sale return's embedded line items. */
function returnedCogsTotal(row: Record<string, unknown>): number {
  const items = row['items'];
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const value = (item as Record<string, unknown>)?.['returned_cogs'];
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
}

function toSqlValue(column: TypedColumn, row: Record<string, unknown>): unknown {
  if (column.field === '__returned_cogs_total') return returnedCogsTotal(row);
  const value = row[column.field];
  if (value === undefined || value === null) return null;
  switch (column.kind) {
    case 'boolean':
      return value ? 1 : 0;
    case 'json':
      return JSON.stringify(value);
    default:
      return value;
  }
}

function upsertSql(spec: TypedTableSpec): string {
  const names = spec.columns.map(column => column.name).join(', ');
  const placeholders = spec.columns.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO ${spec.table} (${names}) VALUES (${placeholders})`;
}

async function upsertTypedRow(db: TypedDb, spec: TypedTableSpec, row: Record<string, unknown>): Promise<void> {
  await db.run(upsertSql(spec), spec.columns.map(column => toSqlValue(column, row)));
}

// ─── Migration v2 ───────────────────────────────────────────────────

export interface TypedMigrationResult {
  migrated: number;
  skipped: number;
  alreadyMigrated: boolean;
}

/**
 * Copy every row of the generic `collections` table into its typed table
 * and stamp schema_version='2'. Idempotent: a database already at
 * version 2 (or newer) is left untouched. Corrupt rows (unparseable
 * JSON) are counted in `skipped` and never abort the migration. The
 * generic table is kept as the rollback source.
 *
 * With `inTransaction: true` the caller owns the transaction (the
 * adapters run the migration inside their own write transaction); by
 * default this function opens and commits its own transaction.
 */
export async function migrateToTypedTables(
  db: TypedDb,
  opts?: { inTransaction?: boolean },
): Promise<TypedMigrationResult> {
  const run = async (): Promise<TypedMigrationResult> => {
    await db.exec(buildTypedSchemaSql());
    const versionRow = await db.get<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      ['schema_version'],
    );
    const version = versionRow?.value ? Number(versionRow.value) : NaN;
    if (Number.isFinite(version) && version >= 2) {
      return { migrated: 0, skipped: 0, alreadyMigrated: true };
    }
    const rows = await db.all<{ collection: string; row_id: number; data: string }>(
      'SELECT collection, row_id, data FROM collections ORDER BY collection, row_id',
    );
    let migrated = 0;
    let skipped = 0;
    for (const row of rows) {
      const spec = SPEC_BY_COLLECTION.get(row.collection);
      if (!spec) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data) as unknown;
      } catch {
        skipped++;
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        skipped++;
        continue;
      }
      await upsertTypedRow(db, spec, parsed as Record<string, unknown>);
      migrated++;
    }
    await db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', '2']);
    await db.run(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      ['2', new Date().toISOString()],
    );
    return { migrated, skipped, alreadyMigrated: false };
  };
  if (opts?.inTransaction) return run();
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await run();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // The rollback itself failed; the original error is the one to report.
    }
    throw error;
  }
}

// ─── Dual-write helpers (shared by the expo adapter and the tests) ──

/** Apply a generic (collections/meta) diff — the Phase 1 write path. */
export async function applyDiffToGenericTables(db: TypedDb, diff: SnapshotDiff): Promise<void> {
  for (const row of diff.upserts) {
    await db.run(
      'INSERT OR REPLACE INTO collections (collection, row_id, data) VALUES (?, ?, ?)',
      [row.collection, row.rowId, row.data],
    );
  }
  for (const d of diff.deletes) {
    await db.run('DELETE FROM collections WHERE collection = ? AND row_id = ?', [d.collection, d.rowId]);
  }
  for (const [key, value] of diff.metaUpserts) {
    await db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }
  for (const key of diff.metaDeletes) {
    await db.run('DELETE FROM meta WHERE key = ?', [key]);
  }
}

/** Replace the generic tables with a whole snapshot (full-save path). */
export async function applySnapshotToGenericTables(db: TypedDb, rows: SnapshotRows): Promise<void> {
  await db.run('DELETE FROM collections');
  for (const row of rows.rows) {
    await db.run(
      'INSERT OR REPLACE INTO collections (collection, row_id, data) VALUES (?, ?, ?)',
      [row.collection, row.rowId, row.data],
    );
  }
  // Upsert only the keys this snapshot owns; other meta keys (e.g. the
  // one-time migration flag) are preserved.
  for (const [key, value] of rows.meta) {
    await db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }
}

/** Mirror a diff into the typed tables, inside the caller's transaction. */
export async function applyDiffToTypedTables(db: TypedDb, diff: SnapshotDiff): Promise<void> {
  for (const row of diff.upserts) {
    const spec = SPEC_BY_COLLECTION.get(row.collection);
    if (!spec) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    await upsertTypedRow(db, spec, parsed as Record<string, unknown>);
  }
  for (const d of diff.deletes) {
    const spec = SPEC_BY_COLLECTION.get(d.collection);
    if (!spec) continue;
    await db.run(`DELETE FROM ${spec.table} WHERE id = ?`, [d.rowId]);
  }
}

/** Rebuild every typed table from a whole snapshot (full-save path). */
export async function rebuildTypedTablesFromRows(
  db: TypedDb,
  rows: SnapshotRows,
): Promise<{ inserted: number; skipped: number }> {
  for (const spec of TYPED_TABLES) {
    await db.run(`DELETE FROM ${spec.table}`);
  }
  let inserted = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const spec = SPEC_BY_COLLECTION.get(row.collection);
    if (!spec) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      skipped++;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped++;
      continue;
    }
    await upsertTypedRow(db, spec, parsed as Record<string, unknown>);
    inserted++;
  }
  return { inserted, skipped };
}

// ═══════════════════════════════════════════════════════════════════
// SQL READ QUERIES
// ═══════════════════════════════════════════════════════════════════
//
// Every function here is a pure read over a TypedDb. The in-memory
// equivalents in erp-database.ts are the reference semantics; the
// parity tests compare the two on the same seeded data. Where a rule
// differs from an in-memory function it is called out in the comment.
//
// `today` defaults to the current UTC date (the same definition as the
// `today()` helper in erp-database.ts) and is injectable for tests.

export interface QueryOptions {
  today?: string;
}

function todayOf(opts?: QueryOptions): string {
  return opts?.today ?? new Date().toISOString().slice(0, 10);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Whole days from `today` to an expiry date (exact for date-only strings). */
function daysToExpirySql(column: string): string {
  return `CAST(julianday(${column}) - julianday(?) AS INTEGER)`;
}

// ─── FEFO ───────────────────────────────────────────────────────────

export interface FefoAllocation {
  batchId: number;
  quantity: number;
}

/**
 * FEFO allocation from SQL: ACTIVE batches with stock, not expired on
 * `today`, earliest expiry first (no expiry date sorts last). Returns
 * the allocation only; it never mutates anything. When the available
 * stock cannot cover `quantity` it returns [] (the in-memory
 * allocateFefo returns null in that case).
 */
export async function allocateFefo(
  db: TypedDb,
  productId: number,
  quantity: number,
  opts?: QueryOptions,
): Promise<FefoAllocation[]> {
  const today = todayOf(opts);
  const rows = await db.all<{ id: number; quantity: number }>(
    'SELECT id, quantity FROM batches ' +
      'WHERE product_id = ? AND status = ? AND quantity > 0 ' +
      "AND (expiry_date IS NULL OR expiry_date = '' OR expiry_date > ?) " +
      "ORDER BY COALESCE(NULLIF(expiry_date, ''), '9999-12-31') ASC",
    [productId, 'ACTIVE', today],
  );
  const total = rows.reduce((sum, row) => sum + num(row.quantity), 0);
  if (total < quantity) return [];
  const allocations: FefoAllocation[] = [];
  let remaining = quantity;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(num(row.quantity), remaining);
    allocations.push({ batchId: row.id, quantity: take });
    remaining -= take;
  }
  return allocations;
}

// ─── Low stock / expiry ─────────────────────────────────────────────

export interface LowStockRow {
  productId: number;
  totalQuantity: number;
  minimumStock: number;
}

/**
 * Products whose total ACTIVE batch quantity is below their minimum
 * stock, including products with no batches at all (quantity 0). Only
 * active products are considered, like getInventoryList. This is
 * intentionally broader than the dashboard's low-stock count, which
 * excludes out-of-stock products and uses `<= minimum_stock`.
 */
export async function getLowStock(db: TypedDb): Promise<LowStockRow[]> {
  const rows = await db.all<{ productId: number; totalQuantity: number; minimumStock: number }>(
    'SELECT p.id AS productId, COALESCE(SUM(b.quantity), 0) AS totalQuantity, ' +
      'COALESCE(p.minimum_stock, 0) AS minimumStock ' +
      'FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.status = ? ' +
      'WHERE COALESCE(p.active, 0) = 1 ' +
      'GROUP BY p.id HAVING totalQuantity < minimumStock ORDER BY p.id',
    ['ACTIVE'],
  );
  return rows.map(row => ({
    productId: row.productId,
    totalQuantity: num(row.totalQuantity),
    minimumStock: num(row.minimumStock),
  }));
}

export interface ExpiringBatchRow {
  batchId: number;
  productId: number;
  expiryDate: string;
  quantity: number;
  daysToExpiry: number;
}

/** ACTIVE batches with stock expiring within `days` days (not yet expired). */
export async function getExpiringBatches(
  db: TypedDb,
  days: number,
  opts?: QueryOptions,
): Promise<ExpiringBatchRow[]> {
  const today = todayOf(opts);
  const expr = daysToExpirySql('b.expiry_date');
  const rows = await db.all<{ batchId: number; productId: number; expiryDate: string; quantity: number; daysToExpiry: number }>(
    `SELECT b.id AS batchId, b.product_id AS productId, b.expiry_date AS expiryDate, ` +
      `b.quantity AS quantity, ${expr} AS daysToExpiry ` +
      'FROM batches b ' +
      "WHERE b.status = ? AND b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> '' " +
      `AND ${expr} > 0 AND ${expr} <= ? ` +
      'ORDER BY daysToExpiry ASC, b.id ASC',
    [today, 'ACTIVE', today, today, days],
  );
  return rows.map(row => ({
    batchId: row.batchId,
    productId: row.productId,
    expiryDate: row.expiryDate,
    quantity: num(row.quantity),
    daysToExpiry: row.daysToExpiry,
  }));
}

/** ACTIVE batches with stock whose expiry date has passed (days <= 0). */
export async function getExpiredBatches(db: TypedDb, opts?: QueryOptions): Promise<ExpiringBatchRow[]> {
  const today = todayOf(opts);
  const expr = daysToExpirySql('b.expiry_date');
  const rows = await db.all<{ batchId: number; productId: number; expiryDate: string; quantity: number; daysToExpiry: number }>(
    `SELECT b.id AS batchId, b.product_id AS productId, b.expiry_date AS expiryDate, ` +
      `b.quantity AS quantity, ${expr} AS daysToExpiry ` +
      'FROM batches b ' +
      "WHERE b.status = ? AND b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> '' " +
      `AND ${expr} <= 0 ` +
      'ORDER BY daysToExpiry ASC, b.id ASC',
    [today, 'ACTIVE', today],
  );
  return rows.map(row => ({
    batchId: row.batchId,
    productId: row.productId,
    expiryDate: row.expiryDate,
    quantity: num(row.quantity),
    daysToExpiry: row.daysToExpiry,
  }));
}

export interface InventorySummary {
  totalQuantity: number;
  nearestExpiry: string | null;
  batchCount: number;
}

/** Total ACTIVE stock, nearest expiry among stocked batches, batch count. */
export async function getInventorySummary(
  db: TypedDb,
  productId: number,
): Promise<InventorySummary> {
  const row = await db.get<{ totalQuantity: number; nearestExpiry: string | null; batchCount: number }>(
    'SELECT COALESCE(SUM(quantity), 0) AS totalQuantity, ' +
      "MIN(CASE WHEN quantity > 0 AND expiry_date IS NOT NULL AND expiry_date <> '' THEN expiry_date END) AS nearestExpiry, " +
      'COUNT(*) AS batchCount FROM batches ' +
      'WHERE product_id = ? AND status = ? AND quantity > 0',
    [productId, 'ACTIVE'],
  );
  return {
    totalQuantity: num(row?.totalQuantity),
    nearestExpiry: row?.nearestExpiry ?? null,
    batchCount: num(row?.batchCount),
  };
}

// ─── Sales summaries ────────────────────────────────────────────────

export interface SalesSummary {
  cashSales: number;
  creditSales: number;
  totalSales: number;
  transactionCount: number;
}

interface SalesRangeParts {
  grossCash: number;
  grossCredit: number;
  cogs: number;
  saleCount: number;
  saleReturnCashRefund: number;
  saleReturnCreditReduction: number;
  saleReturnCogs: number;
  saleReturnCount: number;
  purchaseReturnTotal: number;
  purchaseReturnCashRefund: number;
  purchaseReturnCount: number;
  collections: number;
  totalExpenses: number;
  purchasesTotal: number;
  purchasesPaid: number;
}

/**
 * All aggregates behind getReportSummary, in one place. Mirrors the
 * in-memory logic exactly: cancelled sales/purchases/returns are
 * excluded; a `mixed` sale contributes amount_paid to cash and
 * remaining to credit; sale returns reduce cash/credit sales and COGS;
 * purchase returns reduce total purchases.
 */
async function salesRangeParts(db: TypedDb, dateFrom: string, dateTo: string): Promise<SalesRangeParts> {
  const sales = await db.get<{ grossCash: number; grossCredit: number; cogs: number; saleCount: number }>(
    'SELECT ' +
      "COALESCE(SUM(CASE WHEN sale_type = 'cash' THEN total WHEN sale_type = 'mixed' THEN amount_paid ELSE 0 END), 0) AS grossCash, " +
      "COALESCE(SUM(CASE WHEN sale_type = 'credit' THEN total WHEN sale_type = 'mixed' THEN remaining ELSE 0 END), 0) AS grossCredit, " +
      'COALESCE(SUM(cogs), 0) AS cogs, COUNT(*) AS saleCount ' +
      'FROM sales WHERE cancelled = 0 AND date >= ? AND date <= ?',
    [dateFrom, dateTo],
  );
  const saleReturns = await db.get<{ cashRefund: number; creditReduction: number; cogs: number; retCount: number }>(
    'SELECT COALESCE(SUM(cash_refund), 0) AS cashRefund, ' +
      'COALESCE(SUM(credit_reduction), 0) AS creditReduction, ' +
      'COALESCE(SUM(returned_cogs_total), 0) AS cogs, COUNT(*) AS retCount ' +
      'FROM sale_returns WHERE (status IS NULL OR status <> ?) AND date >= ? AND date <= ?',
    ['CANCELLED', dateFrom, dateTo],
  );
  const purchaseReturns = await db.get<{ total: number; cashRefund: number; retCount: number }>(
    'SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(cash_refund), 0) AS cashRefund, COUNT(*) AS retCount ' +
      'FROM purchase_returns WHERE (status IS NULL OR status <> ?) AND date >= ? AND date <= ?',
    ['CANCELLED', dateFrom, dateTo],
  );
  const collections = await db.get<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM cash_transactions WHERE type = ? AND date >= ? AND date <= ?",
    ['COLLECTION', dateFrom, dateTo],
  );
  const expenses = await db.get<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= ? AND date <= ?',
    [dateFrom, dateTo],
  );
  const purchases = await db.get<{ total: number; paid: number }>(
    'SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(amount_paid), 0) AS paid ' +
      'FROM purchases WHERE cancelled = 0 AND date >= ? AND date <= ?',
    [dateFrom, dateTo],
  );
  return {
    grossCash: num(sales?.grossCash),
    grossCredit: num(sales?.grossCredit),
    cogs: num(sales?.cogs),
    saleCount: num(sales?.saleCount),
    saleReturnCashRefund: num(saleReturns?.cashRefund),
    saleReturnCreditReduction: num(saleReturns?.creditReduction),
    saleReturnCogs: num(saleReturns?.cogs),
    saleReturnCount: num(saleReturns?.retCount),
    purchaseReturnTotal: num(purchaseReturns?.total),
    purchaseReturnCashRefund: num(purchaseReturns?.cashRefund),
    purchaseReturnCount: num(purchaseReturns?.retCount),
    collections: num(collections?.total),
    totalExpenses: num(expenses?.total),
    purchasesTotal: num(purchases?.total),
    purchasesPaid: num(purchases?.paid),
  };
}

export async function getSalesSummary(
  db: TypedDb,
  dateFrom: string,
  dateTo: string,
): Promise<SalesSummary> {
  const parts = await salesRangeParts(db, dateFrom, dateTo);
  const cashSales = parts.grossCash - parts.saleReturnCashRefund;
  const creditSales = parts.grossCredit - parts.saleReturnCreditReduction;
  return {
    cashSales,
    creditSales,
    totalSales: cashSales + creditSales,
    transactionCount: parts.saleCount + parts.saleReturnCount + parts.purchaseReturnCount,
  };
}

export interface ReportSummarySql {
  cashSales: number;
  creditSales: number;
  totalSales: number;
  collections: number;
  totalExpenses: number;
  totalPurchases: number;
  grossProfit: number;
  netCash: number;
  transactionCount: number;
  cogs: number;
}

/** Full getReportSummary equivalent over the typed tables. */
export async function getReportSummarySql(
  db: TypedDb,
  dateFrom: string,
  dateTo: string,
): Promise<ReportSummarySql> {
  const parts = await salesRangeParts(db, dateFrom, dateTo);
  const cashSales = parts.grossCash - parts.saleReturnCashRefund;
  const creditSales = parts.grossCredit - parts.saleReturnCreditReduction;
  const totalSales = cashSales + creditSales;
  const totalPurchases = parts.purchasesTotal - parts.purchaseReturnTotal;
  const cogs = parts.cogs - parts.saleReturnCogs;
  return {
    cashSales,
    creditSales,
    totalSales,
    collections: parts.collections,
    totalExpenses: parts.totalExpenses,
    totalPurchases,
    cogs,
    grossProfit: totalSales - cogs,
    netCash: parts.grossCash + parts.collections - parts.totalExpenses - parts.purchasesPaid
      - parts.saleReturnCashRefund + parts.purchaseReturnCashRefund,
    transactionCount: parts.saleCount + parts.saleReturnCount + parts.purchaseReturnCount,
  };
}

// ─── Dashboard KPIs ─────────────────────────────────────────────────

export interface DashboardKpisSql {
  todaySales: number;
  todayCashSales: number;
  todayCreditSales: number;
  lowStockCount: number;
  expiringCount: number;
  expiredCount: number;
  outOfStockCount: number;
}

/**
 * The SQL-computable subset of getDashboardKpis. Counts mirror the
 * in-memory rules exactly: low-stock counts products with 0 < stock <=
 * minimum_stock (out-of-stock products are counted separately), and
 * expired/expiring count *batches* in the expiry radar (expired first,
 * then 1..90 days).
 */
export async function getDashboardKpisSql(db: TypedDb, todayDate: string): Promise<DashboardKpisSql> {
  const summary = await getSalesSummary(db, todayDate, todayDate);
  const counts = await db.get<{ low: number; out: number }>(
    'SELECT ' +
      'COALESCE(SUM(CASE WHEN totalQty > 0 AND totalQty <= COALESCE(minimum_stock, 0) THEN 1 ELSE 0 END), 0) AS low, ' +
      'COALESCE(SUM(CASE WHEN totalQty = 0 THEN 1 ELSE 0 END), 0) AS out ' +
      'FROM (SELECT p.minimum_stock AS minimum_stock, COALESCE(SUM(b.quantity), 0) AS totalQty ' +
      'FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.status = ? ' +
      'GROUP BY p.id) AS agg',
    ['ACTIVE'],
  );
  const expiry = await db.get<{ expired: number; expiring: number }>(
    `SELECT ` +
      `COALESCE(SUM(CASE WHEN ${daysToExpirySql('expiry_date')} <= 0 THEN 1 ELSE 0 END), 0) AS expired, ` +
      `COALESCE(SUM(CASE WHEN ${daysToExpirySql('expiry_date')} > 0 AND ${daysToExpirySql('expiry_date')} <= 90 THEN 1 ELSE 0 END), 0) AS expiring ` +
      'FROM batches ' +
      "WHERE status = ? AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date <> ''",
    [todayDate, todayDate, todayDate, 'ACTIVE'],
  );
  return {
    todaySales: summary.totalSales,
    todayCashSales: summary.cashSales,
    todayCreditSales: summary.creditSales,
    lowStockCount: num(counts?.low),
    outOfStockCount: num(counts?.out),
    expiredCount: num(expiry?.expired),
    expiringCount: num(expiry?.expiring),
  };
}

// ─── Expiry radar / inventory list ──────────────────────────────────

function boolFromSql(value: unknown): boolean {
  return value === 1 || value === true;
}

function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: num(row['id']),
    barcode: (row['barcode'] as string | null) ?? null,
    internal_code: (row['internal_code'] as string | null) ?? null,
    trade_name: (row['trade_name'] as string) ?? '',
    generic_name: (row['generic_name'] as string | null) ?? null,
    active_ingredient: (row['active_ingredient'] as string | null) ?? null,
    strength: (row['strength'] as string | null) ?? null,
    dosage_form: (row['dosage_form'] as string | null) ?? null,
    manufacturer: (row['manufacturer'] as string | null) ?? null,
    category: (row['category'] as string | null) ?? null,
    prescription_required: boolFromSql(row['prescription_required']),
    controlled: boolFromSql(row['controlled']),
    inventory_unit: (row['inventory_unit'] as string) ?? '',
    minimum_stock: num(row['minimum_stock']),
    reorder_level: num(row['reorder_level']),
    selling_price: num(row['selling_price']),
    default_purchase_price: num(row['default_purchase_price']),
    active: boolFromSql(row['active']),
    notes: (row['notes'] as string | null) ?? null,
    catalog_source_id: (row['catalog_source_id'] as string | null) ?? null,
    created_at: (row['created_at'] as string) ?? '',
    updated_at: (row['updated_at'] as string) ?? '',
    syncId: (row['sync_id'] as string | undefined) ?? undefined,
    updatedAt: (row['sync_updated_at'] as string | undefined) ?? undefined,
    syncDeviceId: (row['sync_device_id'] as string | undefined) ?? undefined,
  };
}

function mapBatchRow(row: Record<string, unknown>): Batch {
  const isOpening = row['is_opening'];
  return {
    id: num(row['id']),
    product_id: num(row['product_id']),
    batch_number: (row['batch_number'] as string) ?? '',
    expiry_date: (row['expiry_date'] as string) ?? '',
    received_date: (row['received_date'] as string) ?? '',
    purchase_price: num(row['purchase_price']),
    selling_price: (row['selling_price'] as number | null) ?? null,
    quantity: num(row['quantity']),
    initial_quantity: num(row['initial_quantity']),
    supplier_id: (row['supplier_id'] as number | null) ?? null,
    purchase_id: (row['purchase_id'] as number | null) ?? null,
    status: (row['status'] as Batch['status']) ?? 'ACTIVE',
    notes: (row['notes'] as string | null) ?? null,
    is_opening: isOpening === null || isOpening === undefined ? undefined : boolFromSql(isOpening),
    quarantined_quantity: (row['quarantined_quantity'] as number | undefined) ?? undefined,
    created_at: (row['created_at'] as string) ?? '',
    syncId: (row['sync_id'] as string | undefined) ?? undefined,
    updatedAt: (row['updated_at'] as string | undefined) ?? undefined,
    syncDeviceId: (row['sync_device_id'] as string | undefined) ?? undefined,
  };
}

/** getExpiryRadar equivalent: batches in the radar, earliest expiry first. */
export async function getExpiryRadarSql(db: TypedDb, opts?: QueryOptions): Promise<ExpiryRadarItem[]> {
  const today = todayOf(opts);
  const expr = daysToExpirySql('b.expiry_date');
  const rows = await db.all<{
    product_id: number; product_name: string; batch_id: number; batch_number: string;
    expiry_date: string; days_to_expiry: number; quantity: number; unit: string; stock_value: number;
  }>(
    `SELECT b.product_id AS product_id, p.trade_name AS product_name, b.id AS batch_id, ` +
      `b.batch_number AS batch_number, b.expiry_date AS expiry_date, ${expr} AS days_to_expiry, ` +
      `b.quantity AS quantity, p.inventory_unit AS unit, (b.quantity * b.purchase_price) AS stock_value ` +
      'FROM batches b JOIN products p ON p.id = b.product_id ' +
      "WHERE b.status = ? AND b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> '' " +
      `AND ${expr} <= 90 ` +
      'ORDER BY days_to_expiry ASC, b.id ASC',
    [today, 'ACTIVE', today],
  );
  return rows.map(row => {
    const days = row.days_to_expiry;
    const group: ExpiryRadarItem['group'] = days <= 0 ? 'expired'
      : days <= 30 ? '30'
      : days <= 60 ? '60'
      : '90';
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      batch_id: row.batch_id,
      batch_number: row.batch_number,
      expiry_date: row.expiry_date,
      days_to_expiry: days,
      quantity: num(row.quantity),
      unit: row.unit,
      stock_value: num(row.stock_value),
      group,
    };
  });
}

export interface InventoryListOptions {
  search?: string;
  status?: string;
  category?: string;
}

/**
 * getInventoryList equivalent. Aggregation is SQL; the status rule,
 * search/category filters and Arabic trade-name ordering are applied in
 * TypeScript with the exact same code paths as the in-memory version.
 */
export async function getInventoryListSql(
  db: TypedDb,
  opts?: InventoryListOptions,
  queryOpts?: QueryOptions,
): Promise<InventoryItem[]> {
  const today = todayOf(queryOpts);
  const productRows = await db.all<Record<string, unknown>>(
    'SELECT p.*, COALESCE(SUM(b.quantity), 0) AS total_quantity, ' +
      "MIN(CASE WHEN b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> '' THEN b.expiry_date END) AS nearest_expiry " +
      'FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.status = ? ' +
      'WHERE COALESCE(p.active, 0) = 1 GROUP BY p.id',
    ['ACTIVE'],
  );
  const batchRows = await db.all<Record<string, unknown>>(
    'SELECT * FROM batches WHERE status = ? AND quantity > 0 ORDER BY product_id, expiry_date',
    ['ACTIVE'],
  );
  // Same filters as getProducts / getInventoryList in erp-database.ts,
  // applied to the raw product rows (which still carry the searchable
  // fields that InventoryItem drops).
  let filteredRows = productRows;
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    filteredRows = filteredRows.filter(row =>
      String(row['trade_name'] ?? '').toLowerCase().includes(q) ||
      String(row['generic_name'] ?? '').toLowerCase().includes(q) ||
      String(row['active_ingredient'] ?? '').toLowerCase().includes(q) ||
      String(row['barcode'] ?? '').includes(q) ||
      String(row['internal_code'] ?? '').includes(q) ||
      String(row['manufacturer'] ?? '').toLowerCase().includes(q),
    );
  }
  if (opts?.category) filteredRows = filteredRows.filter(row => row['category'] === opts.category);
  const batchesByProduct = new Map<number, Batch[]>();
  for (const row of batchRows) {
    const batch = mapBatchRow(row);
    const list = batchesByProduct.get(batch.product_id) ?? [];
    list.push(batch);
    batchesByProduct.set(batch.product_id, list);
  }
  let items: InventoryItem[] = filteredRows.map(row => {
    const product = mapProductRow(row);
    const batches = batchesByProduct.get(product.id) ?? [];
    const totalQty = num(row['total_quantity']);
    const nearestExpiry = (row['nearest_expiry'] as string | null) ?? null;
    let daysToNearest: number | null = null;
    if (nearestExpiry) {
      const diff = new Date(nearestExpiry).getTime() - new Date(today).getTime();
      daysToNearest = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
    let status: InventoryItem['status'] = 'ok';
    if (totalQty === 0) status = 'out';
    else if (totalQty <= product.minimum_stock) status = 'low';
    if (daysToNearest !== null) {
      if (daysToNearest <= 0) status = 'expired';
      else if (daysToNearest <= 90) status = 'expiring';
    }
    return {
      product_id: product.id,
      trade_name: product.trade_name,
      generic_name: product.generic_name,
      barcode: product.barcode,
      category: product.category,
      inventory_unit: product.inventory_unit,
      selling_price: product.selling_price,
      total_quantity: totalQty,
      minimum_stock: product.minimum_stock,
      reorder_level: product.reorder_level,
      status,
      nearest_expiry: nearestExpiry,
      days_to_nearest_expiry: daysToNearest,
      batches,
    };
  });
  // Same status filter as getInventoryList in erp-database.ts.
  if (opts?.status && opts.status !== 'all') {
    items = items.filter(item => item.status === opts.status);
  }
  items.sort((a, b) => a.trade_name.localeCompare(b.trade_name, 'ar'));
  return items;
}
