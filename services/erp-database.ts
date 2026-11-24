// Smart Pharmacy ERP — Complete Database Service
// The in-memory repository is persisted to device storage so data survives restarts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { toBaseQuantity, priceForUnit, isValidIsoDate, isValidUnitQuantity } from './unit-conversion';
import { withAtomicMutation } from './atomic-store';
import { isPermissionAllowed } from './employee-permissions';
import {
  AsyncStorageAdapter,
  COLLECTION_NAMES,
  createDefaultAdapter,
  diffRows,
  rowsToSnapshot,
  snapshotToRows,
  type PersistenceAdapter,
  type SnapshotDiff,
  type SnapshotRows,
  type StoredSnapshot,
} from './sqlite-store';
import {
  getDashboardKpisSql,
  getExpiryRadarSql,
  getInventoryListSql,
  getReportSummarySql,
  type TypedDb,
} from './sqlite-typed';
import {
  buildSaleWritePlan,
  executeSaleTransaction,
  type PlannedSaleItem,
  type SalePlanInput,
  type SaleWritePlan,
} from './sqlite-writes';

// ═══════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════

export type TransactionType =
  | 'PURCHASE' | 'SALE' | 'SALE_RETURN' | 'PURCHASE_RETURN'
  | 'OPENING' | 'FREE_SAMPLE_IN' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
  | 'DAMAGE' | 'EXPIRED' | 'WRITE_OFF'
  | 'TRANSFER_IN' | 'TRANSFER_OUT';

export type SaleType = 'cash' | 'credit' | 'mixed';
export type UserRole = 'ADMIN' | 'MANAGER' | 'PHARMACIST' | 'CASHIER' | 'STOREKEEPER' | 'ACCOUNTANT';
export type EmployeePermissionMap = Record<string, boolean>;
export type MovementClass = 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD';
export type AbcClass = 'A' | 'B' | 'C';
export type ShiftStatus = 'OPEN' | 'CLOSED';
export type BatchStatus = 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'RECALLED';
export type ReturnSettlementMethod = 'CASH_REFUND' | 'CUSTOMER_BALANCE' | 'CUSTOMER_CREDIT' | 'SUPPLIER_BALANCE';
export type ReturnCondition = 'SELLABLE' | 'DAMAGED';

// ─── Cloud sync identity ──────────────────────────────────────────
/** Identity of a row for cloud sync (see docs/CLOUD_SYNC.md). Present on
 * every synced row; optional so legacy snapshots load without them — the
 * store backfills them on load and stamps them on every change.
 * `syncId` is the global identity (remote `client_id`); the local numeric
 * `id` never leaves the device and never identifies a row remotely.
 * `updatedAt` is an ISO timestamp driving last-write-wins conflicts;
 * `syncDeviceId` is the device that last wrote the row (tie-breaker). */
export interface SyncFields {
  syncId?: string;
  updatedAt?: string;
  syncDeviceId?: string;
}

// ─── Pharmacy ─────────────────────────────────────────────
export interface Pharmacy {
  id: number;
  name: string;
  owner_name: string;
  license_number: string;
  phone: string;
  address: string;
  currency: string;
  currency_symbol: string;
  tax_number: string;
  receipt_header: string;
  receipt_footer: string;
  created_at: string;
}

// ─── Users & Roles ────────────────────────────────────────
export interface User extends SyncFields {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  /** Per-operation overrides saved locally; omitted legacy values use role defaults. */
  permissions?: EmployeePermissionMap;
  job_title?: string | null;
  active: boolean;
  last_login: string | null;
  created_at: string;
}

// ─── Products ─────────────────────────────────────────────
export interface Product extends SyncFields {
  id: number;
  barcode: string | null;
  internal_code: string | null;
  trade_name: string;
  generic_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  category: string | null;
  prescription_required: boolean;
  controlled: boolean;
  inventory_unit: string;
  minimum_stock: number;
  reorder_level: number;
  selling_price: number;
  default_purchase_price: number;
  active: boolean;
  notes: string | null;
  /** Optional reference-catalog ID; not a stock quantity or inventory source. */
  catalog_source_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductUnit extends SyncFields {
  id: number;
  product_id: number;
  unit_name: string;
  conversion_factor: number; // how many inventory_units in this unit
  /** Optional parent relationship; absent in legacy v1 snapshots. */
  parent_unit_name?: string | null;
  quantity_per_parent?: number | null;
  /** Null/undefined means derive from the product's base price. */
  sale_price?: number | null;
  purchase_price?: number | null;
  is_purchase_default: boolean;
  is_sale_default: boolean;
}

// ─── Batches ──────────────────────────────────────────────
export interface Batch extends SyncFields {
  id: number;
  product_id: number;
  batch_number: string;
  expiry_date: string;
  received_date: string;
  purchase_price: number;
  selling_price: number | null;
  quantity: number;        // current qty in inventory_unit
  initial_quantity: number;
  supplier_id: number | null;
  purchase_id: number | null;
  status: BatchStatus;
  notes: string | null;
  is_opening?: boolean;
  /** Returned damaged stock is held separately from saleable quantity. */
  quarantined_quantity?: number;
  created_at: string;
}

// ─── Stock Movements ──────────────────────────────────────
export interface StockMovement extends SyncFields {
  id: number;
  product_id: number;
  batch_id: number | null;
  type: TransactionType;
  quantity: number;        // positive = in, negative = out
  unit: string;
  quantity_in_inventory_unit: number;
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  user_id: number | null;
  created_at: string;
}

// ─── Sales ────────────────────────────────────────────────
export interface Sale extends SyncFields {
  id: number;
  invoice_number: string;
  sale_type: SaleType;
  customer_id: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change_given: number;
  remaining: number;
  cogs: number;
  gross_profit: number;
  date: string;
  shift_id: number | null;
  user_id: number | null;
  notes: string | null;
  cancelled: boolean;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface SaleItem extends SyncFields {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  batch_id: number | null;
  unit: string;
  unit_name?: string;
  quantity: number;
  quantity_entered?: number;
  /** Conversion snapshot to the base inventory unit. */
  conversion_factor?: number;
  quantity_in_inventory_unit: number;
  unit_price: number;
  /** Cost per base inventory unit at the time this sale was allocated. */
  base_purchase_price?: number;
  discount: number;
  line_total: number;
  cogs: number;
}

export interface SaleBatchAllocation extends SyncFields {
  id: number;
  sale_item_id: number;
  batch_id: number;
  quantity_allocated: number;
  purchase_price: number;
}

export interface SalePayment extends SyncFields {
  id: number;
  sale_id: number;
  amount: number;
  payment_method: string;
  date: string;
  note: string | null;
  created_at: string;
}

// ─── Purchases ────────────────────────────────────────────
export interface Purchase extends SyncFields {
  id: number;
  invoice_number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  date: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  remaining: number;
  notes: string | null;
  cancelled: boolean;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  user_id: number | null;
  created_at: string;
}

export interface PurchaseItem extends SyncFields {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name: string;
  batch_number: string;
  expiry_date: string;
  unit: string;
  unit_name?: string;
  quantity: number;
  quantity_entered?: number;
  batch_id?: number;
  conversion_factor?: number;
  quantity_in_inventory_unit: number;
  purchase_price: number;
  base_purchase_price?: number;
  free_quantity: number;
  discount: number;
  line_total: number;
}

export interface ReturnBatchAllocation {
  batch_id: number;
  quantity: number;
}

export interface SaleReturnItem {
  id: number;
  return_id: number;
  sale_item_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_inventory_unit: number;
  refund_amount: number;
  returned_cogs: number;
  batch_allocations: ReturnBatchAllocation[];
  unit_price?: number;
  original_quantity?: number;
  previously_returned_quantity?: number;
  condition?: ReturnCondition;
}

export interface SaleReturn extends SyncFields {
  id: number;
  sale_id: number;
  return_number?: string;
  invoice_number: string;
  customer_id?: number | null;
  user_id?: number | null;
  user_name?: string | null;
  settlement_method?: ReturnSettlementMethod;
  condition?: ReturnCondition;
  is_direct?: boolean;
  notes?: string | null;
  status?: 'POSTED' | 'CANCELLED';
  idempotency_key?: string | null;
  total: number;
  cash_refund: number;
  credit_reduction: number;
  date: string;
  created_at: string;
  items: SaleReturnItem[];
}

export interface PurchaseReturnItem {
  id: number;
  return_id: number;
  purchase_item_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_inventory_unit: number;
  refund_amount: number;
  batch_id: number;
  unit_price?: number;
  original_quantity?: number;
  previously_returned_quantity?: number;
}

export interface PurchaseReturn extends SyncFields {
  id: number;
  purchase_id: number;
  return_number?: string;
  invoice_number: string;
  supplier_id?: number | null;
  user_id?: number | null;
  user_name?: string | null;
  settlement_method?: ReturnSettlementMethod;
  is_direct?: boolean;
  notes?: string | null;
  status?: 'POSTED' | 'CANCELLED';
  idempotency_key?: string | null;
  total: number;
  cash_refund: number;
  payable_reduction: number;
  date: string;
  created_at: string;
  items: PurchaseReturnItem[];
}

// ─── Customers ────────────────────────────────────────────
export interface Customer extends SyncFields {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;        // positive = owes us
  notes: string | null;
  created_at: string;
}

export interface CustomerTransaction extends SyncFields {
  id: number;
  customer_id: number;
  type: 'sale' | 'payment' | 'return' | 'adjustment';
  amount: number;
  balance_after: number;
  reference_id: number | null;
  note: string | null;
  date: string;
  created_at: string;
}

// ─── Suppliers ────────────────────────────────────────────
export interface Supplier extends SyncFields {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;        // positive = we owe them
  notes: string | null;
  created_at: string;
}

export interface SupplierTransaction extends SyncFields {
  id: number;
  supplier_id: number;
  type: 'purchase' | 'payment' | 'return' | 'adjustment';
  amount: number;
  balance_after: number;
  reference_id: number | null;
  note: string | null;
  date: string;
  created_at: string;
}

// ─── Cashbox ──────────────────────────────────────────────
export type CashboxId = 'daily' | 'pharmacy' | 'bank';
export interface CashboxDefinition { id: CashboxId; label: string; shortLabel: string; }
export const CASHBOXES: readonly CashboxDefinition[] = [
  { id: 'daily', label: 'صندوق اليومية', shortLabel: 'اليومية' },
  { id: 'pharmacy', label: 'صندوق الصيدلية', shortLabel: 'الصيدلية' },
  { id: 'bank', label: 'صندوق الصراف / البنك', shortLabel: 'الصراف / البنك' },
];

export interface CashTransaction extends SyncFields {
  id: number;
  type: 'SALE_CASH' | 'COLLECTION' | 'PURCHASE_PAYMENT' | 'SUPPLIER_PAYMENT'
      | 'CUSTOMER_REFUND' | 'PURCHASE_RETURN' | 'EXPENSE' | 'WITHDRAWAL' | 'DEPOSIT' | 'OPENING' | 'CLOSING' | 'ADJUSTMENT'
      | 'RECEIPT' | 'PAYMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  amount: number;         // positive = in, negative = out
  /** Missing on legacy records; those are treated as daily-cashbox transactions. */
  cashbox_id?: CashboxId;
  reference_type: string | null;
  reference_id: number | null;
  shift_id: number | null;
  note: string | null;
  user_id: number | null;
  date: string;
  created_at: string;
}

// ─── Shifts ───────────────────────────────────────────────
export interface Shift extends SyncFields {
  id: number;
  user_id: number | null;
  user_name: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  difference_reason: string | null;
  total_sales: number;
  total_collections: number;
  total_expenses: number;
  total_purchases_paid: number;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

// ─── Expenses ─────────────────────────────────────────────
export interface Expense extends SyncFields {
  id: number;
  category: string;
  amount: number;
  date: string;
  shift_id: number | null;
  note: string | null;
  user_id: number | null;
  cashbox_id?: CashboxId;
  created_at: string;
}

// ─── Audit ────────────────────────────────────────────────
export interface AuditLog extends SyncFields {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  before_data: string | null;
  after_data: string | null;
  reason: string | null;
  ip: string | null;
  created_at: string;
}

// ─── Settings ─────────────────────────────────────────────
export interface Setting {
  key: string;
  value: string;
}

// ─── Report Types ─────────────────────────────────────────
export interface DashboardKpis {
  todaySales: number;
  todayCashSales: number;
  todayCreditSales: number;
  todayCollections: number;
  todayExpenses: number;
  todayPurchases: number;
  todayGrossProfit: number;
  cashBalance: number;
  totalCustomerDebt: number;
  totalSupplierDebt: number;
  lowStockCount: number;
  expiringCount: number;
  expiredCount: number;
  outOfStockCount: number;
  openShiftId: number | null;
  recentSales: Sale[];
}

export interface ReportSummary {
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

export interface ExpiryRadarItem {
  product_id: number;
  product_name: string;
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  days_to_expiry: number;
  quantity: number;
  unit: string;
  stock_value: number;
  group: 'expired' | '30' | '60' | '90' | 'ok';
}

export interface InventoryItem {
  product_id: number;
  trade_name: string;
  generic_name: string | null;
  barcode: string | null;
  category: string | null;
  inventory_unit: string;
  selling_price: number;
  total_quantity: number;
  minimum_stock: number;
  reorder_level: number;
  status: 'ok' | 'low' | 'out' | 'expiring' | 'expired';
  nearest_expiry: string | null;
  days_to_nearest_expiry: number | null;
  batches: Batch[];
}

// ─── Cloud sync outbox ────────────────────────────────────────────
/** One pending cloud-sync change. Built from the persistence diff in
 * persistStore(), so every local mutation is recorded exactly once per
 * row (repeated edits merge into the latest entry). Entries are removed
 * only after a successful push (see clearSyncedOutbox). The outbox is
 * part of the store, so it survives restarts like any other collection;
 * it is never itself recorded in the outbox. */
export interface SyncOutboxEntry extends SyncFields {
  id: number;
  collection: string;
  op: 'upsert' | 'delete';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// IN-MEMORY STORE
// ═══════════════════════════════════════════════════════════

const store = {
  settings: {} as Record<string, string>,
  pharmacy: null as Pharmacy | null,
  users: [] as User[],
  products: [] as Product[],
  productUnits: [] as ProductUnit[],
  batches: [] as Batch[],
  stockMovements: [] as StockMovement[],
  sales: [] as Sale[],
  saleItems: [] as SaleItem[],
  saleBatchAllocations: [] as SaleBatchAllocation[],
  salePayments: [] as SalePayment[],
  saleReturns: [] as SaleReturn[],
  purchases: [] as Purchase[],
  purchaseItems: [] as PurchaseItem[],
  purchaseReturns: [] as PurchaseReturn[],
  customers: [] as Customer[],
  customerTransactions: [] as CustomerTransaction[],
  suppliers: [] as Supplier[],
  supplierTransactions: [] as SupplierTransaction[],
  cashTransactions: [] as CashTransaction[],
  shifts: [] as Shift[],
  expenses: [] as Expense[],
  auditLogs: [] as AuditLog[],
  syncOutbox: [] as SyncOutboxEntry[],
};

const ids = {
  products: 1, productUnits: 1, batches: 1, stockMovements: 1,
  sales: 1, saleItems: 1, saleAllocations: 1, salePayments: 1,
  saleReturns: 1, saleReturnItems: 1, purchaseReturns: 1, purchaseReturnItems: 1,
  purchases: 1, purchaseItems: 1,
  customers: 1, customerTx: 1,
  suppliers: 1, supplierTx: 1,
  cashTx: 1, shifts: 1, expenses: 1, auditLogs: 1, users: 1, syncOutbox: 1,
};

let invoiceCounter = 1000;
let setupDone = false;
const STORE_KEY = '@pharmacy_accounts/store/v1';
let persistQueue: Promise<void> = Promise.resolve();

// ─── Helpers ──────────────────────────────────────────────
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => new Date().toISOString().split('T')[0];
export const getToday = today;

// ─── Persistence backend (Phase 1: SQLite) ─────────────────────────
// The store itself is unchanged; only how it reaches the disk changed.
// On native devices the backend is SQLite (see services/sqlite-store.ts);
// in Node (unit tests) and on web it is AsyncStorage. `lastSavedRows`
// holds the serialised rows of the last successfully saved snapshot, so
// each persist writes only the diff instead of the whole store.
let persistenceBackend: PersistenceAdapter = createDefaultAdapter();
let lastSavedRows: SnapshotRows | null = null;
let deferPersistCount = 0;
let persistDeferred = false;
const migrationStatus = { migratedFromAsyncStorage: false };

/** Swap the persistence backend (tests only). Resets the saved-rows
 * baseline, so the next persist writes a full snapshot. */
export function setPersistenceBackend(adapter: PersistenceAdapter): void {
  persistenceBackend = adapter;
  lastSavedRows = null;
  migrationStatus.migratedFromAsyncStorage = false;
  typedStoreReady = null;
  typedSchemaVersion = null;
}

export function getPersistenceBackendName(): string {
  return persistenceBackend.name;
}

/** Backend in use, whether the legacy AsyncStorage snapshot was migrated
 * in this session, and the key of a quarantined corrupt snapshot, if any. */
export function getMigrationStatus(): {
  backend: string;
  migratedFromAsyncStorage: boolean;
  corruptSnapshotKey: string | null;
} {
  return {
    backend: persistenceBackend.name,
    migratedFromAsyncStorage: migrationStatus.migratedFromAsyncStorage,
    corruptSnapshotKey: lastCorruptSnapshotKey,
  };
}

function takeSnapshotRows(): SnapshotRows {
  const snapshot: StoredSnapshot = {
    store: store as unknown as Record<string, unknown>,
    ids: { ...ids },
    invoiceCounter,
  };
  return snapshotToRows(snapshot);
}

// ─── Typed store (Phase 2: SQLite) ────────────────────────────────
// The public read functions below stay synchronous and keep computing
// from the in-memory store — expo-sqlite is async, so a synchronous
// function cannot query it without changing its signature. The `*Async`
// variants next to them prefer the SQL query layer when the typed
// tables are ready and fall back to the in-memory computation on any
// failure (wrong backend, migration not run, SQL error), so a read can
// never fail because of the typed store. The cached readiness flag is
// reset whenever the backend is swapped.
//
// Note: erp-database.ts must never import node:sqlite or expo-sqlite;
// the adapter owns the database handle and hands out a TypedDb.

let typedStoreReady: boolean | null = null;
let typedSchemaVersion: string | null = null;

/** Run the v2 migration if needed and report whether SQL reads are usable. */
export async function ensureTypedStoreReady(): Promise<boolean> {
  if (typedStoreReady === true) return true;
  try {
    const ensure = persistenceBackend.ensureTypedTables;
    if (typeof ensure !== 'function') {
      typedStoreReady = false;
      return false;
    }
    const ready = await ensure.call(persistenceBackend);
    typedStoreReady = ready;
    if (ready) {
      const version = await persistenceBackend.getMeta?.('schema_version');
      typedSchemaVersion = typeof version === 'string' ? version : null;
    }
    return ready;
  } catch {
    typedStoreReady = false;
    return false;
  }
}

/** Cached typed-store readiness (false until ensureTypedStoreReady() succeeds). */
export function isTypedStoreReady(): boolean {
  return typedStoreReady === true;
}

/** Typed-store readiness and schema version, for tests and system-tools. */
export function getTypedStoreStatus(): { ready: boolean; schemaVersion: string | null } {
  return { ready: typedStoreReady === true, schemaVersion: typedSchemaVersion };
}

/** Run a query against the typed tables, or return null to use the
 * in-memory fallback. Any failure is swallowed (and warned about) here
 * so SQL problems can never break a read. */
async function withTypedDb<T>(query: (db: TypedDb) => Promise<T>): Promise<T | null> {
  try {
    if (!(await ensureTypedStoreReady())) return null;
    const getDb = persistenceBackend.getTypedDb;
    if (typeof getDb !== 'function') return null;
    const db = await getDb.call(persistenceBackend);
    if (!db) return null;
    return await query(db);
  } catch (error) {
    console.warn('[typed-store] SQL read failed, using in-memory fallback', error);
    return null;
  }
}

/** getDashboardKpis, preferring SQL for the SQL-computable fields. */
export async function getDashboardKpisAsync(): Promise<DashboardKpis> {
  const base = getDashboardKpis();
  const sql = await withTypedDb(db => getDashboardKpisSql(db, today()));
  if (!sql) return base;
  return {
    ...base,
    todaySales: sql.todaySales,
    todayCashSales: sql.todayCashSales,
    todayCreditSales: sql.todayCreditSales,
    lowStockCount: sql.lowStockCount,
    expiringCount: sql.expiringCount,
    expiredCount: sql.expiredCount,
    outOfStockCount: sql.outOfStockCount,
  };
}

/** getReportSummary, preferring the full SQL computation when ready. */
export async function getReportSummaryAsync(dateFrom: string, dateTo: string): Promise<ReportSummary> {
  const sql = await withTypedDb(db => getReportSummarySql(db, dateFrom, dateTo));
  return sql ?? getReportSummary(dateFrom, dateTo);
}

/** getExpiryRadar, preferring SQL when the typed store is ready. */
export async function getExpiryRadarAsync(): Promise<ExpiryRadarItem[]> {
  const sql = await withTypedDb(db => getExpiryRadarSql(db, { today: today() }));
  return sql ?? getExpiryRadar();
}

/** getInventoryList, preferring SQL when the typed store is ready. */
export async function getInventoryListAsync(opts?: {
  search?: string; status?: string; category?: string;
}): Promise<InventoryItem[]> {
  const sql = await withTypedDb(db => getInventoryListSql(db, opts, { today: today() }));
  return sql ?? getInventoryList(opts);
}

/** Inventory items with status 'low', preferring SQL when ready. */
export async function getLowStockProductsAsync(): Promise<InventoryItem[]> {
  return getInventoryListAsync({ status: 'low' });
}

// ─── Cloud sync: identity, device, outbox ─────────────────────────
// See docs/CLOUD_SYNC.md. The outbox is built here, in persistStore(),
// because every mutation in this module funnels through it — no service
// function needs to know about sync. The sync engine itself lives in
// services/cloud-sync.ts and only uses the exported helpers below.

/** Collections that may leave the device. `users` (local accounts with
 * password hashes) and the `syncOutbox` itself never sync. */
export const SYNCABLE_COLLECTIONS = (COLLECTION_NAMES as readonly string[]).filter(
  name => name !== 'users' && name !== 'syncOutbox',
);

/** Local numeric-id counter key per collection, for rows pulled from the
 * cloud (they arrive with a syncId but without a local numeric id). */
const IDS_KEY_BY_COLLECTION: Record<string, string> = {
  products: 'products',
  productUnits: 'productUnits',
  batches: 'batches',
  stockMovements: 'stockMovements',
  sales: 'sales',
  saleItems: 'saleItems',
  saleBatchAllocations: 'saleAllocations',
  salePayments: 'salePayments',
  saleReturns: 'saleReturns',
  purchases: 'purchases',
  purchaseItems: 'purchaseItems',
  purchaseReturns: 'purchaseReturns',
  customers: 'customers',
  customerTransactions: 'customerTx',
  suppliers: 'suppliers',
  supplierTransactions: 'supplierTx',
  cashTransactions: 'cashTx',
  shifts: 'shifts',
  expenses: 'expenses',
  auditLogs: 'auditLogs',
};

let outboxSuppressCount = 0;
let persistInProgress = false;

const isoNow = () => new Date().toISOString();

/** Generate a UUID v4. Uses crypto.randomUUID() when available; the
 * fallback keeps the same shape from time + randomness. */
export function generateSyncId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the fallback below.
  }
  const hex = (n: number) => {
    let out = '';
    for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  };
  const variant = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/** Stable per-device id, kept as a setting (settings never sync). This
 * never calls persistStore() itself: the in-flight persist writes the
 * setting, and any other caller persists it on its next write. */
export function getSyncDeviceId(): string {
  let id = store.settings['sync_device_id'];
  if (!id) {
    id = generateSyncId();
    store.settings['sync_device_id'] = id;
  }
  return id;
}

/** Assign a sync identity to a row that lacks one. `updatedAt` falls back
 * to the row's created_at (or now) so a legacy row keeps its original age
 * instead of looking brand new on its first sync. */
function ensureSyncFields(row: Record<string, unknown>): void {
  if (typeof row['syncId'] !== 'string' || !row['syncId']) row['syncId'] = generateSyncId();
  if (typeof row['updatedAt'] !== 'string' || !row['updatedAt']) {
    const created = typeof row['created_at'] === 'string' ? (row['created_at'] as string) : '';
    row['updatedAt'] = created || isoNow();
  }
  if (typeof row['syncDeviceId'] !== 'string' || !row['syncDeviceId']) {
    row['syncDeviceId'] = getSyncDeviceId();
  }
}

function ensureSyncFieldsForAllRows(): void {
  for (const name of COLLECTION_NAMES as readonly string[]) {
    if (name === 'syncOutbox') continue;
    const list = (store as Record<string, unknown>)[name];
    if (!Array.isArray(list)) continue;
    for (const row of list as Array<Record<string, unknown>>) ensureSyncFields(row);
  }
}

function findLiveRow(collection: string, rowId: number): Record<string, unknown> | null {
  const list = (store as Record<string, unknown>)[collection];
  if (!Array.isArray(list)) return null;
  return (list as Array<Record<string, unknown>>).find(r => r?.['id'] === rowId) ?? null;
}

function parseRowData(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Record outbox entries for one persistence diff. Repeated edits of the
 * same row merge into a single entry holding the latest op; a delete
 * always replaces an earlier upsert for the same row. Outbox rows
 * themselves and non-syncable collections are skipped, and the `at`
 * timestamp (the stamp time of this write) is the entry's updatedAt. */
function recordOutboxEntries(diff: SnapshotDiff, at: string): void {
  const savedByKey = new Map<string, string>();
  if (lastSavedRows) {
    for (const row of lastSavedRows.rows) savedByKey.set(`${row.collection}:${row.rowId}`, row.data);
  }
  const bySyncId = new Map(store.syncOutbox.map(entry => [entry.syncId, entry]));
  const apply = (syncId: string, collection: string, op: 'upsert' | 'delete') => {
    const existing = bySyncId.get(syncId);
    if (existing) {
      existing.op = op;
      existing.collection = collection;
      existing.updatedAt = at;
      existing.attempts = 0;
      existing.lastError = null;
    } else {
      const entry: SyncOutboxEntry = {
        id: ids.syncOutbox++,
        collection,
        syncId,
        op,
        updatedAt: at,
        attempts: 0,
        lastError: null,
        createdAt: at,
      };
      store.syncOutbox.push(entry);
      bySyncId.set(syncId, entry);
    }
  };
  for (const row of diff.upserts) {
    if (row.collection === 'syncOutbox' || !SYNCABLE_COLLECTIONS.includes(row.collection)) continue;
    const parsed = parseRowData(row.data);
    const syncId = parsed?.['syncId'];
    if (typeof syncId !== 'string' || !syncId) continue;
    apply(syncId, row.collection, 'upsert');
  }
  for (const deleted of diff.deletes) {
    if (deleted.collection === 'syncOutbox' || !SYNCABLE_COLLECTIONS.includes(deleted.collection)) continue;
    const parsed = parseRowData(savedByKey.get(`${deleted.collection}:${deleted.rowId}`) ?? '');
    const syncId = parsed?.['syncId'];
    if (typeof syncId !== 'string' || !syncId) continue;
    apply(syncId, deleted.collection, 'delete');
  }
}

/** Number of local changes waiting to be pushed to the cloud. */
export function getPendingSyncCount(): number {
  return store.syncOutbox.length;
}

/** A copy of the pending outbox (for the sync engine and the UI). */
export function getSyncOutboxSnapshot(): SyncOutboxEntry[] {
  return store.syncOutbox.map(entry => ({ ...entry }));
}

/** Remove the outbox entries that were pushed successfully. */
export function clearSyncedOutbox(syncIds: string[]): void {
  if (syncIds.length === 0) return;
  const wanted = new Set(syncIds);
  store.syncOutbox = store.syncOutbox.filter(entry => !wanted.has(entry.syncId ?? ''));
  persistStore();
}

/** Record a failed push attempt on entries (kept for retry). */
export function noteOutboxFailure(syncIds: string[], message: string): void {
  if (syncIds.length === 0) return;
  const wanted = new Set(syncIds);
  let changed = false;
  for (const entry of store.syncOutbox) {
    if (wanted.has(entry.syncId ?? '')) {
      entry.attempts += 1;
      entry.lastError = message;
      changed = true;
    }
  }
  if (changed) persistStore();
}

/** Run `fn` without recording outbox entries (used by the sync engine
 * when applying rows pulled from the cloud, so a pull never echoes
 * back into the outbox and the sync cannot loop). */
export function withOutboxSuppressed<T>(fn: () => T): T {
  outboxSuppressCount += 1;
  try {
    return fn();
  } finally {
    outboxSuppressCount -= 1;
  }
}

/** The live local row with this syncId, or null. Read-only: the sync
 * engine maps it immediately and never mutates it. */
export function getLocalRowBySyncId(
  collection: string,
  syncId: string,
): Record<string, unknown> | null {
  const list = (store as Record<string, unknown>)[collection];
  if (!Array.isArray(list)) return null;
  return (list as Array<Record<string, unknown>>).find(row => row?.['syncId'] === syncId) ?? null;
}

/** Copies of every local row in a collection (for the sync engine's
 * foreign-key resolution). */
export function getAllLocalRows(collection: string): Array<Record<string, unknown>> {
  const list = (store as Record<string, unknown>)[collection];
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown>>).map(row => ({ ...row }));
}

/** Give nested return-line items their parent return's local id. */
function patchReturnItems(row: Record<string, unknown>, returnId: number): void {
  const items = row['items'];
  if (!Array.isArray(items)) return;
  for (const item of items as Array<Record<string, unknown>>) {
    if (item && typeof item === 'object') item['return_id'] = returnId;
  }
}

/**
 * Apply rows pulled from the cloud to one collection, plus remote deletes.
 * Rows are matched by syncId: an existing row is replaced in place (keeping
 * its local numeric id); a new row gets the next local id. The caller wraps
 * this in withOutboxSuppressed() and persists once at the end.
 */
export function applyPulledChanges(
  collection: string,
  rows: Array<Record<string, unknown>>,
  deletedSyncIds: string[],
): void {
  const list = (store as Record<string, unknown>)[collection];
  if (!Array.isArray(list)) return;
  const arr = list as Array<Record<string, unknown>>;
  const bySyncId = new Map<string, Record<string, unknown>>();
  for (const row of arr) {
    if (typeof row['syncId'] === 'string' && row['syncId']) bySyncId.set(row['syncId'], row);
  }
  for (const row of rows) {
    const syncId = row['syncId'];
    if (typeof syncId !== 'string' || !syncId) continue;
    const existing = bySyncId.get(syncId);
    if (existing) {
      const localId = existing['id'];
      for (const key of Object.keys(existing)) delete existing[key];
      Object.assign(existing, row, { id: localId });
      // Nested return-line items carry the parent's local id, which the
      // mapper cannot know before the parent exists locally.
      if ((collection === 'saleReturns' || collection === 'purchaseReturns') && typeof localId === 'number') {
        patchReturnItems(existing, localId);
      }
    } else {
      const counterKey = IDS_KEY_BY_COLLECTION[collection];
      const nextId = counterKey ? (ids as Record<string, number>)[counterKey]++ : 0;
      const created = { ...row, id: nextId };
      if (collection === 'saleReturns' || collection === 'purchaseReturns') {
        patchReturnItems(created, nextId);
      }
      arr.push(created);
      bySyncId.set(syncId, created);
    }
  }
  if (deletedSyncIds.length > 0) {
    const doomed = new Set(deletedSyncIds);
    (store as Record<string, unknown>)[collection] = arr.filter(
      row => typeof row['syncId'] !== 'string' || !doomed.has(row['syncId']),
    );
  }
  persistStore();
}

function persistStore(): void {
  // Inside an atomic commit, defer the write: addAuditLog() during the
  // commit must not persist an intermediate snapshot (see
  // commitReturnAtomically). The deferred write is flushed once, after
  // the commit succeeds or the rollback restores the previous state.
  if (deferPersistCount > 0) {
    persistDeferred = true;
    return;
  }
  persistInProgress = true;
  try {
    // Every row gets a sync identity first, so the diff below always
    // carries syncIds (including legacy rows and rows created by code
    // paths that never set one explicitly).
    ensureSyncFieldsForAllRows();
    const beforeRows = takeSnapshotRows();
    const beforeDiff = lastSavedRows ? diffRows(lastSavedRows, beforeRows) : null;
    const stampAt = isoNow();
    if (beforeDiff) {
      // Stamp exactly the rows this write changes, so the outbox and the
      // remote copy carry a fresh updatedAt for those rows only. Rows
      // untouched by this write keep their old timestamp. Rows applied
      // from a pull (outbox suppressed) are never re-stamped: their
      // remote updatedAt is the truth, and stamping them "now" would make
      // a stale copy look newer than a later remote edit.
      if (outboxSuppressCount === 0) {
        for (const upsert of beforeDiff.upserts) {
          if (upsert.collection === 'syncOutbox') continue;
          const live = findLiveRow(upsert.collection, upsert.rowId);
          if (live) {
            live['updatedAt'] = stampAt;
            live['syncDeviceId'] = getSyncDeviceId();
          }
        }
        recordOutboxEntries(beforeDiff, stampAt);
      }
    } else if (outboxSuppressCount === 0) {
      // First persist after load with no saved baseline: everything in
      // the store is pending upload, so record it exactly once.
      recordOutboxEntries(diffRows({ meta: [], rows: [] }, beforeRows), stampAt);
    }
    // Rows are serialised strings, detached from the live store, so the
    // queued write cannot observe later mutations.
    const rows = takeSnapshotRows();
    const diff = lastSavedRows ? diffRows(lastSavedRows, rows) : null;
    // Keep the queue recoverable for later writes, but do not erase the current
    // write's failure. Callers that need durability must await flushDatabaseWrites().
    persistQueue = persistQueue
      .catch(() => undefined)
      .then(async () => {
        if (diff && persistenceBackend.saveDiff) {
          await persistenceBackend.saveDiff(diff);
        } else {
          await persistenceBackend.saveSnapshot(rowsToSnapshot(rows));
        }
        lastSavedRows = rows;
      });
    // Prevent an unhandled-rejection warning for legacy synchronous callers.
    // The original promise remains rejected and is observable via flushDatabaseWrites().
    void persistQueue.catch(() => undefined);
  } finally {
    persistInProgress = false;
  }
}

/** Resolve only after all writes queued so far have reached device storage. */
export async function flushDatabaseWrites(): Promise<void> {
  await persistQueue;
}

// ═══════════════════════════════════════════════════════════
// CURRENT ACTOR (SESSION) & PERMISSION ENFORCEMENT
// ═══════════════════════════════════════════════════════════
//
// The session state lives here, in the same module as the data it guards,
// so services never import the session wrapper (services/session.ts is only
// a thin public API over these functions). `services/session.ts` resolves a
// cloud login to a local User and binds it with setCurrentActorId().
//
// Actor resolution rule (documented, and relied on by the tests):
//  - A function argument `actor` of type User  -> that user is checked.
//  - `actor` explicitly null                    -> denied (a cloud login with
//    no matching local record, or an explicitly actor-less call).
//  - `actor` omitted (undefined)               -> the session actor is used:
//      * session bound to a User -> that user is checked;
//      * session bound to null   -> denied (cloud login, no local record);
//      * session never bound     -> legacy local mode: allowed. The app
//        without a Supabase login is single-user and relies on the device
//        PIN; existing call sites that pass no actor keep working.
//  - An inactive actor is denied everything, even with an explicit override.

export const PERMISSION_DENIED_MESSAGE = 'ليس لديك صلاحية تنفيذ هذه العملية';

let currentActorId: number | null = null;
let currentActorBound = false;

/** Bind the session to a local user id, or to null for a cloud login with no local record. Marks the session as bound. */
export function setCurrentActorId(id: number | null): void {
  currentActorId = id;
  currentActorBound = true;
}

export function getCurrentActorId(): number | null {
  return currentActorId;
}

/** True once a login (or an explicit test actor) has bound the session. */
export function isCurrentActorBound(): boolean {
  return currentActorBound;
}

/** Unbind the session entirely (logout / legacy local mode). */
export function clearCurrentActorId(): void {
  currentActorId = null;
  currentActorBound = false;
}

/** The bound local user, or null when the session is bound to no local record or is unbound. */
export function getCurrentActor(): User | null {
  if (currentActorId === null) return null;
  return store.users.find(u => u.id === currentActorId) ?? null;
}

type ResolvedActor = User | null | 'legacy';

function resolveActor(actor?: User | null): ResolvedActor {
  if (actor !== undefined) return actor;
  if (!currentActorBound) return 'legacy';
  return getCurrentActor();
}

/**
 * Check `permissionId` for the resolved actor. Returns null when allowed,
 * otherwise logs a PERMISSION_DENIED audit entry (before any mutation) and
 * returns the denial message. Callers return it as `{success:false, error}`
 * or throw it, depending on their return type.
 */
function checkPermission(actor: User | null | undefined, permissionId: string, entity: string): string | null {
  const resolved = resolveActor(actor);
  if (resolved === 'legacy') return null;
  const allowed = !!resolved && resolved.active
    && isPermissionAllowed(resolved.role, permissionId, resolved.permissions);
  if (allowed) return null;
  addAuditLog({
    action: 'PERMISSION_DENIED', entity,
    entity_id: resolved?.id ?? null,
    user_id: resolved?.id ?? null,
    user_name: resolved?.username ?? null,
    reason: permissionId,
  });
  return PERMISSION_DENIED_MESSAGE;
}

let lastCorruptSnapshotKey: string | null = null;

/** Key of the most recent corrupt snapshot preserved in storage, if any. */
export function getLastCorruptSnapshotKey(): string | null {
  return lastCorruptSnapshotKey;
}

/** A snapshot as read back from storage: same shape as StoredSnapshot,
 * but with the store untyped, so both the typed in-memory store and a
 * parsed JSON snapshot can be applied through this one function. */
type LooseSnapshot = {
  store?: Record<string, unknown>;
  ids?: Record<string, number>;
  invoiceCounter?: number;
};

function applySnapshot(saved: LooseSnapshot): void {
  if (saved.store) {
    Object.keys(store).forEach((key) => {
      const value = saved.store?.[key];
      if (value !== undefined) (store as Record<string, unknown>)[key] = value;
    });
  }
  if (saved.ids) Object.assign(ids, saved.ids);
  if (typeof saved.invoiceCounter === 'number') invoiceCounter = saved.invoiceCounter;
  // A stored counter must never fall behind the rows it already issued:
  // a stale meta (e.g. a write that reached disk after a newer one, or a
  // snapshot whose counters predate its rows) must not reuse an id or an
  // invoice number. Only raises counters, never lowers them.
  for (const [collection, counterKey] of Object.entries({
    ...IDS_KEY_BY_COLLECTION,
    users: 'users',
    syncOutbox: 'syncOutbox',
  })) {
    const list = (store as Record<string, unknown>)[collection];
    if (!Array.isArray(list)) continue;
    let maxId = 0;
    for (const row of list as Array<Record<string, unknown>>) {
      const value = row?.['id'];
      if (typeof value === 'number' && Number.isFinite(value)) maxId = Math.max(maxId, value);
    }
    const current = (ids as Record<string, number>)[counterKey];
    if (typeof current === 'number') (ids as Record<string, number>)[counterKey] = Math.max(current, maxId + 1);
  }
  invoiceCounter = Math.max(invoiceCounter, maxInvoiceNumberFromSales());
  // Backfill sync identity on legacy rows (loaded before sync existed, or
  // restored from an old backup): they get a syncId now and the next
  // persist records them in the outbox, so they upload on the first sync.
  // Rows that already carry a syncId are untouched.
  for (const name of COLLECTION_NAMES as readonly string[]) {
    if (name === 'syncOutbox') continue;
    const list = (store as Record<string, unknown>)[name];
    if (!Array.isArray(list)) continue;
    for (const row of list as Array<Record<string, unknown>>) ensureSyncFields(row);
  }
}

/** Preserve a corrupt legacy AsyncStorage snapshot under a unique
 * timestamped key (never overwritten), as introduced in PR #35. */
async function quarantineLegacySnapshot(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const corruptKey = `${STORE_KEY}/corrupt-${Date.now()}`;
  lastCorruptSnapshotKey = corruptKey;
  try {
    await AsyncStorage.setItem(corruptKey, raw);
  } catch {
    // Preserving the corrupt snapshot is best-effort; the app must
    // still open with defaults even if storage is unavailable.
  }
}

/**
 * One-time migration of the legacy AsyncStorage snapshot into the
 * current backend (SQLite on native devices). The legacy copy is
 * deliberately kept in AsyncStorage as a rollback. Returns true only
 * when a snapshot was actually migrated. Exported for tests and for
 * the system-tools screen; hydrateStore calls it automatically when
 * the backend is empty.
 */
export async function migrateFromAsyncStorageIfNeeded(): Promise<boolean> {
  // The AsyncStorage backend already reads the legacy snapshot itself.
  if (persistenceBackend.name === 'async-storage') return false;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as LooseSnapshot;
    applySnapshot(saved);
    const rows = takeSnapshotRows();
    await persistenceBackend.saveSnapshot(rowsToSnapshot(rows));
    lastSavedRows = rows;
    migrationStatus.migratedFromAsyncStorage = true;
    // Record the one-time migration in backend meta (best-effort).
    try {
      if (persistenceBackend.saveDiff) {
        await persistenceBackend.saveDiff({
          upserts: [],
          deletes: [],
          metaUpserts: [['migrated_from_asyncstorage', '1']],
          metaDeletes: [],
        });
      }
    } catch {
      // The flag is advisory; the data itself was already migrated.
    }
    return true;
  } catch {
    // A corrupt legacy snapshot must not prevent the app from opening.
    await quarantineLegacySnapshot();
    return false;
  }
}

async function hydrateStore(): Promise<void> {
  let loaded: StoredSnapshot | null = null;
  try {
    loaded = await persistenceBackend.loadSnapshot();
  } catch {
    if (persistenceBackend.name === 'async-storage') {
      // The legacy snapshot itself is corrupt: quarantine it (PR #35).
      await quarantineLegacySnapshot();
    } else {
      // The SQLite database could not be opened: fall back to the legacy
      // AsyncStorage snapshot rather than starting empty.
      persistenceBackend = new AsyncStorageAdapter();
      try {
        loaded = await persistenceBackend.loadSnapshot();
      } catch {
        await quarantineLegacySnapshot();
      }
    }
  }
  if (loaded) {
    applySnapshot(loaded);
    lastSavedRows = snapshotToRows(loaded);
    try {
      migrationStatus.migratedFromAsyncStorage =
        (await persistenceBackend.getMeta?.('migrated_from_asyncstorage')) === '1';
    } catch {
      // The flag is advisory; the data itself loaded fine.
    }
  } else if (persistenceBackend.name !== 'async-storage') {
    await migrateFromAsyncStorageIfNeeded();
  }
  // Migrate the former built-in Saudi currency default to the requested Yemeni rial.
  // Preserve any non-default currency explicitly chosen by the pharmacy.
  if ((store.settings.currency === 'ريال سعودي' || store.settings.currency === 'ر.س') && store.settings.currency_symbol === 'ر.س') {
    store.settings.currency = 'ريال يمني';
    store.settings.currency_symbol = 'ر.ي';
    persistStore();
  }
}

function simpleHash(password: string): string {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = ((h << 5) - h + password.charCodeAt(i)) | 0;
  }
  return `ph_${Math.abs(h).toString(16)}`;
}

function nextInvoice(): string {
  return `INV-${String(++invoiceCounter).padStart(6, '0')}`;
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

function initDefaults() {
  if (setupDone) return;
  setupDone = true;

  // Default settings
  const defaultSettings: Record<string, string> = {
    pharmacy_name: '',
    owner_name: '',
    currency: 'ريال يمني',
    currency_symbol: 'ر.ي',
    theme: 'light',
    pin_enabled: 'false',
    pin_code: '',
    language: 'ar',
    dead_stock_days: '90',
    tax_rate: '0',
    receipt_size: 'A5',
    setup_done: 'false',
  };
  Object.entries(defaultSettings).forEach(([k, v]) => {
    if (!(k in store.settings)) store.settings[k] = v;
  });
}

initDefaults();
export const databaseReady: Promise<void> = hydrateStore();

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

export function getSetting(key: string): string | null {
  return store.settings[key] ?? null;
}

export function setSetting(key: string, value: string): void {
  store.settings[key] = value;
  persistStore();
}

export function getAllSettings(): Record<string, string> {
  return { ...store.settings };
}

export function isSetupDone(): boolean {
  return store.settings['setup_done'] === 'true';
}

export function completeSetup(data: {
  pharmacy_name: string;
  owner_name: string;
  currency: string;
  currency_symbol: string;
  admin_username: string;
  admin_password: string;
  opening_cash: number;
}): void {
  setSetting('pharmacy_name', data.pharmacy_name);
  setSetting('owner_name', data.owner_name);
  setSetting('currency', data.currency);
  setSetting('currency_symbol', data.currency_symbol);
  setSetting('setup_done', 'true');

  // Create admin user
  const user: User = {
    id: ids.users++,
    username: data.admin_username,
    password_hash: simpleHash(data.admin_password),
    full_name: data.owner_name || 'المدير',
    role: 'ADMIN',
    phone: null,
    active: true,
    last_login: now(),
    created_at: now(),
  };
  store.users.push(user);

  // Opening cash
  if (data.opening_cash > 0) {
    store.cashTransactions.push({
      id: ids.cashTx++,
      type: 'OPENING',
      amount: data.opening_cash,
      reference_type: null,
      reference_id: null,
      shift_id: null,
      note: 'رصيد افتتاحي',
      user_id: user.id,
      date: today(),
      created_at: now(),
    });
  }

  addAuditLog({ action: 'SETUP_COMPLETE', entity: 'pharmacy', entity_id: 1,
    after_data: JSON.stringify({ pharmacy_name: data.pharmacy_name }) });
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export function authenticateUser(username: string, password: string): AuthResult {
  // Demo bypass in preview
  if (!isSetupDone()) {
    return { success: false, error: 'يجب إكمال الإعداد الأولي أولاً' };
  }
  const user = store.users.find(u => u.username === username && u.active);
  if (!user) return { success: false, error: 'المستخدم غير موجود' };
  if (user.password_hash !== simpleHash(password)) {
    return { success: false, error: 'كلمة المرور غير صحيحة' };
  }
  user.last_login = now();
  addAuditLog({ action: 'LOGIN', entity: 'user', entity_id: user.id, user_id: user.id });
  return { success: true, user };
}

export function getUsers(): User[] {
  return [...store.users];
}

export function addUser(data: {
  username: string; password: string; full_name: string; role: UserRole; phone?: string;
  job_title?: string | null; permissions?: EmployeePermissionMap;
}, actor?: User | null): User {
  const denied = checkPermission(actor, 'system.users', 'user');
  if (denied) throw new Error(denied);
  const user: User = {
    id: ids.users++, username: data.username, password_hash: simpleHash(data.password),
    full_name: data.full_name, role: data.role, phone: data.phone ?? null,
    job_title: data.job_title ?? null,
    ...(data.permissions ? { permissions: { ...data.permissions } } : {}),
    active: true, last_login: null, created_at: now(),
  };
  store.users.push(user);
  addAuditLog({ action: 'USER_CREATE', entity: 'user', entity_id: user.id,
    after_data: JSON.stringify({ username: user.username, role: user.role, job_title: user.job_title }) });
  persistStore();
  return user;
}

export function updateUser(id: number, data: Partial<Pick<User, 'full_name' | 'role' | 'phone' | 'active' | 'permissions' | 'job_title'> & { password: string }>, actor?: User | null): void {
  const denied = checkPermission(actor, 'system.users', 'user');
  if (denied) throw new Error(denied);
  const user = store.users.find(u => u.id === id);
  if (!user) return;
  if (data.full_name !== undefined) user.full_name = data.full_name;
  if (data.role !== undefined) user.role = data.role;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.active !== undefined) user.active = data.active;
  if (data.job_title !== undefined) user.job_title = data.job_title;
  if (data.permissions !== undefined) user.permissions = { ...data.permissions };
  if (data.password) user.password_hash = simpleHash(data.password);
  addAuditLog({ action: 'USER_UPDATE', entity: 'user', entity_id: id,
    after_data: JSON.stringify({ username: user.username, active: user.active, role: user.role, job_title: user.job_title, permissions: user.permissions }) });
  persistStore();
}

// ═══════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════

export function getProducts(opts?: {
  search?: string; category?: string; activeOnly?: boolean;
}): Product[] {
  let result = [...store.products];
  if (opts?.activeOnly !== false) result = result.filter(p => p.active);
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    result = result.filter(p =>
      p.trade_name.toLowerCase().includes(q) ||
      (p.generic_name || '').toLowerCase().includes(q) ||
      (p.active_ingredient || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q) ||
      (p.internal_code || '').includes(q) ||
      (p.manufacturer || '').toLowerCase().includes(q)
    );
  }
  if (opts?.category) result = result.filter(p => p.category === opts.category);
  return result.sort((a, b) => a.trade_name.localeCompare(b.trade_name, 'ar'));
}

export function getProduct(id: number): Product | null {
  return store.products.find(p => p.id === id) ?? null;
}

export function getProductByBarcode(barcode: string): Product | null {
  return store.products.find(p => p.barcode === barcode) ?? null;
}

export function getProductByCatalogSourceId(sourceId: string): Product | null {
  return store.products.find(p => p.catalog_source_id === sourceId) ?? null;
}

export function addProduct(data: Omit<Product, 'id' | 'created_at' | 'updated_at'>, actor?: User | null): Product {
  const denied = checkPermission(actor, 'inventory.edit', 'product');
  if (denied) throw new Error(denied);
  const product: Product = {
    ...data,
    id: ids.products++,
    created_at: now(),
    updated_at: now(),
  };
  store.products.push(product);
  addAuditLog({ action: 'PRODUCT_CREATE', entity: 'product', entity_id: product.id,
    after_data: JSON.stringify({ name: product.trade_name }) });
  return product;
}

export function updateProduct(id: number, data: Partial<Product>, actor?: User | null): void {
  const denied = checkPermission(actor, 'inventory.edit', 'product');
  if (denied) throw new Error(denied);
  const p = store.products.find(p => p.id === id);
  if (p) {
    const before = JSON.stringify(p);
    Object.assign(p, { ...data, updated_at: now() });
    addAuditLog({ action: 'PRODUCT_UPDATE', entity: 'product', entity_id: id,
      before_data: before, after_data: JSON.stringify(p) });
  }
}

export function getProductUnits(product_id: number): ProductUnit[] {
  return store.productUnits.filter(u => u.product_id === product_id);
}

export function getProductUnit(product_id: number, unit_name: string): ProductUnit | null {
  const product = getProduct(product_id);
  if (!product) return null;
  const configured = store.productUnits.find(u => u.product_id === product_id && u.unit_name === unit_name);
  if (configured) return configured.conversion_factor > 0 ? configured : null;
  return unit_name === product.inventory_unit
    ? { id: -1, product_id, unit_name, conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
        sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true }
    : null;
}

export function getUnitConversionFactor(product_id: number, unit_name: string): number | null {
  return getProductUnit(product_id, unit_name)?.conversion_factor ?? null;
}

export function getUnitPrice(product_id: number, unit_name: string, kind: 'sale' | 'purchase'): number | null {
  const product = getProduct(product_id);
  const unit = getProductUnit(product_id, unit_name);
  if (!product || !unit) return null;
  const basePrice = kind === 'sale' ? product.selling_price : product.default_purchase_price;
  const override = kind === 'sale' ? unit.sale_price : unit.purchase_price;
  return priceForUnit(basePrice, unit.conversion_factor, unit_name === product.inventory_unit ? basePrice : override);
}

export function hasProductStockHistory(product_id: number): boolean {
  return store.batches.some(batch => batch.product_id === product_id) ||
    store.stockMovements.some(movement => movement.product_id === product_id) ||
    store.saleItems.some(item => item.product_id === product_id) ||
    store.purchaseItems.some(item => item.product_id === product_id);
}

export interface FreeSampleReceiptInput {
  product_id: number;
  unit: string;
  quantity: number;
  unit_cost: number;
  batch_number: string;
  expiry_date: string;
  supplier_id?: number | null;
  user_id?: number | null;
  reason: string;
}

export type FreeSampleReceiptResult =
  | { success: true; batch: Batch; base_quantity: number }
  | { success: false; error: string };

/**
 * Receives supplier samples as inventory only: it never creates a purchase,
 * supplier payable, cash transaction, or sales revenue.
 */
export function createFreeSampleReceipt(data: FreeSampleReceiptInput, actor?: User | null): FreeSampleReceiptResult {
  const denied = checkPermission(actor, 'inventory.samples', 'batch');
  if (denied) return { success: false, error: denied };
  const product = getProduct(data.product_id);
  if (!product) return { success: false, error: 'الدواء غير موجود' };
  const factor = getUnitConversionFactor(data.product_id, data.unit);
  if (factor === null) return { success: false, error: `الوحدة ${data.unit} غير معرفة لهذا الدواء` };
  if (!isValidUnitQuantity(data.quantity, data.unit) || data.quantity <= 0) {
    return { success: false, error: 'أدخل كمية عينة صحيحة أكبر من صفر' };
  }
  if (!Number.isFinite(data.unit_cost) || data.unit_cost < 0) {
    return { success: false, error: 'أدخل تكلفة تقديرية صحيحة للعينة' };
  }
  const batchNumber = data.batch_number?.trim();
  if (!batchNumber) return { success: false, error: 'أدخل رقم التشغيلة' };
  if (!isValidIsoDate(data.expiry_date) || data.expiry_date < today()) {
    return { success: false, error: 'تاريخ انتهاء العينة غير صحيح أو منقضٍ' };
  }
  if (!data.reason?.trim()) return { success: false, error: 'أدخل سبب استلام العينة' };
  if (data.supplier_id != null && !store.suppliers.some(s => s.id === data.supplier_id)) {
    return { success: false, error: 'المورد المحدد غير موجود' };
  }

  const baseQuantity = toBaseQuantity(data.quantity, factor);
  return commitReturnAtomically(() => {
    let batch = store.batches.find(b =>
      b.product_id === product.id && b.batch_number === batchNumber &&
      b.expiry_date === data.expiry_date && b.status === 'ACTIVE'
    );
    if (batch) {
      const beforeQuantity = batch.quantity;
      batch.purchase_price = beforeQuantity + baseQuantity > 0
        ? ((batch.purchase_price * beforeQuantity) + ((data.unit_cost / factor) * baseQuantity)) / (beforeQuantity + baseQuantity)
        : data.unit_cost / factor;
      batch.quantity += baseQuantity;
      batch.initial_quantity += baseQuantity;
    } else {
      batch = {
        id: ids.batches++, product_id: product.id, batch_number: batchNumber,
        expiry_date: data.expiry_date, received_date: today(),
        purchase_price: data.unit_cost / factor, selling_price: product.selling_price,
        quantity: baseQuantity, initial_quantity: baseQuantity,
        supplier_id: data.supplier_id ?? null, purchase_id: null, status: 'ACTIVE',
        notes: 'عينة مجانية من المورد', is_opening: false, created_at: now(),
      };
      store.batches.push(batch);
    }
    store.stockMovements.push({
      id: ids.stockMovements++, product_id: product.id, batch_id: batch.id,
      type: 'FREE_SAMPLE_IN', quantity: baseQuantity, unit: product.inventory_unit,
      quantity_in_inventory_unit: baseQuantity, reference_type: 'free_sample',
      reference_id: batch.id,
      note: `عينة مجانية؛ الكمية: ${data.quantity} ${data.unit}؛ السبب: ${data.reason.trim()}`,
      user_id: data.user_id ?? null, created_at: now(),
    });
    addAuditLog({
      action: 'FREE_SAMPLE_RECEIVED', entity: 'batch', entity_id: batch.id,
      user_id: data.user_id ?? null,
      after_data: JSON.stringify({
        product_id: product.id, batch_number: batchNumber, expiry_date: data.expiry_date,
        supplier_id: data.supplier_id ?? null, quantity: data.quantity, unit: data.unit,
        base_quantity: baseQuantity, estimated_unit_cost: data.unit_cost,
        reason: data.reason.trim(), supplier_balance_changed: false,
      }),
    });
    return { success: true as const, batch, base_quantity: baseQuantity };
  });
}

export interface OpeningStockInput {
  product_id: number;
  unit: string;
  quantity: number;
  unit_cost: number;
  batch_number?: string;
  expiry_date?: string;
  user_id?: number | null;
}

export type OpeningStockResult = { success: true; batch: Batch; base_quantity: number } | { success: false; error: string };

/** Creates a physical opening batch without creating a purchase, payable, or cash movement. */
export function createOpeningStock(data: OpeningStockInput, actor?: User | null): OpeningStockResult {
  const denied = checkPermission(actor, 'inventory.opening', 'batch');
  if (denied) return { success: false, error: denied };
  const product = getProduct(data.product_id);
  if (!product) return { success: false, error: 'الدواء غير موجود' };
  const factor = getUnitConversionFactor(data.product_id, data.unit);
  if (factor === null) return { success: false, error: `الوحدة ${data.unit} غير معرفة لهذا الدواء` };
  if (!isValidUnitQuantity(data.quantity, data.unit)) return { success: false, error: 'أدخل كمية افتتاحية صحيحة للوحدة المختارة' };
  if (!Number.isFinite(data.unit_cost) || data.unit_cost < 0) return { success: false, error: 'أدخل تكلفة افتتاحية صحيحة' };
  const baseQuantity = toBaseQuantity(data.quantity, factor);
  const expiry = data.expiry_date?.trim() || '';
  if (expiry && !isValidIsoDate(expiry)) return { success: false, error: 'تاريخ انتهاء الرصيد الافتتاحي غير صحيح' };
  const batch: Batch = {
    id: ids.batches++, product_id: product.id,
    batch_number: data.batch_number?.trim() || `OPEN-${product.id}-${Date.now()}-${ids.batches}`,
    expiry_date: expiry, received_date: today(), purchase_price: data.unit_cost / factor,
    selling_price: product.selling_price, quantity: baseQuantity, initial_quantity: baseQuantity,
    supplier_id: null, purchase_id: null, status: expiry && expiry <= today() ? 'EXPIRED' : 'ACTIVE',
    notes: 'الرصيد الافتتاحي', is_opening: true, created_at: now(),
  };
  store.batches.push(batch);
  store.stockMovements.push({
    id: ids.stockMovements++, product_id: product.id, batch_id: batch.id,
    type: 'OPENING', quantity: baseQuantity, unit: product.inventory_unit,
    quantity_in_inventory_unit: baseQuantity, reference_type: 'opening_stock',
    reference_id: batch.id, note: `الرصيد الافتتاحي: ${data.quantity} ${data.unit}`,
    user_id: data.user_id ?? null, created_at: now(),
  });
  addAuditLog({ action: 'OPENING_STOCK_CREATE', entity: 'batch', entity_id: batch.id,
    user_id: data.user_id, after_data: JSON.stringify({ product_id: product.id, unit: data.unit,
      quantity: data.quantity, conversion_factor: factor, base_quantity: baseQuantity, unit_cost: data.unit_cost, batch_number: batch.batch_number }) });
  persistStore();
  return { success: true, batch, base_quantity: baseQuantity };
}

export function canEditOpeningStock(batch_id: number): boolean {
  const batch = store.batches.find(entry => entry.id === batch_id && entry.is_opening);
  if (!batch) return false;
  const hasOtherMovement = store.stockMovements.some(movement => movement.product_id === batch.product_id &&
    !(movement.batch_id === batch.id && movement.type === 'OPENING'));
  const hasSalesOrPurchases = store.saleItems.some(item => item.product_id === batch.product_id) ||
    store.purchaseItems.some(item => item.product_id === batch.product_id);
  return !hasOtherMovement && !hasSalesOrPurchases;
}

export function updateOpeningStock(data: {
  batch_id: number; base_quantity: number; unit_cost_per_base: number;
  batch_number?: string; expiry_date?: string;
}, actor?: User | null): { success: true; batch: Batch } | { success: false; error: string } {
  const denied = checkPermission(actor, 'inventory.opening', 'batch');
  if (denied) return { success: false, error: denied };
  const batch = store.batches.find(entry => entry.id === data.batch_id && entry.is_opening);
  const product = batch ? getProduct(batch.product_id) : null;
  if (!batch || !product) return { success: false, error: 'دفعة الرصيد الافتتاحي غير موجودة' };
  if (!canEditOpeningStock(batch.id)) return { success: false, error: 'حدثت معاملات لاحقة؛ استخدم تسوية مخزون صريحة بدل تغيير الرصيد الافتتاحي' };
  if (!isValidUnitQuantity(data.base_quantity, product.inventory_unit, true) || !Number.isFinite(data.unit_cost_per_base) || data.unit_cost_per_base < 0) {
    return { success: false, error: 'تحقق من الكمية والتكلفة بوحدة المخزون الأساسية' };
  }
  const expiry = data.expiry_date?.trim() || '';
  if (expiry && !isValidIsoDate(expiry)) return { success: false, error: 'تاريخ انتهاء الرصيد الافتتاحي غير صحيح' };
  const before = { ...batch };
  batch.batch_number = data.batch_number?.trim() || batch.batch_number;
  batch.expiry_date = expiry;
  batch.purchase_price = data.unit_cost_per_base;
  batch.quantity = data.base_quantity;
  batch.initial_quantity = data.base_quantity;
  batch.status = data.base_quantity <= 0 ? 'DEPLETED' : expiry && expiry <= today() ? 'EXPIRED' : 'ACTIVE';
  const movement = store.stockMovements.find(entry => entry.batch_id === batch.id && entry.type === 'OPENING');
  if (movement) {
    movement.quantity = data.base_quantity;
    movement.quantity_in_inventory_unit = data.base_quantity;
    movement.note = `تعديل الرصيد الافتتاحي: ${data.base_quantity} ${product.inventory_unit}`;
  }
  addAuditLog({ action: 'OPENING_STOCK_UPDATE', entity: 'batch', entity_id: batch.id,
    before_data: JSON.stringify(before), after_data: JSON.stringify(batch) });
  persistStore();
  return { success: true, batch };
}

export function addProductUnit(data: Omit<ProductUnit, 'id'>): ProductUnit {
  const unit: ProductUnit = { ...data, id: ids.productUnits++ };
  store.productUnits.push(unit);
  persistStore();
  return unit;
}

export function configureProductPurchaseUnit(
  product_id: number,
  unit_name: string,
  conversion_factor: number,
  base_unit_name: string,
  actor?: User | null,
): ProductUnit | null {
  const denied = checkPermission(actor, 'inventory.edit', 'product');
  if (denied) throw new Error(denied);
  const product = getProduct(product_id);
  const name = unit_name.trim();
  const base = base_unit_name.trim();
  if (!product || !name || !base || product.inventory_unit !== base) return null;
  if (name === base) conversion_factor = 1;
  else if (!Number.isFinite(conversion_factor) || conversion_factor <= 1 || !Number.isInteger(conversion_factor)) return null;

  const productUnits = store.productUnits.filter(unit => unit.product_id === product_id);
  let target = productUnits.find(unit => unit.unit_name === name);
  const hasDependentUnits = target !== undefined && productUnits.some(unit => unit.parent_unit_name === name);
  if (target && name !== base && hasDependentUnits && target.conversion_factor !== conversion_factor) {
    // Do not change a conversion factor that other configured units depend on.
    return null;
  }

  const before = productUnits.map(unit => ({ ...unit }));
  if (!target) {
    target = {
      id: ids.productUnits++,
      product_id,
      unit_name: name,
      conversion_factor,
      parent_unit_name: name === base ? null : base,
      quantity_per_parent: conversion_factor,
      sale_price: null,
      purchase_price: null,
      is_purchase_default: true,
      is_sale_default: name === base,
    };
    store.productUnits.push(target);
  } else {
    target.conversion_factor = conversion_factor;
    if (name === base || !hasDependentUnits) {
      target.parent_unit_name = name === base ? null : base;
      target.quantity_per_parent = conversion_factor;
    }
  }
  for (const unit of store.productUnits) {
    if (unit.product_id === product_id) unit.is_purchase_default = unit.unit_name === name;
  }
  addAuditLog({
    action: 'PRODUCT_PURCHASE_UNIT_CONFIGURE',
    entity: 'product',
    entity_id: product_id,
    before_data: JSON.stringify(before),
    after_data: JSON.stringify(store.productUnits.filter(unit => unit.product_id === product_id)),
  });
  persistStore();
  return target;
}

export function replaceProductUnits(product_id: number, units: Omit<ProductUnit, 'id' | 'product_id'>[], actor?: User | null): ProductUnit[] {
  const denied = checkPermission(actor, 'inventory.edit', 'product');
  if (denied) throw new Error(denied);
  store.productUnits = store.productUnits.filter(u => u.product_id !== product_id);
  const saved = units.map(unit => addProductUnit({ ...unit, product_id }));
  addAuditLog({ action: 'PRODUCT_UNITS_UPDATE', entity: 'product', entity_id: product_id,
    after_data: JSON.stringify(saved) });
  persistStore();
  return saved;
}

export function getOpeningBalance(): number {
  return store.cashTransactions
    .filter(t => t.type === 'OPENING')
    .reduce((sum, t) => sum + t.amount, 0);
}

export function addOpeningBalance(amount: number, note = 'رصيد افتتاحي إضافي', user_id?: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  store.cashTransactions.push({
    id: ids.cashTx++, type: 'OPENING', amount, reference_type: null, reference_id: null,
    cashbox_id: 'daily',
    shift_id: null, note, user_id: user_id ?? null, date: today(), created_at: now(),
  });
  addAuditLog({ action: 'OPENING_BALANCE_ADD', entity: 'cashbox', entity_id: null,
    after_data: JSON.stringify({ amount, note }) });
  persistStore();
  return true;
}

export function getProductCategories(): string[] {
  const cats = new Set(store.products.map(p => p.category).filter(Boolean) as string[]);
  return Array.from(cats).sort();
}

// ─── Product Alternatives ─────────────────────────────────
export function getProductAlternatives(product_id: number): Product[] {
  const p = getProduct(product_id);
  if (!p || !p.active_ingredient) return [];
  const q = (p.active_ingredient || '').toLowerCase();
  return store.products.filter(alt =>
    alt.id !== product_id && alt.active &&
    (alt.active_ingredient || '').toLowerCase() === q
  );
}

// ═══════════════════════════════════════════════════════════
// BATCHES & INVENTORY
// ═══════════════════════════════════════════════════════════

export function getBatches(product_id: number, activeOnly = true): Batch[] {
  let result = store.batches.filter(b => b.product_id === product_id);
  if (activeOnly) result = result.filter(b => b.status === 'ACTIVE' && b.quantity > 0);
  // FEFO order
  return result.sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));
}

export function getAllBatches(opts?: { status?: BatchStatus }): Batch[] {
  let result = [...store.batches];
  if (opts?.status) result = result.filter(b => b.status === opts.status);
  return result;
}

export function getBatch(id: number): Batch | null {
  return store.batches.find(b => b.id === id) ?? null;
}

export function getProductStock(product_id: number): number {
  return store.batches
    .filter(b => b.product_id === product_id && b.status === 'ACTIVE')
    .reduce((s, b) => s + b.quantity, 0);
}

export function getInventoryList(opts?: {
  search?: string; status?: string; category?: string;
}): InventoryItem[] {
  const products = getProducts({ search: opts?.search, category: opts?.category });
  const todayStr = today();

  return products.map(p => {
    const batches = getBatches(p.id, false).filter(b => b.status === 'ACTIVE');
    const totalQty = batches.reduce((s, b) => s + b.quantity, 0);
    const activeBatches = batches.filter(b => b.quantity > 0);

    // Find nearest expiry
    let nearestExpiry: string | null = null;
    let daysToNearest: number | null = null;
    const expiringBatches = activeBatches.filter(b => !!b.expiry_date);
    if (expiringBatches.length > 0) {
      const sorted = [...expiringBatches].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
      nearestExpiry = sorted[0].expiry_date;
      const diff = new Date(nearestExpiry).getTime() - new Date(todayStr).getTime();
      daysToNearest = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    let status: InventoryItem['status'] = 'ok';
    if (totalQty === 0) status = 'out';
    else if (totalQty <= p.minimum_stock) status = 'low';
    if (daysToNearest !== null) {
      if (daysToNearest <= 0) status = 'expired';
      else if (daysToNearest <= 90) status = 'expiring';
    }

    return {
      product_id: p.id,
      trade_name: p.trade_name,
      generic_name: p.generic_name,
      barcode: p.barcode,
      category: p.category,
      inventory_unit: p.inventory_unit,
      selling_price: p.selling_price,
      total_quantity: totalQty,
      minimum_stock: p.minimum_stock,
      reorder_level: p.reorder_level,
      status,
      nearest_expiry: nearestExpiry,
      days_to_nearest_expiry: daysToNearest,
      batches: activeBatches,
    };
  }).filter(item => {
    if (!opts?.status || opts.status === 'all') return true;
    if (opts.status === 'ok') return item.status === 'ok';
    if (opts.status === 'low') return item.status === 'low';
    if (opts.status === 'out') return item.status === 'out';
    if (opts.status === 'expiring') return item.status === 'expiring';
    if (opts.status === 'expired') return item.status === 'expired';
    return true;
  });
}

// ─── Expiry Radar ─────────────────────────────────────────
export function getExpiryRadar(): ExpiryRadarItem[] {
  const todayStr = today();
  const items: ExpiryRadarItem[] = [];

  store.batches.forEach(b => {
    if (b.status !== 'ACTIVE' || b.quantity <= 0 || !b.expiry_date) return;
    const product = getProduct(b.product_id);
    if (!product) return;
    const diff = new Date(b.expiry_date).getTime() - new Date(todayStr).getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    let group: ExpiryRadarItem['group'] = 'ok';
    if (days <= 0) group = 'expired';
    else if (days <= 30) group = '30';
    else if (days <= 60) group = '60';
    else if (days <= 90) group = '90';

    if (group !== 'ok') {
      items.push({
        product_id: b.product_id,
        product_name: product.trade_name,
        batch_id: b.id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        days_to_expiry: days,
        quantity: b.quantity,
        unit: product.inventory_unit,
        stock_value: b.quantity * b.purchase_price,
        group,
      });
    }
  });

  return items.sort((a, b) => a.days_to_expiry - b.days_to_expiry);
}

// ─── Dead Stock ───────────────────────────────────────────
export function getDeadStock(days = 90): InventoryItem[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recentProducts = new Set(
    store.stockMovements
      .filter(m => m.created_at >= cutoffStr && m.quantity < 0)
      .map(m => m.product_id)
  );

  return getInventoryList().filter(item =>
    item.total_quantity > 0 && !recentProducts.has(item.product_id)
  );
}

// ─── Reorder Suggestions ─────────────────────────────────
export interface ReorderSuggestion {
  product_id: number;
  trade_name: string;
  current_stock: number;
  minimum_stock: number;
  reorder_level: number;
  inventory_unit: string;
  suggested_quantity: number;
  reason: string;
}

export function getReorderSuggestions(): ReorderSuggestion[] {
  return getInventoryList()
    .filter(item => item.total_quantity <= item.reorder_level)
    .map(item => {
      const suggested = Math.max(item.reorder_level * 2 - item.total_quantity, item.minimum_stock);
      return {
        product_id: item.product_id,
        trade_name: item.trade_name,
        current_stock: item.total_quantity,
        minimum_stock: item.minimum_stock,
        reorder_level: item.reorder_level,
        inventory_unit: item.inventory_unit,
        suggested_quantity: suggested,
        reason: item.total_quantity === 0
          ? 'نفد المخزون'
          : item.total_quantity <= item.minimum_stock
          ? 'أقل من الحد الأدنى'
          : 'أقل من نقطة إعادة الطلب',
      };
    });
}

// ─── ABC Analysis ─────────────────────────────────────────
export interface AbcItem {
  product_id: number;
  trade_name: string;
  total_revenue: number;
  revenue_pct: number;
  cumulative_pct: number;
  abc_class: AbcClass;
}

export function getAbcAnalysis(dateFrom: string, dateTo: string): AbcItem[] {
  const revenueMap: Record<number, number> = {};
  store.saleItems.forEach(si => {
    const sale = store.sales.find(s => s.id === si.sale_id);
    if (!sale || sale.cancelled) return;
    if (sale.date < dateFrom || sale.date > dateTo) return;
    revenueMap[si.product_id] = (revenueMap[si.product_id] || 0) + si.line_total;
  });

  const items = Object.entries(revenueMap)
    .map(([pid, rev]) => {
      const product = getProduct(Number(pid));
      return { product_id: Number(pid), trade_name: product?.trade_name || 'غير محدد', total_revenue: rev };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue);

  const totalRev = items.reduce((s, i) => s + i.total_revenue, 0);
  let cumulative = 0;
  return items.map(item => {
    const pct = totalRev > 0 ? (item.total_revenue / totalRev) * 100 : 0;
    cumulative += pct;
    const abc_class: AbcClass = cumulative <= 70 ? 'A' : cumulative <= 90 ? 'B' : 'C';
    return { ...item, revenue_pct: pct, cumulative_pct: cumulative, abc_class };
  });
}

// ═══════════════════════════════════════════════════════════
// FEFO ALLOCATION
// ═══════════════════════════════════════════════════════════

interface FefoAllocation {
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
}

function allocateFefo(product_id: number, quantityNeeded: number, reserved: Map<number, number> = new Map()): FefoAllocation[] | null {
  // Get active non-expired batches sorted by expiry (FEFO)
  const todayStr = today();
  const batches = store.batches
    .filter(b =>
      b.product_id === product_id &&
      b.status === 'ACTIVE' &&
      b.quantity - (reserved.get(b.id) || 0) > 0 &&
      (!b.expiry_date || b.expiry_date > todayStr)
    )
    .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));

  const available = batches.reduce((s, b) => s + b.quantity - (reserved.get(b.id) || 0), 0);
  if (available < quantityNeeded) return null; // insufficient stock

  const allocations: FefoAllocation[] = [];
  let remaining = quantityNeeded;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity - (reserved.get(batch.id) || 0), remaining);
    allocations.push({
      batch_id: batch.id,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      quantity: take,
      purchase_price: batch.purchase_price,
    });
    remaining -= take;
  }

  return allocations;
}

/** Check whether an additional credit amount would exceed a customer's limit. Returns null when the customer does not exist. A limit of 0 (or less) means no limit. */
export function checkCreditLimit(customer_id: number, additionalAmount: number): { allowed: boolean; balance: number; credit_limit: number; projected: number } | null {
  const customer = store.customers.find(c => c.id === customer_id);
  if (!customer) return null;
  const balance = customer.balance;
  const credit_limit = customer.credit_limit;
  const projected = balance + additionalAmount;
  return { allowed: credit_limit <= 0 || projected <= credit_limit, balance, credit_limit, projected };
}

// ═══════════════════════════════════════════════════════════
// SALES — ATOMIC
// ═══════════════════════════════════════════════════════════

export interface NewSaleItem {
  product_id: number;
  unit: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

export interface NewSale {
  sale_type: SaleType;
  customer_id?: number | null;
  items: NewSaleItem[];
  discount: number;
  amount_paid: number;
  notes?: string;
  user_id?: number | null;
  shift_id?: number | null;
  date?: string;
}

export interface SaleResult {
  success: boolean;
  sale?: Sale;
  error?: string;
}

function salePermissionError(data: NewSale, actor?: User | null): string | null {
  return checkPermission(actor, 'sales.create', 'sale')
    ?? ((data.sale_type === 'credit' || data.sale_type === 'mixed') && data.customer_id
      ? checkPermission(actor, 'customers.credit', 'sale') : null);
}

/** A sale fully validated and resolved, without any mutation. Shared by
 * the legacy in-memory path and the SQL path (Phase 3), so both paths
 * validate, price and allocate identically. */
interface PreparedSaleItem {
  item: NewSaleItem;
  product: Product;
  qty_in_inv_unit: number;
  allocations: FefoAllocation[];
  line_total: number;
  item_cogs: number;
  base_purchase_price: number;
}

interface PreparedSale {
  data: NewSale;
  items: PreparedSaleItem[];
  subtotal: number;
  total: number;
  amount_paid: number;
  change_given: number;
  remaining: number;
  total_cogs: number;
  sale_date: string;
  customer: Customer | null;
  customer_name: string | null;
  customer_balance_after: number | null;
  shift: Shift | null;
}

/** Validate a sale and resolve units + FEFO allocations without mutating
 * anything. Returns the first validation error, if any. */
function prepareSale(data: NewSale): { ok: true; prepared: PreparedSale } | { ok: false; error: string } {
  if (!data.items.length) return { ok: false, error: 'أضف صنفًا واحدًا على الأقل' };
  if (!Number.isFinite(data.discount) || data.discount < 0 || !Number.isFinite(data.amount_paid) || data.amount_paid < 0) {
    return { ok: false, error: 'قيمة الخصم أو المبلغ المدفوع غير صحيحة' };
  }
  // Validate items and resolve units
  const resolvedItems: PreparedSaleItem[] = [];
  const reserved = new Map<number, number>();

  for (const item of data.items) {
    const product = getProduct(item.product_id);
    if (!product) return { ok: false, error: `منتج غير موجود: ${item.product_id}` };
    if (!isValidUnitQuantity(item.quantity, item.unit) || !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
        !Number.isFinite(item.discount) || item.discount < 0 || item.discount > item.quantity * item.unit_price) {
      return { ok: false, error: `تحقق من الكمية والسعر والخصم للصنف ${product.trade_name}` };
    }
    const factor = getUnitConversionFactor(item.product_id, item.unit);
    if (factor === null) return { ok: false, error: `الوحدة ${item.unit} غير معرفة للصنف ${product.trade_name}` };
    const qtyInInvUnit = toBaseQuantity(item.quantity, factor);

    // FEFO allocation
    const allocs = allocateFefo(item.product_id, qtyInInvUnit, reserved);
    if (!allocs) {
      return { ok: false, error: `المخزون غير كافٍ: ${product.trade_name}` };
    }
    allocs.forEach(allocation => reserved.set(allocation.batch_id, (reserved.get(allocation.batch_id) || 0) + allocation.quantity));

    const lineTotal = item.quantity * item.unit_price - item.discount;
    let itemCogs = 0;
    for (const alloc of allocs) {
      itemCogs += alloc.quantity * alloc.purchase_price;
    }
    resolvedItems.push({
      item, product, qty_in_inv_unit: qtyInInvUnit, allocations: allocs,
      line_total: lineTotal, item_cogs: itemCogs,
      base_purchase_price: qtyInInvUnit > 0 ? itemCogs / qtyInInvUnit : 0,
    });
  }

  // Calculate totals
  let subtotal = 0;
  let totalCogs = 0;
  for (const item of resolvedItems) {
    subtotal += item.line_total;
    totalCogs += item.item_cogs;
  }
  if (data.discount > subtotal) return { ok: false, error: 'خصم الفاتورة أكبر من مجموع الأصناف' };
  const total = subtotal - data.discount;
  const amountPaid = Math.min(data.amount_paid, total);
  const remaining = total - amountPaid;
  const changeGiven = data.amount_paid > total ? data.amount_paid - total : 0;

  const saleDate = data.date || today();
  if (!isValidIsoDate(saleDate)) return { ok: false, error: 'تاريخ فاتورة البيع غير صحيح' };
  if (!Number.isFinite(data.amount_paid) || data.amount_paid < 0) return { ok: false, error: 'المبلغ المدفوع غير صحيح' };
  // Credit limit: refuse a credit/mixed sale whose remaining balance would
  // push the customer over their limit. Checked before any mutation.
  if ((data.sale_type === 'credit' || data.sale_type === 'mixed') && data.customer_id) {
    const limitCheck = checkCreditLimit(data.customer_id, remaining);
    if (limitCheck && limitCheck.credit_limit > 0 && !limitCheck.allowed) {
      return { ok: false, error: 'تجاوز حد الائتمان للعميل: الرصيد الحالي + المتبقي من هذه الفاتورة يتجاوز الحد المسموح' };
    }
  }

  const customer = data.customer_id ? (store.customers.find(c => c.id === data.customer_id) ?? null) : null;
  const customerBalanceAfter =
    ((data.sale_type === 'credit' || remaining > 0) && customer) ? customer.balance + remaining : null;
  const shift = data.shift_id ? (store.shifts.find(s => s.id === data.shift_id) ?? null) : null;
  return {
    ok: true,
    prepared: {
      data, items: resolvedItems, subtotal, total, amount_paid: amountPaid,
      change_given: changeGiven, remaining, total_cogs: totalCogs, sale_date: saleDate,
      customer, customer_name: customer?.name ?? null,
      customer_balance_after: customerBalanceAfter, shift,
    },
  };
}

/** The legacy in-memory sale mutation, applied to a prepared sale. Must
 * be called inside commitReturnAtomically() (it relies on the deferred
 * persist + rollback). Its behaviour is unchanged from the pre-Phase-3
 * createSale. */
function executePreparedSaleInMemory(prepared: PreparedSale): SaleResult {
  const data = prepared.data;
  const resolvedItems = prepared.items;
  const subtotal = prepared.subtotal;
  const total = prepared.total;
  const amountPaid = prepared.amount_paid;
  const changeGiven = prepared.change_given;
  const remaining = prepared.remaining;
  const saleDate = prepared.sale_date;
  // Create sale record
  const sale: Sale = {
    id: ids.sales++,
    invoice_number: nextInvoice(),
    sale_type: data.sale_type,
    customer_id: data.customer_id ?? null,
    customer_name: prepared.customer_name,
    subtotal,
    discount: data.discount,
    total,
    amount_paid: amountPaid,
    change_given: changeGiven,
    remaining,
    cogs: 0,
    gross_profit: 0,
    date: saleDate,
    shift_id: data.shift_id ?? null,
    user_id: data.user_id ?? null,
    notes: data.notes ?? null,
    cancelled: false,
    cancelled_by: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: now(),
  };

  let totalCogs = 0;

  // Create sale items + batch allocations + stock movements
  for (const item of resolvedItems) {
    const lineTotal = item.line_total;
    const itemCogs = item.item_cogs;

    const saleItem: SaleItem = {
      id: ids.saleItems++,
      sale_id: sale.id,
      product_id: item.item.product_id,
      product_name: item.product.trade_name,
      batch_id: item.allocations[0]?.batch_id ?? null,
      unit: item.item.unit,
      quantity: item.item.quantity,
      unit_name: item.item.unit,
      quantity_entered: item.item.quantity,
      conversion_factor: item.item.quantity > 0 ? item.qty_in_inv_unit / item.item.quantity : 0,
      quantity_in_inventory_unit: item.qty_in_inv_unit,
      unit_price: item.item.unit_price,
      base_purchase_price: item.base_purchase_price,
      discount: item.item.discount,
      line_total: lineTotal,
      cogs: itemCogs,
    };
    store.saleItems.push(saleItem);
    totalCogs += itemCogs;

    // Batch allocations + deduct stock
    for (const alloc of item.allocations) {
      store.saleBatchAllocations.push({
        id: ids.saleAllocations++,
        sale_item_id: saleItem.id,
        batch_id: alloc.batch_id,
        quantity_allocated: alloc.quantity,
        purchase_price: alloc.purchase_price,
      });

      // Deduct from batch
      const batch = store.batches.find(b => b.id === alloc.batch_id);
      if (batch) {
        batch.quantity -= alloc.quantity;
        if (batch.quantity <= 0) {
          batch.quantity = 0;
          batch.status = 'DEPLETED';
        }
      }

      // Stock movement
      store.stockMovements.push({
        id: ids.stockMovements++,
        product_id: item.item.product_id,
        batch_id: alloc.batch_id,
        type: 'SALE',
        quantity: -alloc.quantity,
        unit: item.product.inventory_unit,
        quantity_in_inventory_unit: -alloc.quantity,
        reference_type: 'sale',
        reference_id: sale.id,
        note: null,
        user_id: data.user_id ?? null,
        created_at: now(),
      });
    }
  }

  // Update sale COGS and profit
  sale.cogs = totalCogs;
  sale.gross_profit = total - totalCogs;
  store.sales.push(sale);

  // Customer balance for credit sales
  if ((data.sale_type === 'credit' || remaining > 0) && data.customer_id) {
    const customer = prepared.customer;
    if (customer) {
      customer.balance += remaining;
      store.customerTransactions.push({
        id: ids.customerTx++,
        customer_id: data.customer_id,
        type: 'sale',
        amount: total,
        balance_after: customer.balance,
        reference_id: sale.id,
        note: `فاتورة ${sale.invoice_number}`,
        date: saleDate,
        created_at: now(),
      });
      if (amountPaid > 0) {
        store.customerTransactions.push({
          id: ids.customerTx++,
          customer_id: data.customer_id,
          type: 'payment',
          amount: -amountPaid,
          balance_after: customer.balance,
          reference_id: sale.id,
          note: `دفعة من فاتورة ${sale.invoice_number}`,
          date: saleDate,
          created_at: now(),
        });
      }
    }
  }

  // Cash transaction
  if (amountPaid > 0) {
    store.cashTransactions.push({
      id: ids.cashTx++,
      type: 'SALE_CASH',
      amount: amountPaid,
      reference_type: 'sale',
      reference_id: sale.id,
      shift_id: data.shift_id ?? null,
      note: `بيع نقدي - ${sale.invoice_number}`,
      user_id: data.user_id ?? null,
      date: saleDate,
      created_at: now(),
    });
  }

  // Update shift totals
  if (data.shift_id) {
    const shift = prepared.shift;
    if (shift) {
      shift.total_sales += total;
      shift.expected_cash = (shift.expected_cash || shift.opening_cash) + amountPaid;
    }
  }

  addAuditLog({
    action: 'SALE_CREATE', entity: 'sale', entity_id: sale.id,
    after_data: JSON.stringify({ invoice: sale.invoice_number, total }),
  });

  return { success: true, sale };
}

export function createSale(data: NewSale, actor?: User | null): SaleResult {
  const saleDenied = salePermissionError(data, actor);
  if (saleDenied) return { success: false, error: saleDenied };
  try {
    const prepared = prepareSale(data);
    if (!prepared.ok) return { success: false, error: prepared.error };
    // Commit invoice, inventory, balances, cash and audit as one rollback-capable mutation.
    return commitReturnAtomically(() => executePreparedSaleInMemory(prepared.prepared));
  } catch (e: any) {
    return { success: false, error: e?.message || 'خطأ غير متوقع' };
  }
}

// ─── SQL sale path (Phase 3) ────────────────────────────────────────
// createSale is synchronous and expo-sqlite is async, so the SQL path
// lives in this async twin: same permission checks and the same
// prepareSale validation, then one SQL transaction, then the same rows
// applied to the in-memory store. Screens adopt createSaleAsync
// gradually; the synchronous createSale stays as the legacy path and as
// the fallback when the typed store is not ready.

/** Whether the SQL sale path can run. False until ensureTypedStoreReady()
 * succeeds; createSaleAsync falls back to the legacy path when false. */
export function isSqlSaleWriteEnabled(): boolean {
  return isTypedStoreReady();
}

/** Serialises concurrent SQL sales: each sale's plan is built from the
 * live store only after the previous SQL sale applied, so two sales can
 * never reserve the same invoice number or over-sell the same batch. */
let sqlSaleQueue: Promise<void> = Promise.resolve();

/** Assemble a write plan from a prepared sale and the live counters. */
function toPlanInput(prepared: PreparedSale): SalePlanInput {
  const batches: Batch[] = [];
  const seen = new Set<number>();
  for (const item of prepared.items) {
    for (const alloc of item.allocations) {
      if (seen.has(alloc.batch_id)) continue;
      seen.add(alloc.batch_id);
      const batch = store.batches.find(b => b.id === alloc.batch_id);
      if (batch) batches.push(batch);
    }
  }
  return {
    sale_type: prepared.data.sale_type,
    customer_id: prepared.data.customer_id ?? null,
    customer_name: prepared.customer_name,
    customer: prepared.customer,
    customer_balance_after: prepared.customer_balance_after,
    customer_credit_limit: prepared.customer ? prepared.customer.credit_limit : null,
    shift: prepared.shift,
    user_id: prepared.data.user_id ?? null,
    notes: prepared.data.notes ?? null,
    date: prepared.sale_date,
    subtotal: prepared.subtotal,
    discount: prepared.data.discount,
    total: prepared.total,
    amount_paid: prepared.amount_paid,
    change_given: prepared.change_given,
    remaining: prepared.remaining,
    total_cogs: prepared.total_cogs,
    items: prepared.items.map((entry): PlannedSaleItem => ({
      product_id: entry.item.product_id,
      product_name: entry.product.trade_name,
      inventory_unit: entry.product.inventory_unit,
      unit: entry.item.unit,
      quantity: entry.item.quantity,
      qty_in_inv_unit: entry.qty_in_inv_unit,
      unit_price: entry.item.unit_price,
      discount: entry.item.discount,
      line_total: entry.line_total,
      item_cogs: entry.item_cogs,
      base_purchase_price: entry.base_purchase_price,
      allocations: entry.allocations.map(alloc => ({ ...alloc })),
    })),
    batches,
    ids: { ...ids },
    invoice_counter: invoiceCounter,
    created_at: now(),
    updated_at_iso: isoNow(),
    device_id: getSyncDeviceId(),
  };
}

/** Apply an executed SQL sale plan to the in-memory store: the same rows
 * the transaction wrote, in the same order the legacy path pushes them.
 * Then persistStore() records the outbox entries and writes the diff. */
function applySalePlanToMemory(plan: SaleWritePlan): void {
  for (const item of plan.saleItems) store.saleItems.push(item);
  for (const alloc of plan.allocations) store.saleBatchAllocations.push(alloc);
  for (const movement of plan.stockMovements) store.stockMovements.push(movement);
  for (const updated of plan.updatedBatches) {
    const batch = store.batches.find(b => b.id === updated.id);
    if (batch) {
      batch.quantity = updated.quantity;
      batch.status = updated.status;
    }
  }
  store.sales.push(plan.sale);
  for (const tx of plan.customerTransactions) store.customerTransactions.push(tx);
  if (plan.updatedCustomer) {
    const customer = store.customers.find(c => c.id === plan.updatedCustomer?.id);
    if (customer) customer.balance = plan.updatedCustomer.balance;
  }
  if (plan.cashTransaction) store.cashTransactions.push(plan.cashTransaction);
  if (plan.updatedShift) {
    const shift = store.shifts.find(s => s.id === plan.updatedShift?.id);
    if (shift) {
      shift.total_sales = plan.updatedShift.total_sales;
      shift.expected_cash = plan.updatedShift.expected_cash;
    }
  }
  store.auditLogs.push(plan.auditLog);
  Object.assign(ids, plan.nextIds);
  invoiceCounter = plan.nextInvoiceCounter;
}

/**
 * Run one sale through the SQL transaction. Returns null when the typed
 * store is unavailable (caller falls back to the legacy path). A failed
 * SQL transaction returns a failure result and is NEVER retried on the
 * legacy path: the transaction may have committed before the failure was
 * observed, and a silent fallback could sell twice.
 */
async function executeSqlSale(data: NewSale): Promise<SaleResult | null> {
  const getDb = persistenceBackend.getTypedDb;
  if (typeof getDb !== 'function') return null;
  const db = await getDb.call(persistenceBackend);
  if (!db) return null;
  try {
    // Flush pending legacy writes first, so the counter check inside the
    // transaction sees the same counters the plan is built from.
    try {
      await flushDatabaseWrites();
    } catch {
      // The in-transaction counter check below is the guard if the flush failed.
    }
    // Re-prepare inside the serialised queue: an earlier sale may have
    // consumed the batches this sale planned against.
    const prepared = prepareSale(data);
    if (!prepared.ok) return { success: false, error: prepared.error };
    const plan = buildSaleWritePlan(toPlanInput(prepared.prepared));
    await executeSaleTransaction(db, plan);
    applySalePlanToMemory(plan);
    persistStore();
    return { success: true, sale: plan.sale };
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : '';
    if (message === 'INSUFFICIENT_STOCK' || message.startsWith('INSUFFICIENT_STOCK')) {
      return { success: false, error: 'المخزون غير كافٍ' };
    }
    if (message.startsWith('COUNTER_MISMATCH')) {
      return { success: false, error: 'تعارض في أرقام الفواتير، أعد المحاولة' };
    }
    return { success: false, error: message || 'تعذّر حفظ البيع في قاعدة البيانات' };
  }
}

/** Async twin of createSale: the sale runs inside one SQL transaction
 * when the typed store is ready, and falls back to the legacy in-memory
 * path otherwise. The result shape and validation errors are identical
 * on both paths. */
export async function createSaleAsync(data: NewSale, actor?: User | null): Promise<SaleResult> {
  const saleDenied = salePermissionError(data, actor);
  if (saleDenied) return { success: false, error: saleDenied };
  try {
    const first = prepareSale(data);
    if (!first.ok) return { success: false, error: first.error };
    if (await ensureTypedStoreReady()) {
      const run = sqlSaleQueue.then(() => executeSqlSale(data));
      sqlSaleQueue = run.then(
        () => undefined,
        () => undefined,
      );
      const result = await run;
      if (result !== null) return result;
    }
    return commitReturnAtomically(() => executePreparedSaleInMemory(first.prepared));
  } catch (e: any) {
    return { success: false, error: e?.message || 'خطأ غير متوقع' };
  }
}
export function cancelSale(id: number, reason: string, user_id?: number, actor?: User | null): void {
  const denied = checkPermission(actor, 'sales.cancel', 'sale');
  if (denied) throw new Error(denied);
  commitReturnAtomically(() => {
  const sale = store.sales.find(s => s.id === id);
  if (!sale || sale.cancelled || store.saleReturns.some(entry => entry.sale_id === id)) return;

  const before = JSON.stringify(sale);
  sale.cancelled = true;
  sale.cancelled_by = user_id ?? null;
  sale.cancelled_at = now();
  sale.cancel_reason = reason;

  // Reverse stock movements
  store.saleItems
    .filter(si => si.sale_id === id)
    .forEach(si => {
      store.saleBatchAllocations
        .filter(a => a.sale_item_id === si.id)
        .forEach(alloc => {
          const batch = store.batches.find(b => b.id === alloc.batch_id);
          if (batch) {
            batch.quantity += alloc.quantity_allocated;
            // Cancellation must not make recalled stock sellable again.
            if (batch.status !== 'RECALLED') {
              batch.status = batch.quantity <= 1e-8 ? 'DEPLETED'
                : batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE';
            }
          }
          store.stockMovements.push({
            id: ids.stockMovements++,
            product_id: si.product_id,
            batch_id: alloc.batch_id,
            type: 'SALE_RETURN',
            quantity: alloc.quantity_allocated,
            unit: getProduct(si.product_id)?.inventory_unit ?? 'قطعة',
            quantity_in_inventory_unit: alloc.quantity_allocated,
            reference_type: 'sale_cancel',
            reference_id: id,
            note: `إلغاء فاتورة ${sale.invoice_number}`,
            user_id: user_id ?? null,
            created_at: now(),
          });
        });
    });

  // Reverse customer balance
  if (sale.remaining > 0 && sale.customer_id) {
    const customer = store.customers.find(c => c.id === sale.customer_id);
    if (customer) customer.balance -= sale.remaining;
  }

  // Reverse cash
  if (sale.amount_paid > 0) {
    store.cashTransactions.push({
      id: ids.cashTx++,
      type: 'SALE_CASH',
      amount: -sale.amount_paid,
      reference_type: 'sale_cancel',
      reference_id: id,
      shift_id: sale.shift_id,
      note: `إلغاء ${sale.invoice_number}`,
      user_id: user_id ?? null,
      date: today(),
      created_at: now(),
    });
  }

  addAuditLog({ action: 'SALE_CANCEL', entity: 'sale', entity_id: id,
    before_data: before, reason });
  });
}

export function getSales(opts?: {
  dateFrom?: string; dateTo?: string; customer_id?: number;
  sale_type?: SaleType; limit?: number; includeCancelled?: boolean;
}): Sale[] {
  let result = [...store.sales];
  if (!opts?.includeCancelled) result = result.filter(s => !s.cancelled);
  if (opts?.dateFrom) result = result.filter(s => s.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(s => s.date <= opts.dateTo!);
  if (opts?.customer_id) result = result.filter(s => s.customer_id === opts.customer_id);
  if (opts?.sale_type) result = result.filter(s => s.sale_type === opts.sale_type);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function getSale(id: number): Sale | null {
  return store.sales.find(s => s.id === id) ?? null;
}

export function getSaleItems(sale_id: number): SaleItem[] {
  return store.saleItems.filter(si => si.sale_id === sale_id);
}

export function getSaleItemReturnedQuantity(sale_item_id: number): number {
  return store.saleReturns.flatMap(entry => entry.items)
    .filter(line => line.sale_item_id === sale_item_id && store.saleReturns.some(entry => entry.id === line.return_id && entry.status !== 'CANCELLED'))
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function getSaleItemReturnableQuantity(sale_item_id: number): number {
  const item = store.saleItems.find(line => line.id === sale_item_id);
  if (!item) return 0;
  const sale = store.sales.find(entry => entry.id === item.sale_id);
  if (!sale || sale.cancelled) return 0;
  return Math.max(0, item.quantity - getSaleItemReturnedQuantity(sale_item_id));
}

export function getSaleReturns(sale_id: number): SaleReturn[] {
  return store.saleReturns.filter(entry => entry.sale_id === sale_id);
}

export function getAllSaleReturns(): SaleReturn[] {
  return [...store.saleReturns].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getSaleReturn(id: number): SaleReturn | null {
  return store.saleReturns.find(entry => entry.id === id) ?? null;
}

function nextSaleReturnNumber(id: number): string {
  return `SR-${String(id).padStart(6, '0')}`;
}

function nextPurchaseReturnNumber(id: number): string {
  return `PR-${String(id).padStart(6, '0')}`;
}

function commitReturnAtomically<T>(commit: () => T): T {
  // Defer persistence while the commit runs: addAuditLog() inside the
  // commit used to write an intermediate snapshot to disk, so killing
  // the app mid-commit could leave a partial state on disk even though
  // the in-memory rollback was correct. Writes requested during the
  // commit are flushed exactly once below, after the commit succeeds
  // or the rollback restores the previous state. Nested atomic commits
  // share the counter and flush only at the outermost exit.
  deferPersistCount++;
  try {
    const result = withAtomicMutation(
      () => JSON.stringify({ store, ids, invoiceCounter }),
      (serialized) => {
        const snapshot = JSON.parse(serialized) as { store: typeof store; ids: typeof ids; invoiceCounter: number };
        Object.keys(store).forEach(key => { (store as any)[key] = (snapshot.store as any)[key]; });
        Object.assign(ids, snapshot.ids);
        invoiceCounter = snapshot.invoiceCounter;
      },
      commit,
      persistStore,
    );
    // Persist every successful atomic transaction as well as rollback recovery.
    persistStore();
    return result;
  } finally {
    deferPersistCount--;
    if (deferPersistCount === 0 && persistDeferred) {
      persistDeferred = false;
      persistStore();
    }
  }
}

export interface NewSaleReturn {
  sale_id: number;
  items: { sale_item_id: number; quantity: number }[];
  user_id?: number | null;
  settlement_method?: Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'CUSTOMER_BALANCE' | 'CUSTOMER_CREDIT'>;
  condition?: ReturnCondition;
  notes?: string;
  idempotency_key?: string;
}

export type ReturnResult<T> = { success: true; record: T } | { success: false; error: string };

/** Direct sales return: no source invoice is fabricated. Quantities are entered in the product's base inventory unit. */
export interface NewDirectSaleReturn {
  items: { product_id: number; batch_id: number; quantity: number; unit_price: number }[];
  customer_id?: number | null;
  user_id?: number | null;
  settlement_method?: Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'CUSTOMER_BALANCE' | 'CUSTOMER_CREDIT'>;
  condition?: ReturnCondition;
  notes?: string;
  idempotency_key?: string;
}
export function createDirectSaleReturn(data: NewDirectSaleReturn): ReturnResult<SaleReturn> {
  if (data.idempotency_key) { const old = store.saleReturns.find(x => x.idempotency_key === data.idempotency_key); if (old) return { success: true, record: old }; }
  if (!data.items?.length) return { success: false, error: 'أضف صنفًا واحدًا على الأقل' };
  const condition = data.condition ?? 'SELLABLE';
  const method = data.settlement_method ?? 'CASH_REFUND';
  const customer = data.customer_id ? store.customers.find(x => x.id === data.customer_id) : null;
  if (data.customer_id && !customer) return { success: false, error: 'العميل المحدد غير موجود' };
  if (method !== 'CASH_REFUND' && !customer) return { success: false, error: 'تسوية حساب العميل تتطلب اختيار عميل' };
  const seen = new Set<string>();
  const prepared: { product: Product; batch: Batch; quantity: number; price: number; amount: number; cogs: number }[] = [];
  for (const row of data.items) {
    const key = row.product_id + ':' + row.batch_id;
    if (seen.has(key)) return { success: false, error: 'لا تكرر الدفعة نفسها؛ اجمع الكمية في سطر واحد' };
    seen.add(key);
    const product = getProduct(row.product_id);
    const batch = getBatch(row.batch_id);
    if (!product || !batch || batch.product_id !== product.id) return { success: false, error: 'الصنف أو الدفعة غير موجودة' };
    if (!Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.unit_price) || row.unit_price < 0) return { success: false, error: 'الكمية أو سعر الرد غير صحيح' };
    if (condition === 'SELLABLE' && batch.status === 'RECALLED') return { success: false, error: 'لا يمكن إعادة دفعة مسحوبة من التداول إلى المخزون المتاح' };
    const amount = row.quantity * row.unit_price;
    prepared.push({ product, batch, quantity: row.quantity, price: row.unit_price, amount, cogs: condition === 'SELLABLE' ? row.quantity * batch.purchase_price : 0 });
  }
  const total = prepared.reduce((s, x) => s + x.amount, 0);
  try { return commitReturnAtomically(() => {
    const id = ids.saleReturns++, number = nextSaleReturnNumber(id);
    const items: SaleReturnItem[] = prepared.map(x => ({ id: ids.saleReturnItems++, return_id: id, sale_item_id: 0, product_id: x.product.id,
      product_name: x.product.trade_name, unit: x.product.inventory_unit, quantity: x.quantity, conversion_factor: 1,
      quantity_in_inventory_unit: x.quantity, refund_amount: x.amount, returned_cogs: x.cogs,
      batch_allocations: [{ batch_id: x.batch.id, quantity: x.quantity }], unit_price: x.price, condition }));
    const user = data.user_id ? store.users.find(x => x.id === data.user_id) : null;
    const record: SaleReturn = { id, sale_id: 0, return_number: number, invoice_number: 'مباشر', customer_id: customer?.id ?? null,
      user_id: data.user_id ?? null, user_name: user?.full_name ?? null, settlement_method: method, condition, is_direct: true,
      notes: data.notes?.trim() || null, status: 'POSTED', idempotency_key: data.idempotency_key ?? null,
      total, cash_refund: method === 'CASH_REFUND' ? total : 0, credit_reduction: method === 'CASH_REFUND' ? 0 : total,
      date: today(), created_at: now(), items };
    for (const x of prepared) {
      if (condition === 'DAMAGED') x.batch.quarantined_quantity = (x.batch.quarantined_quantity ?? 0) + x.quantity;
      else x.batch.quantity += x.quantity;
      if (x.batch.status !== 'RECALLED') x.batch.status = x.batch.quantity <= 1e-8 ? 'DEPLETED' : (x.batch.expiry_date && x.batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE');
      store.stockMovements.push({ id: ids.stockMovements++, product_id: x.product.id, batch_id: x.batch.id,
        type: condition === 'DAMAGED' ? 'DAMAGE' : 'SALE_RETURN', quantity: x.quantity, unit: x.product.inventory_unit,
        quantity_in_inventory_unit: x.quantity, reference_type: 'sale_return', reference_id: id,
        note: 'مرتجع مبيعات مباشر', user_id: data.user_id ?? null, created_at: now() });
    }
    store.saleReturns.push(record);
    if (customer && record.credit_reduction > 0) { customer.balance -= total; store.customerTransactions.push({ id: ids.customerTx++, customer_id: customer.id,
      type: 'return', amount: -total, balance_after: customer.balance, reference_id: id, note: 'مرتجع مبيعات مباشر ' + number, date: today(), created_at: now() }); }
    if (record.cash_refund > 0) { const shift = getOpenShift(); store.cashTransactions.push({ id: ids.cashTx++, type: 'CUSTOMER_REFUND',
      amount: -total, reference_type: 'sale_return', reference_id: id, shift_id: shift?.id ?? null, note: 'رد نقدي لمرتجع مباشر ' + number,
      user_id: data.user_id ?? null, date: today(), created_at: now() }); if (shift) shift.expected_cash = (shift.expected_cash ?? shift.opening_cash) - total; }
    addAuditLog({ action: 'SALE_RETURN_CREATE_DIRECT', entity: 'sale_return', entity_id: id, user_id: data.user_id, after_data: JSON.stringify({ number, total, method, condition, items }) });
    return { success: true, record };
  }); } catch (e: any) { return { success: false, error: e?.message || 'تعذر ترحيل المرتجع المباشر' }; }
}

/** Direct purchase return without inventing a purchase invoice. Quantity is in base inventory units. */
export interface NewDirectPurchaseReturn {
  items: { product_id: number; batch_id: number; quantity: number; unit_price: number }[];
  supplier_id?: number | null;
  user_id?: number | null;
  settlement_method?: Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'SUPPLIER_BALANCE'>;
  notes?: string;
  idempotency_key?: string;
}
export function createDirectPurchaseReturn(data: NewDirectPurchaseReturn): ReturnResult<PurchaseReturn> {
  if (data.idempotency_key) { const old = store.purchaseReturns.find(x => x.idempotency_key === data.idempotency_key); if (old) return { success: true, record: old }; }
  if (!data.items?.length) return { success: false, error: 'أضف صنفًا واحدًا على الأقل' };
  const method = data.settlement_method ?? 'SUPPLIER_BALANCE';
  const supplier = data.supplier_id ? store.suppliers.find(x => x.id === data.supplier_id) : null;
  if (method === 'SUPPLIER_BALANCE' && !supplier) return { success: false, error: 'اختر المورد لتخفيض مديونيته' };
  const seen = new Set<string>();
  const prepared: { product: Product; batch: Batch; quantity: number; price: number; amount: number }[] = [];
  for (const row of data.items) {
    const key = row.product_id + ':' + row.batch_id;
    if (seen.has(key)) return { success: false, error: 'لا تكرر الدفعة نفسها؛ اجمع الكمية في سطر واحد' };
    seen.add(key);
    const product = getProduct(row.product_id), batch = getBatch(row.batch_id);
    if (!product || !batch || batch.product_id !== product.id) return { success: false, error: 'الصنف أو الدفعة غير موجودة' };
    if (supplier && batch.supplier_id != null && batch.supplier_id !== supplier.id) return { success: false, error: 'الدفعة لا تتبع المورد المحدد' };
    if (!Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > batch.quantity || !Number.isFinite(row.unit_price) || row.unit_price < 0) return { success: false, error: 'الكمية تتجاوز رصيد الدفعة أو السعر غير صحيح' };
    prepared.push({ product, batch, quantity: row.quantity, price: row.unit_price, amount: row.quantity * row.unit_price });
  }
  const total = prepared.reduce((s, x) => s + x.amount, 0);
  try { return commitReturnAtomically(() => {
    const id = ids.purchaseReturns++, number = nextPurchaseReturnNumber(id);
    const items: PurchaseReturnItem[] = prepared.map(x => ({ id: ids.purchaseReturnItems++, return_id: id, purchase_item_id: 0,
      product_id: x.product.id, product_name: x.product.trade_name, unit: x.product.inventory_unit, quantity: x.quantity,
      conversion_factor: 1, quantity_in_inventory_unit: x.quantity, refund_amount: x.amount, batch_id: x.batch.id, unit_price: x.price }));
    const user = data.user_id ? store.users.find(x => x.id === data.user_id) : null;
    const record: PurchaseReturn = { id, purchase_id: 0, return_number: number, invoice_number: 'مباشر', supplier_id: supplier?.id ?? null,
      user_id: data.user_id ?? null, user_name: user?.full_name ?? null, settlement_method: method, is_direct: true,
      notes: data.notes?.trim() || null, status: 'POSTED', idempotency_key: data.idempotency_key ?? null,
      total, cash_refund: method === 'CASH_REFUND' ? total : 0, payable_reduction: method === 'SUPPLIER_BALANCE' ? total : 0,
      date: today(), created_at: now(), items };
    for (const x of prepared) {
      x.batch.quantity -= x.quantity;
      if (x.batch.quantity <= 1e-8 && x.batch.status !== 'RECALLED') x.batch.status = 'DEPLETED';
      store.stockMovements.push({ id: ids.stockMovements++, product_id: x.product.id, batch_id: x.batch.id, type: 'PURCHASE_RETURN',
        quantity: -x.quantity, unit: x.product.inventory_unit, quantity_in_inventory_unit: -x.quantity, reference_type: 'purchase_return',
        reference_id: id, note: 'مرتجع مشتريات مباشر إلى المورد', user_id: data.user_id ?? null, created_at: now() });
    }
    store.purchaseReturns.push(record);
    if (supplier && record.payable_reduction > 0) { supplier.balance -= total; store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id,
      type: 'return', amount: -total, balance_after: supplier.balance, reference_id: id, note: 'مرتجع مشتريات مباشر ' + number, date: today(), created_at: now() }); }
    if (record.cash_refund > 0) { const shift = getOpenShift(); store.cashTransactions.push({ id: ids.cashTx++, type: 'PURCHASE_RETURN',
      amount: total, reference_type: 'purchase_return', reference_id: id, shift_id: shift?.id ?? null, note: 'استرداد نقدي لمرتجع مباشر ' + number,
      user_id: data.user_id ?? null, date: today(), created_at: now() }); if (shift) shift.expected_cash = (shift.expected_cash ?? shift.opening_cash) + total; }
    addAuditLog({ action: 'PURCHASE_RETURN_CREATE_DIRECT', entity: 'purchase_return', entity_id: id, user_id: data.user_id, after_data: JSON.stringify({ number, total, method, items }) });
    return { success: true, record };
  }); } catch (e: any) { return { success: false, error: e?.message || 'تعذر ترحيل المرتجع المباشر' }; }
}

export function createSaleReturn(data: NewSaleReturn, actor?: User | null): ReturnResult<SaleReturn> {
  const denied = checkPermission(actor, 'sales.return', 'sale_return');
  if (denied) return { success: false, error: denied };
  if (data.idempotency_key) {
    const duplicate = store.saleReturns.find(entry => entry.idempotency_key === data.idempotency_key);
    if (duplicate) return { success: true, record: duplicate };
  }
  const sale = store.sales.find(entry => entry.id === data.sale_id);
  if (!sale || sale.cancelled) return { success: false, error: 'الفاتورة غير موجودة أو ملغاة' };
  if (!data.items.length) return { success: false, error: 'اختر صنفًا واحدًا على الأقل للمرتجع' };
  const condition = data.condition ?? 'SELLABLE';
  if (condition !== 'SELLABLE' && condition !== 'DAMAGED') return { success: false, error: 'حالة المرتجع غير صحيحة' };
  const settlementMethod = data.settlement_method ?? (sale.customer_id ? 'CUSTOMER_BALANCE' : 'CASH_REFUND');
  const usesCustomerAccount = settlementMethod === 'CUSTOMER_BALANCE' || settlementMethod === 'CUSTOMER_CREDIT';
  const customer = sale.customer_id ? store.customers.find(entry => entry.id === sale.customer_id) : null;
  if (usesCustomerAccount && !customer) return { success: false, error: 'تسوية حساب العميل تتطلب فاتورة مرتبطة بعميل' };
  if (settlementMethod !== 'CASH_REFUND' && !usesCustomerAccount) return { success: false, error: 'طريقة تسوية مرتجع البيع غير صحيحة' };
  const prepared: { item: SaleItem; quantity: number; previouslyReturned: number; factor: number; baseQuantity: number; amount: number; returnedCogs: number; allocations: ReturnBatchAllocation[] }[] = [];
  const seen = new Set<number>();
  for (const request of data.items) {
    if (seen.has(request.sale_item_id)) return { success: false, error: 'لا تكرر الصنف نفسه في المرتجع' };
    seen.add(request.sale_item_id);
    const item = store.saleItems.find(line => line.id === request.sale_item_id && line.sale_id === sale.id);
    if (!item || !isValidUnitQuantity(request.quantity, item.unit_name || item.unit) || request.quantity > getSaleItemReturnableQuantity(request.sale_item_id)) {
      return { success: false, error: 'كمية المرتجع أكبر من الكمية المتبقية من الفاتورة' };
    }
    const factor = item.conversion_factor ?? (item.quantity > 0 ? item.quantity_in_inventory_unit / item.quantity : 1);
    if (!Number.isFinite(factor) || factor <= 0) return { success: false, error: 'معامل الوحدة التاريخي غير صالح' };
    const baseQuantity = toBaseQuantity(request.quantity, factor);
    const previouslyReturned = getSaleItemReturnedQuantity(item.id);
    const invoiceDiscountShare = sale.subtotal > 0 ? sale.discount * item.line_total / sale.subtotal : 0;
    const netLineAmount = Math.max(0, item.line_total - invoiceDiscountShare);
    const amount = item.quantity > 0 ? request.quantity * netLineAmount / item.quantity : 0;

    const sourceAllocations = store.saleBatchAllocations.filter(allocation => allocation.sale_item_id === item.id);
    let remainingBase = baseQuantity;
    const allocations: ReturnBatchAllocation[] = [];
    for (const source of sourceAllocations) {
      const alreadyReturned = store.saleReturns.flatMap(entry => entry.items)
        .filter(line => line.sale_item_id === item.id && store.saleReturns.some(entry => entry.id === line.return_id && entry.status !== 'CANCELLED'))
        .flatMap(line => line.batch_allocations)
        .filter(allocation => allocation.batch_id === source.batch_id)
        .reduce((sum, allocation) => sum + allocation.quantity, 0);
      const availableToRestore = Math.max(0, source.quantity_allocated - alreadyReturned);
      const amountFromBatch = Math.min(availableToRestore, remainingBase);
      if (amountFromBatch > 0) allocations.push({ batch_id: source.batch_id, quantity: amountFromBatch });
      remainingBase -= amountFromBatch;
    }
    if (remainingBase > 1e-8) return { success: false, error: 'تعذر مطابقة المرتجع مع دفعات البيع الأصلية' };
    if (allocations.some(allocation => !store.batches.some(batch => batch.id === allocation.batch_id))) {
      return { success: false, error: 'إحدى دفعات البيع الأصلية لم تعد موجودة' };
    }
    const returnedCogs = condition === 'SELLABLE'
      ? baseQuantity * (item.base_purchase_price ?? (item.quantity_in_inventory_unit > 0 ? item.cogs / item.quantity_in_inventory_unit : 0))
      : 0;
    prepared.push({ item, quantity: request.quantity, previouslyReturned, factor, baseQuantity, amount, returnedCogs, allocations });
  }

  const total = prepared.reduce((sum, line) => sum + line.amount, 0);
  const creditReduction = usesCustomerAccount ? total : 0;
  const cashRefund = settlementMethod === 'CASH_REFUND' ? total : 0;

  try {
    return commitReturnAtomically(() => {
      const returnId = ids.saleReturns++;
      const items: SaleReturnItem[] = prepared.map(line => ({
        id: ids.saleReturnItems++, return_id: returnId, sale_item_id: line.item.id,
        product_id: line.item.product_id, product_name: line.item.product_name,
        unit: line.item.unit_name || line.item.unit, quantity: line.quantity,
        conversion_factor: line.factor, quantity_in_inventory_unit: line.baseQuantity,
        refund_amount: line.amount, returned_cogs: line.returnedCogs, batch_allocations: line.allocations,
        unit_price: line.item.quantity > 0 ? line.amount / line.quantity : 0,
        original_quantity: line.item.quantity, previously_returned_quantity: line.previouslyReturned, condition,
      }));
      const returnNumber = nextSaleReturnNumber(returnId);
      const user = data.user_id ? store.users.find(entry => entry.id === data.user_id) : null;
      const record: SaleReturn = { id: returnId, sale_id: sale.id, return_number: returnNumber,
        invoice_number: sale.invoice_number, customer_id: sale.customer_id, user_id: data.user_id ?? null,
        user_name: user?.full_name ?? null, settlement_method: settlementMethod, condition, notes: data.notes?.trim() || null,
        status: 'POSTED', idempotency_key: data.idempotency_key ?? null,
        total, cash_refund: cashRefund, credit_reduction: creditReduction, date: today(), created_at: now(), items };

      for (const line of items) {
        for (const allocation of line.batch_allocations) {
          const batch = store.batches.find(entry => entry.id === allocation.batch_id)!;
          if (condition === 'DAMAGED') batch.quarantined_quantity = (batch.quarantined_quantity ?? 0) + allocation.quantity;
          else batch.quantity += allocation.quantity;
          if (batch.status !== 'RECALLED') {
            batch.status = batch.quantity <= 1e-8 ? 'DEPLETED'
              : batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE';
          }
          store.stockMovements.push({ id: ids.stockMovements++, product_id: line.product_id, batch_id: batch.id,
            type: condition === 'DAMAGED' ? 'DAMAGE' : 'SALE_RETURN', quantity: allocation.quantity,
            unit: getProduct(line.product_id)?.inventory_unit ?? 'قطعة',
            quantity_in_inventory_unit: allocation.quantity, reference_type: 'sale_return', reference_id: returnId,
            note: condition === 'DAMAGED' ? `مرتجع تالف محجور من فاتورة ${sale.invoice_number}` : `مرتجع من فاتورة ${sale.invoice_number}`,
            user_id: data.user_id ?? null, created_at: now() });
        }
      }
      store.saleReturns.push(record);
      if (customer && creditReduction > 0) {
        customer.balance -= creditReduction;
        store.customerTransactions.push({ id: ids.customerTx++, customer_id: customer.id, type: 'return',
          amount: -creditReduction, balance_after: customer.balance, reference_id: returnId,
          note: `مرتجع ${returnNumber} من فاتورة ${sale.invoice_number}`, date: today(), created_at: now() });
      }
      if (cashRefund > 0) {
        const originalOpenShift = sale.shift_id ? store.shifts.find(entry => entry.id === sale.shift_id && entry.status === 'OPEN') : null;
        const refundShift = originalOpenShift ?? getOpenShift();
        store.cashTransactions.push({ id: ids.cashTx++, type: 'CUSTOMER_REFUND', amount: -cashRefund,
          reference_type: 'sale_return', reference_id: returnId, shift_id: refundShift?.id ?? null,
          note: `رد مبلغ ${returnNumber} من فاتورة ${sale.invoice_number}`, user_id: data.user_id ?? null, date: today(), created_at: now() });
        if (refundShift) refundShift.expected_cash = (refundShift.expected_cash ?? refundShift.opening_cash) - cashRefund;
      }
      addAuditLog({ action: 'SALE_RETURN_CREATE', entity: 'sale_return', entity_id: returnId, user_id: data.user_id,
        after_data: JSON.stringify({ return_number: returnNumber, sale_id: sale.id, total, settlement_method: settlementMethod, condition, items }) });
      return { success: true, record };
    });
  } catch {
    return { success: false, error: 'تعذر ترحيل المرتجع؛ تم التراجع عن جميع التغييرات' };
  }
}

// ═══════════════════════════════════════════════════════════
// PURCHASES — ATOMIC
// ═══════════════════════════════════════════════════════════

export interface NewPurchaseItem {
  product_id: number;
  batch_number: string;
  expiry_date: string;
  unit: string;
  quantity: number;
  purchase_price: number;
  free_quantity: number;
  discount: number;
}

export interface NewPurchase {
  supplier_id?: number | null;
  invoice_number?: string;
  date?: string;
  items: NewPurchaseItem[];
  discount: number;
  amount_paid: number;
  notes?: string;
  user_id?: number | null;
}

export interface PurchaseResult {
  success: boolean;
  purchase?: Purchase;
  error?: string;
}

export function createPurchase(data: NewPurchase, actor?: User | null): PurchaseResult {
  const denied = checkPermission(actor, 'purchases.create', 'purchase');
  if (denied) return { success: false, error: denied };
  try {
    if (!data.items.length) return { success: false, error: 'أضف صنفًا واحدًا على الأقل' };
    if (!Number.isFinite(data.discount) || data.discount < 0 || !Number.isFinite(data.amount_paid) || data.amount_paid < 0) {
      return { success: false, error: 'قيمة الخصم أو المبلغ المدفوع غير صحيحة' };
    }
    const purchaseDate = data.date || today();
    if (!isValidIsoDate(purchaseDate)) return { success: false, error: 'تاريخ فاتورة الشراء غير صحيح' };

    let subtotal = 0;
    const resolvedItems: (NewPurchaseItem & { qty_in_inv_unit: number; conversion_factor: number })[] = [];

    for (const item of data.items) {
      const product = getProduct(item.product_id);
      if (!product) return { success: false, error: 'منتج غير موجود' };
      if (!isValidUnitQuantity(item.quantity, item.unit) || !isValidUnitQuantity(item.free_quantity, item.unit, true) ||
          !Number.isFinite(item.purchase_price) || item.purchase_price < 0 || !Number.isFinite(item.discount) ||
          item.discount < 0 || item.discount > item.quantity * item.purchase_price) {
        return { success: false, error: `تحقق من الكمية والسعر والخصم للصنف ${product.trade_name}` };
      }
      const factor = getUnitConversionFactor(item.product_id, item.unit);
      if (factor === null) return { success: false, error: `الوحدة ${item.unit} غير معرفة للصنف ${product.trade_name}` };
      if (!item.batch_number.trim()) return { success: false, error: `أدخل رقم دفعة ${product.trade_name}` };
      if (!isValidIsoDate(item.expiry_date) || item.expiry_date < purchaseDate) {
        return { success: false, error: `أدخل تاريخ انتهاء صحيحًا للصنف ${product.trade_name}` };
      }
      const qtyInInvUnit = toBaseQuantity(item.quantity, factor);
      const lineTotal = item.quantity * item.purchase_price - item.discount;
      subtotal += lineTotal;
      resolvedItems.push({ ...item, qty_in_inv_unit: qtyInInvUnit, conversion_factor: factor });
    }

    if (data.discount > subtotal) return { success: false, error: 'خصم الفاتورة أكبر من مجموع الأصناف' };
    const total = subtotal - data.discount;
    if (data.amount_paid > total) return { success: false, error: 'المبلغ المدفوع أكبر من إجمالي الفاتورة' };
    const remaining = total - data.amount_paid;

    // Commit purchase, batch quantities, supplier balance and cash atomically.
    return commitReturnAtomically(() => {
    const purchase: Purchase = {
      id: ids.purchases++,
      invoice_number: data.invoice_number || nextInvoice(),
      supplier_id: data.supplier_id ?? null,
      supplier_name: data.supplier_id
        ? (store.suppliers.find(s => s.id === data.supplier_id)?.name ?? null)
        : null,
      date: purchaseDate,
      subtotal,
      discount: data.discount,
      total,
      amount_paid: data.amount_paid,
      remaining,
      notes: data.notes ?? null,
      cancelled: false,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      user_id: data.user_id ?? null,
      created_at: now(),
    };
    store.purchases.push(purchase);

    for (const item of resolvedItems) {
      const product = getProduct(item.product_id)!;
      const lineTotal = item.quantity * item.purchase_price - item.discount;
      const totalQty = (item.quantity + item.free_quantity) * item.conversion_factor;
      const invoiceDiscountShare = subtotal > 0 ? data.discount * lineTotal / subtotal : 0;
      const netLineCost = Math.max(0, lineTotal - invoiceDiscountShare);
      const basePurchasePrice = totalQty > 0 ? netLineCost / totalQty : 0;

      // Find existing batch or create new
      let batch = store.batches.find(b =>
        b.product_id === item.product_id &&
        b.batch_number === item.batch_number &&
        b.expiry_date === item.expiry_date &&
        b.status === 'ACTIVE'
      );

      if (batch) {
        const oldQuantity = batch.quantity;
        batch.purchase_price = oldQuantity + totalQty > 0
          ? ((batch.purchase_price * oldQuantity) + (basePurchasePrice * totalQty)) / (oldQuantity + totalQty)
          : basePurchasePrice;
        batch.quantity += totalQty;
        batch.initial_quantity += totalQty;
      } else {
        batch = {
          id: ids.batches++,
          product_id: item.product_id,
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          received_date: purchaseDate,
          purchase_price: basePurchasePrice,
          selling_price: product.selling_price,
          quantity: totalQty,
          initial_quantity: totalQty,
          supplier_id: data.supplier_id ?? null,
          purchase_id: purchase.id,
          status: item.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE',
          notes: null,
          is_opening: false,
          created_at: now(),
        };
        store.batches.push(batch);
      }

      const purchaseItem: PurchaseItem = {
        id: ids.purchaseItems++, purchase_id: purchase.id, product_id: item.product_id,
        product_name: product.trade_name, batch_number: item.batch_number, expiry_date: item.expiry_date,
        unit: item.unit, unit_name: item.unit, quantity: item.quantity, quantity_entered: item.quantity,
        batch_id: batch.id, conversion_factor: item.conversion_factor,
        quantity_in_inventory_unit: totalQty, purchase_price: item.purchase_price,
        base_purchase_price: basePurchasePrice, free_quantity: item.free_quantity,
        discount: item.discount, line_total: lineTotal,
      };
      store.purchaseItems.push(purchaseItem);

      // Stock movement
      store.stockMovements.push({
        id: ids.stockMovements++,
        product_id: item.product_id,
        batch_id: batch.id,
        type: 'PURCHASE',
        quantity: totalQty,
        unit: product.inventory_unit,
        quantity_in_inventory_unit: totalQty,
        reference_type: 'purchase',
        reference_id: purchase.id,
        note: null,
        user_id: data.user_id ?? null,
        created_at: now(),
      });
    }

    // Supplier balance
    if (data.supplier_id && remaining > 0) {
      const supplier = store.suppliers.find(s => s.id === data.supplier_id);
      if (supplier) {
        supplier.balance += remaining;
        store.supplierTransactions.push({
          id: ids.supplierTx++,
          supplier_id: data.supplier_id,
          type: 'purchase',
          amount: total,
          balance_after: supplier.balance,
          reference_id: purchase.id,
          note: `فاتورة شراء ${purchase.invoice_number}`,
          date: purchaseDate,
          created_at: now(),
        });
      }
    }

    // Cash
    if (purchase.amount_paid > 0) {
      store.cashTransactions.push({
        id: ids.cashTx++,
        type: 'PURCHASE_PAYMENT',
        amount: -purchase.amount_paid,
        reference_type: 'purchase',
        reference_id: purchase.id,
        shift_id: null,
        note: `دفعة فاتورة ${purchase.invoice_number}`,
        user_id: data.user_id ?? null,
        date: purchaseDate,
        created_at: now(),
      });
    }

    addAuditLog({
      action: 'PURCHASE_CREATE', entity: 'purchase', entity_id: purchase.id,
      after_data: JSON.stringify({ invoice: purchase.invoice_number, total }),
    });

    return { success: true, purchase };
    });
  } catch (e: any) {
    return { success: false, error: e?.message || 'خطأ غير متوقع' };
  }
}

/** Safely cancel a purchase invoice, reversing stock and accounting only when its lot quantities remain available. */
export function cancelPurchaseInvoice(id: number, reason: string, user_id?: number | null, actor?: User | null): { success: boolean; error?: string } {
  const denied = checkPermission(actor, 'purchases.create', 'purchase');
  if (denied) return { success: false, error: denied };
  const purchase = store.purchases.find(p => p.id === id);
  if (!purchase) return { success: false, error: 'فاتورة المشتريات غير موجودة' };
  if (purchase.cancelled) return { success: false, error: 'الفاتورة ملغاة بالفعل' };
  if (!reason.trim()) return { success: false, error: 'سبب الإلغاء مطلوب' };
  const items = store.purchaseItems.filter(item => item.purchase_id === id);
  if (!items.length) return { success: false, error: 'لا توجد بنود مرتبطة بالفاتورة' };
  const activeReturns = store.purchaseReturns.filter(ret => ret.purchase_id === id && ret.status !== 'CANCELLED');
  if (activeReturns.length) return { success: false, error: 'لا يمكن إلغاء الفاتورة لوجود مرتجعات مشتريات مرحّلة؛ ألغِ المرتجعات أولًا' };
  for (const item of items) {
    const batch = item.batch_id ? getBatch(item.batch_id) : null;
    if (!batch) return { success: false, error: `دفعة الصنف ${item.product_name} غير موجودة؛ أوقف الإلغاء للمراجعة اليدوية` };
    if (batch.quantity + 1e-8 < item.quantity_in_inventory_unit) return { success: false, error: `لا يمكن إلغاء الفاتورة بأمان: رصيد دفعة ${item.product_name} أقل من كمية الفاتورة، ربما استُهلك جزء منها` };
  }
  try {
    return commitReturnAtomically(() => {
      for (const item of items) {
        const batch = getBatch(item.batch_id!);
        if (!batch) throw new Error('دفعة غير موجودة أثناء الإلغاء');
        batch.quantity = Math.max(0, batch.quantity - item.quantity_in_inventory_unit);
        if (batch.quantity <= 1e-8 && batch.status !== 'RECALLED') batch.status = 'DEPLETED';
        store.stockMovements.push({ id: ids.stockMovements++, product_id: item.product_id, batch_id: batch.id, type: 'ADJUSTMENT_OUT',
          quantity: -item.quantity_in_inventory_unit, unit: item.unit, quantity_in_inventory_unit: -item.quantity_in_inventory_unit,
          reference_type: 'purchase_cancel', reference_id: id, note: 'إلغاء فاتورة شراء: ' + reason.trim(), user_id: user_id ?? null, created_at: now() });
      }
      if (purchase.supplier_id && purchase.remaining > 0) {
        const supplier = store.suppliers.find(s => s.id === purchase.supplier_id);
        if (supplier) {
          supplier.balance = Math.max(0, supplier.balance - purchase.remaining);
          store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id, type: 'adjustment',
            amount: -purchase.remaining, balance_after: supplier.balance, reference_id: id, note: 'إلغاء فاتورة شراء ' + purchase.invoice_number + ': ' + reason.trim(), date: today(), created_at: now() });
        }
      }
      if (purchase.amount_paid > 0) store.cashTransactions.push({ id: ids.cashTx++, type: 'ADJUSTMENT', amount: purchase.amount_paid,
        reference_type: 'purchase_cancel', reference_id: id, shift_id: null, cashbox_id: 'daily',
        note: 'عكس دفعة فاتورة ملغاة ' + purchase.invoice_number + ': ' + reason.trim(), user_id: user_id ?? null, date: today(), created_at: now() });
      purchase.cancelled = true; purchase.cancelled_by = user_id ?? null; purchase.cancelled_at = now(); purchase.cancel_reason = reason.trim();
      addAuditLog({ action: 'PURCHASE_CANCEL', entity: 'purchase', entity_id: id, user_id: user_id ?? undefined,
        after_data: JSON.stringify({ reason: reason.trim(), total: purchase.total, amount_paid: purchase.amount_paid }) });
      return { success: true };
    });
  } catch (e: any) { return { success: false, error: e?.message || 'تعذر إلغاء فاتورة المشتريات' }; }
}

export function getPurchases(opts?: {
  dateFrom?: string; dateTo?: string; supplier_id?: number; limit?: number; includeCancelled?: boolean;
}): Purchase[] {
  let result = store.purchases.filter(p => opts?.includeCancelled || !p.cancelled);
  if (opts?.dateFrom) result = result.filter(p => p.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(p => p.date <= opts.dateTo!);
  if (opts?.supplier_id) result = result.filter(p => p.supplier_id === opts.supplier_id);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function getPurchase(id: number): Purchase | null {
  return store.purchases.find(p => p.id === id) ?? null;
}

export function getPurchaseItems(purchase_id: number): PurchaseItem[] {
  return store.purchaseItems.filter(pi => pi.purchase_id === purchase_id);
}

export function getPurchaseItemReturnableQuantity(purchase_item_id: number): number {
  const item = store.purchaseItems.find(line => line.id === purchase_item_id);
  if (!item) return 0;
  const purchase = store.purchases.find(entry => entry.id === item.purchase_id);
  if (!purchase || purchase.cancelled) return 0;
  return Math.max(0, item.quantity + item.free_quantity - getPurchaseItemReturnedQuantity(purchase_item_id));
}

export function getPurchaseItemReturnedQuantity(purchase_item_id: number): number {
  return store.purchaseReturns.flatMap(entry => entry.items)
    .filter(line => line.purchase_item_id === purchase_item_id && store.purchaseReturns.some(entry => entry.id === line.return_id && entry.status !== 'CANCELLED'))
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function getPurchaseReturns(purchase_id: number): PurchaseReturn[] {
  return store.purchaseReturns.filter(entry => entry.purchase_id === purchase_id);
}

export function getAllPurchaseReturns(): PurchaseReturn[] {
  return [...store.purchaseReturns].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getPurchaseReturn(id: number): PurchaseReturn | null {
  return store.purchaseReturns.find(entry => entry.id === id) ?? null;
}

/** Cancel a posted sales return by reversing its exact inventory and settlement effects. */
export function cancelSaleReturn(id: number, reason: string, user_id?: number | null, actor?: User | null): ReturnResult<SaleReturn> {
  const denied = checkPermission(actor, 'sales.return', 'sale_return');
  if (denied) return { success: false, error: denied };
  const record = store.saleReturns.find(entry => entry.id === id);
  if (!record) return { success: false, error: 'مرتجع المبيعات غير موجود' };
  if (record.status === 'CANCELLED') return { success: false, error: 'تم إلغاء هذا المرتجع سابقًا' };
  if (!reason.trim()) return { success: false, error: 'أدخل سبب إلغاء المرتجع' };
  try {
    return commitReturnAtomically(() => {
      for (const line of record.items) {
        for (const allocation of line.batch_allocations ?? []) {
          const batch = store.batches.find(entry => entry.id === allocation.batch_id);
          if (!batch) throw new Error('دفعة المرتجع غير موجودة؛ أُلغي الإجراء دون تغيير');
          if (record.condition === 'DAMAGED') batch.quarantined_quantity = Math.max(0, (batch.quarantined_quantity ?? 0) - allocation.quantity);
          else {
            if (batch.quantity + 1e-8 < allocation.quantity) throw new Error('لا يمكن عكس المرتجع: الكمية المسترجعة صُرفت لاحقًا من الدفعة');
            batch.quantity -= allocation.quantity;
          }
          if (batch.status !== 'RECALLED') batch.status = batch.quantity <= 1e-8 ? 'DEPLETED' : (batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE');
          store.stockMovements.push({ id: ids.stockMovements++, product_id: line.product_id, batch_id: batch.id,
            type: 'ADJUSTMENT_OUT', quantity: -allocation.quantity, unit: getProduct(line.product_id)?.inventory_unit ?? 'قطعة',
            quantity_in_inventory_unit: -allocation.quantity, reference_type: 'sale_return_cancel', reference_id: id,
            note: 'عكس مرتجع مبيعات: ' + reason.trim(), user_id: user_id ?? null, created_at: now() });
        }
      }
      const customer = record.customer_id ? store.customers.find(entry => entry.id === record.customer_id) : null;
      if (customer && record.credit_reduction > 0) {
        customer.balance += record.credit_reduction;
        store.customerTransactions.push({ id: ids.customerTx++, customer_id: customer.id, type: 'adjustment',
          amount: record.credit_reduction, balance_after: customer.balance, reference_id: id,
          note: 'عكس مرتجع مبيعات ' + (record.return_number ?? id) + ': ' + reason.trim(), date: today(), created_at: now() });
      }
      if (record.cash_refund > 0) {
        store.cashTransactions.push({ id: ids.cashTx++, type: 'ADJUSTMENT', amount: record.cash_refund,
          reference_type: 'sale_return_cancel', reference_id: id, shift_id: null,
          note: 'عكس رد نقدي لمرتجع ' + (record.return_number ?? id) + ': ' + reason.trim(), user_id: user_id ?? null, date: today(), created_at: now() });
      }
      record.status = 'CANCELLED';
      addAuditLog({ action: 'SALE_RETURN_CANCEL', entity: 'sale_return', entity_id: id, user_id: user_id ?? undefined,
        after_data: JSON.stringify({ reason: reason.trim(), return_number: record.return_number }) });
      return { success: true, record };
    });
  } catch (error: any) { return { success: false, error: error?.message || 'تعذر إلغاء المرتجع؛ تم التراجع عن التغييرات' }; }
}

/** Cancel a posted purchase return and restore the original batch, supplier balance or cash. */
export function cancelPurchaseReturn(id: number, reason: string, user_id?: number | null): ReturnResult<PurchaseReturn> {
  const record = store.purchaseReturns.find(entry => entry.id === id);
  if (!record) return { success: false, error: 'مرتجع المشتريات غير موجود' };
  if (record.status === 'CANCELLED') return { success: false, error: 'تم إلغاء هذا المرتجع سابقًا' };
  if (!reason.trim()) return { success: false, error: 'أدخل سبب إلغاء المرتجع' };
  try {
    return commitReturnAtomically(() => {
      for (const line of record.items) {
        const batch = store.batches.find(entry => entry.id === line.batch_id);
        if (!batch) throw new Error('دفعة المرتجع غير موجودة؛ أُلغي الإجراء دون تغيير');
        batch.quantity += line.quantity_in_inventory_unit;
        if (batch.status !== 'RECALLED') batch.status = batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE';
        store.stockMovements.push({ id: ids.stockMovements++, product_id: line.product_id, batch_id: batch.id,
          type: 'ADJUSTMENT_IN', quantity: line.quantity_in_inventory_unit, unit: getProduct(line.product_id)?.inventory_unit ?? 'قطعة',
          quantity_in_inventory_unit: line.quantity_in_inventory_unit, reference_type: 'purchase_return_cancel', reference_id: id,
          note: 'عكس مرتجع مشتريات: ' + reason.trim(), user_id: user_id ?? null, created_at: now() });
      }
      const supplier = record.supplier_id ? store.suppliers.find(entry => entry.id === record.supplier_id) : null;
      if (supplier && record.payable_reduction > 0) {
        supplier.balance += record.payable_reduction;
        store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id, type: 'adjustment',
          amount: record.payable_reduction, balance_after: supplier.balance, reference_id: id,
          note: 'عكس مرتجع مشتريات ' + (record.return_number ?? id) + ': ' + reason.trim(), date: today(), created_at: now() });
      }
      if (record.cash_refund > 0) {
        store.cashTransactions.push({ id: ids.cashTx++, type: 'ADJUSTMENT', amount: -record.cash_refund,
          reference_type: 'purchase_return_cancel', reference_id: id, shift_id: null,
          note: 'عكس استرداد نقدي لمرتجع ' + (record.return_number ?? id) + ': ' + reason.trim(), user_id: user_id ?? null, date: today(), created_at: now() });
      }
      record.status = 'CANCELLED';
      addAuditLog({ action: 'PURCHASE_RETURN_CANCEL', entity: 'purchase_return', entity_id: id, user_id: user_id ?? undefined,
        after_data: JSON.stringify({ reason: reason.trim(), return_number: record.return_number }) });
      return { success: true, record };
    });
  } catch (error: any) { return { success: false, error: error?.message || 'تعذر إلغاء المرتجع؛ تم التراجع عن التغييرات' }; }
}

export interface NewPurchaseReturn {
  purchase_id: number;
  items: { purchase_item_id: number; quantity: number }[];
  user_id?: number | null;
  settlement_method?: Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'SUPPLIER_BALANCE'>;
  notes?: string;
  idempotency_key?: string;
}

export function createPurchaseReturn(data: NewPurchaseReturn, actor?: User | null): ReturnResult<PurchaseReturn> {
  const denied = checkPermission(actor, 'purchases.return', 'purchase_return');
  if (denied) return { success: false, error: denied };
  if (data.idempotency_key) {
    const duplicate = store.purchaseReturns.find(entry => entry.idempotency_key === data.idempotency_key);
    if (duplicate) return { success: true, record: duplicate };
  }
  const purchase = store.purchases.find(entry => entry.id === data.purchase_id);
  if (!purchase || purchase.cancelled) return { success: false, error: 'فاتورة الشراء غير موجودة أو ملغاة' };
  if (!data.items.length) return { success: false, error: 'اختر صنفًا واحدًا على الأقل للمرتجع' };
  const settlementMethod = data.settlement_method ?? (purchase.supplier_id ? 'SUPPLIER_BALANCE' : 'CASH_REFUND');
  const supplier = purchase.supplier_id ? store.suppliers.find(entry => entry.id === purchase.supplier_id) : null;
  if (settlementMethod === 'SUPPLIER_BALANCE' && !supplier) return { success: false, error: 'تسوية حساب المورد تتطلب فاتورة مرتبطة بمورد' };
  if (settlementMethod !== 'CASH_REFUND' && settlementMethod !== 'SUPPLIER_BALANCE') return { success: false, error: 'طريقة تسوية مرتجع الشراء غير صحيحة' };
  const prepared: { item: PurchaseItem; batch: Batch; quantity: number; previouslyReturned: number; factor: number; baseQuantity: number; amount: number }[] = [];
  const seen = new Set<number>();
  for (const request of data.items) {
    if (seen.has(request.purchase_item_id)) return { success: false, error: 'لا تكرر الصنف نفسه في المرتجع' };
    seen.add(request.purchase_item_id);
    const item = store.purchaseItems.find(line => line.id === request.purchase_item_id && line.purchase_id === purchase.id);
    if (!item || !isValidUnitQuantity(request.quantity, item.unit_name || item.unit) || request.quantity > getPurchaseItemReturnableQuantity(request.purchase_item_id)) {
      return { success: false, error: 'كمية المرتجع أكبر من الكمية المتبقية من فاتورة الشراء' };
    }
    const factor = item.conversion_factor ?? ((item.quantity + item.free_quantity) > 0
      ? item.quantity_in_inventory_unit / (item.quantity + item.free_quantity) : 1);
    if (!Number.isFinite(factor) || factor <= 0) return { success: false, error: 'معامل الوحدة التاريخي غير صالح' };
    const baseQuantity = toBaseQuantity(request.quantity, factor);
    const batch = store.batches.find(entry => entry.id === item.batch_id) || store.batches.find(entry =>
      entry.product_id === item.product_id && entry.batch_number === item.batch_number && entry.expiry_date === item.expiry_date);
    if (!batch || batch.quantity + 1e-8 < baseQuantity) return { success: false, error: `الرصيد المتاح في دفعة ${item.batch_number} لا يكفي للمرتجع` };
    const invoiceDiscountShare = purchase.subtotal > 0 ? purchase.discount * item.line_total / purchase.subtotal : 0;
    const netLineAmount = Math.max(0, item.line_total - invoiceDiscountShare);
    const receivedQuantity = item.quantity + item.free_quantity;
    const amount = receivedQuantity > 0 ? request.quantity * netLineAmount / receivedQuantity : 0;
    prepared.push({ item, batch, quantity: request.quantity, previouslyReturned: getPurchaseItemReturnedQuantity(item.id), factor, baseQuantity, amount });
  }

  const total = prepared.reduce((sum, line) => sum + line.amount, 0);
  const payableReduction = settlementMethod === 'SUPPLIER_BALANCE' ? total : 0;
  const cashRefund = settlementMethod === 'CASH_REFUND' ? total : 0;

  try {
    return commitReturnAtomically(() => {
      const returnId = ids.purchaseReturns++;
      const items: PurchaseReturnItem[] = prepared.map(line => ({
        id: ids.purchaseReturnItems++, return_id: returnId, purchase_item_id: line.item.id,
        product_id: line.item.product_id, product_name: line.item.product_name,
        unit: line.item.unit_name || line.item.unit, quantity: line.quantity,
        conversion_factor: line.factor, quantity_in_inventory_unit: line.baseQuantity,
        refund_amount: line.amount, batch_id: line.batch.id,
        unit_price: line.item.quantity > 0 ? line.amount / line.quantity : 0,
        original_quantity: line.item.quantity + line.item.free_quantity,
        previously_returned_quantity: line.previouslyReturned,
      }));
      const returnNumber = nextPurchaseReturnNumber(returnId);
      const user = data.user_id ? store.users.find(entry => entry.id === data.user_id) : null;
      const record: PurchaseReturn = { id: returnId, purchase_id: purchase.id, return_number: returnNumber,
        invoice_number: purchase.invoice_number, supplier_id: purchase.supplier_id, user_id: data.user_id ?? null,
        user_name: user?.full_name ?? null, settlement_method: settlementMethod, notes: data.notes?.trim() || null,
        status: 'POSTED', idempotency_key: data.idempotency_key ?? null,
        total, cash_refund: cashRefund, payable_reduction: payableReduction, date: today(), created_at: now(), items };

      for (const line of prepared) {
        line.batch.quantity = Math.max(0, line.batch.quantity - line.baseQuantity);
        if (line.batch.quantity <= 1e-8 && line.batch.status !== 'RECALLED') line.batch.status = 'DEPLETED';
        store.stockMovements.push({ id: ids.stockMovements++, product_id: line.item.product_id, batch_id: line.batch.id,
          type: 'PURCHASE_RETURN', quantity: -line.baseQuantity,
          unit: getProduct(line.item.product_id)?.inventory_unit ?? 'قطعة',
          quantity_in_inventory_unit: -line.baseQuantity, reference_type: 'purchase_return', reference_id: returnId,
          note: `مرتجع ${returnNumber} إلى المورد من فاتورة ${purchase.invoice_number}`, user_id: data.user_id ?? null, created_at: now() });
      }
      store.purchaseReturns.push(record);
      if (supplier && payableReduction > 0) {
        supplier.balance -= payableReduction;
        store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id, type: 'return',
          amount: -payableReduction, balance_after: supplier.balance, reference_id: returnId,
          note: `مرتجع ${returnNumber} من فاتورة ${purchase.invoice_number}`, date: today(), created_at: now() });
      }
      if (cashRefund > 0) {
        const refundShift = getOpenShift();
        store.cashTransactions.push({ id: ids.cashTx++, type: 'PURCHASE_RETURN', amount: cashRefund,
          reference_type: 'purchase_return', reference_id: returnId, shift_id: refundShift?.id ?? null,
          note: `استرداد ${returnNumber} من فاتورة ${purchase.invoice_number}`, user_id: data.user_id ?? null, date: today(), created_at: now() });
        if (refundShift) {
          refundShift.expected_cash = (refundShift.expected_cash ?? refundShift.opening_cash) + cashRefund;
        }
      }
      addAuditLog({ action: 'PURCHASE_RETURN_CREATE', entity: 'purchase_return', entity_id: returnId, user_id: data.user_id,
        after_data: JSON.stringify({ return_number: returnNumber, purchase_id: purchase.id, total, settlement_method: settlementMethod, items }) });
      return { success: true, record };
    });
  } catch {
    return { success: false, error: 'تعذر ترحيل المرتجع؛ تم التراجع عن جميع التغييرات' };
  }
}

// ═══════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════

export function getCustomers(search?: string): Customer[] {
  let result = [...store.customers];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
    );
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function getCustomer(id: number): Customer | null {
  return store.customers.find(c => c.id === id) ?? null;
}

export function addCustomer(data: {
  name: string; phone?: string; address?: string; credit_limit?: number; opening_balance?: number; notes?: string;
}, actor?: User | null): Customer {
  const denied = checkPermission(actor, 'customers.manage', 'customer');
  if (denied) throw new Error(denied);
  const openingBalance = Number(data.opening_balance ?? 0);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new Error('الرصيد الافتتاحي غير صالح');
  const customer: Customer = {
    id: ids.customers++,
    name: data.name,
    phone: data.phone ?? null,
    address: data.address ?? null,
    credit_limit: data.credit_limit ?? 0,
    balance: openingBalance,
    notes: data.notes ?? null,
    created_at: now(),
  };
  store.customers.push(customer);
  if (openingBalance > 0) {
    store.customerTransactions.push({ id: ids.customerTx++, customer_id: customer.id, type: 'adjustment', amount: openingBalance, balance_after: openingBalance, reference_id: null, note: 'رصيد افتتاحي — دين سابق', date: today(), created_at: now() });
    addAuditLog({ action: 'CUSTOMER_OPENING_BALANCE', entity: 'customer', entity_id: customer.id, after_data: JSON.stringify({ openingBalance }) });
  }
  persistStore();
  return customer;
}

export function updateCustomer(id: number, data: Partial<Customer>, actor?: User | null): void {
  const denied = checkPermission(actor, 'customers.manage', 'customer');
  if (denied) throw new Error(denied);
  const c = store.customers.find(c => c.id === id);
  if (c) Object.assign(c, data);
  persistStore();
}

export function deleteCustomer(id: number, actor?: User | null): void {
  const denied = checkPermission(actor, 'customers.manage', 'customer');
  if (denied) throw new Error(denied);
  store.customers = store.customers.filter(c => c.id !== id);
  persistStore();
}

export function recordCustomerPayment(customer_id: number, amount: number, note?: string, cashbox_id: CashboxId = 'daily', payment_method = 'نقداً', actor?: User | null): void {
  const denied = checkPermission(actor, 'customers.collect', 'customer');
  if (denied) throw new Error(denied);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ القبض غير صالح');
  const customer = store.customers.find(c => c.id === customer_id);
  if (!customer) throw new Error('العميل غير موجود');
  customer.balance -= amount;
  store.customerTransactions.push({
    id: ids.customerTx++,
    customer_id,
    type: 'payment',
    amount: -amount,
    balance_after: customer.balance,
    reference_id: null,
    note: `${payment_method} — ${note ?? 'سداد دين'}`,
    date: today(),
    created_at: now(),
  });
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'COLLECTION',
    amount,
    cashbox_id,
    reference_type: 'customer_payment',
    reference_id: customer_id,
    shift_id: null,
    note: `تحصيل من ${customer.name} — ${payment_method}${note ? ` — ${note}` : ''}`,
    user_id: null,
    date: today(),
    created_at: now(),
  });
  addAuditLog({ action: 'CUSTOMER_PAYMENT', entity: 'customer', entity_id: customer_id,
    after_data: JSON.stringify({ amount, balance: customer.balance }) });
}

export function getCustomerTransactions(customer_id: number): CustomerTransaction[] {
  return store.customerTransactions
    .filter(t => t.customer_id === customer_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════════════════════

export function getSuppliers(search?: string): Supplier[] {
  let result = [...store.suppliers];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(s =>
      s.name.toLowerCase().includes(q) || (s.phone || '').includes(q)
    );
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function getSupplier(id: number): Supplier | null {
  return store.suppliers.find(s => s.id === id) ?? null;
}

export function addSupplier(data: {
  name: string; phone?: string; address?: string; credit_limit?: number; opening_balance?: number; notes?: string;
}): Supplier {
  const openingBalance = Number(data.opening_balance ?? 0);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new Error('الرصيد الافتتاحي غير صالح');
  const supplier: Supplier = {
    id: ids.suppliers++,
    name: data.name,
    phone: data.phone ?? null,
    address: data.address ?? null,
    credit_limit: data.credit_limit ?? 0,
    balance: openingBalance,
    notes: data.notes ?? null,
    created_at: now(),
  };
  store.suppliers.push(supplier);
  if (openingBalance > 0) {
    store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id, type: 'adjustment', amount: openingBalance, balance_after: openingBalance, reference_id: null, note: 'رصيد افتتاحي — دين سابق', date: today(), created_at: now() });
    addAuditLog({ action: 'SUPPLIER_OPENING_BALANCE', entity: 'supplier', entity_id: supplier.id, after_data: JSON.stringify({ openingBalance }) });
  }
  return supplier;
}

export function updateSupplier(id: number, data: Partial<Supplier>): void {
  const s = store.suppliers.find(s => s.id === id);
  if (s) Object.assign(s, data);
}

export function deleteSupplier(id: number): void {
  store.suppliers = store.suppliers.filter(s => s.id !== id);
}

export function recordSupplierPayment(supplier_id: number, amount: number, note?: string, cashbox_id: CashboxId = 'daily', payment_method = 'نقداً'): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ الصرف غير صالح');
  const supplier = store.suppliers.find(s => s.id === supplier_id);
  if (!supplier) throw new Error('المورد غير موجود');
  supplier.balance -= amount;
  store.supplierTransactions.push({
    id: ids.supplierTx++,
    supplier_id,
    type: 'payment',
    amount: -amount,
    balance_after: supplier.balance,
    reference_id: null,
    note: `${payment_method} — ${note ?? 'دفعة للمورد'}`,
    date: today(),
    created_at: now(),
  });
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'SUPPLIER_PAYMENT',
    amount: -amount,
    cashbox_id,
    reference_type: 'supplier_payment',
    reference_id: supplier_id,
    shift_id: null,
    note: `دفعة لـ ${supplier.name} — ${payment_method}${note ? ` — ${note}` : ''}`,
    user_id: null,
    date: today(),
    created_at: now(),
  });
  addAuditLog({ action: 'SUPPLIER_PAYMENT', entity: 'supplier', entity_id: supplier_id,
    after_data: JSON.stringify({ amount, balance: supplier.balance }) });
}

export function getSupplierTransactions(supplier_id: number): SupplierTransaction[] {
  return store.supplierTransactions
    .filter(t => t.supplier_id === supplier_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// EXPENSES — ATOMIC
// ═══════════════════════════════════════════════════════════

export function addExpense(data: {
  category: string; amount: number; date?: string;
  shift_id?: number | null; note?: string; user_id?: number | null; cashbox_id?: CashboxId;
}): Expense {
  const expenseDate = data.date || today();
  const expense: Expense = {
    id: ids.expenses++,
    category: data.category,
    amount: data.amount,
    date: expenseDate,
    shift_id: data.shift_id ?? null,
    note: data.note ?? null,
    user_id: data.user_id ?? null,
    cashbox_id: data.cashbox_id ?? 'daily',
    created_at: now(),
  };
  store.expenses.push(expense);

  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'EXPENSE',
    amount: -data.amount,
    cashbox_id: data.cashbox_id ?? 'daily',
    reference_type: 'expense',
    reference_id: expense.id,
    shift_id: data.shift_id ?? null,
    note: `${data.category}: ${data.note || ''}`,
    user_id: data.user_id ?? null,
    date: expenseDate,
    created_at: now(),
  });

  if (data.shift_id) {
    const shift = store.shifts.find(s => s.id === data.shift_id);
    if (shift) shift.total_expenses += data.amount;
  }

  addAuditLog({ action: 'EXPENSE_CREATE', entity: 'expense', entity_id: expense.id,
    after_data: JSON.stringify({ category: data.category, amount: data.amount }) });

  return expense;
}

export function getExpenses(opts?: {
  date?: string; dateFrom?: string; dateTo?: string; category?: string;
}): Expense[] {
  let result = [...store.expenses];
  if (opts?.date) result = result.filter(e => e.date === opts.date);
  if (opts?.dateFrom) result = result.filter(e => e.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(e => e.date <= opts.dateTo!);
  if (opts?.category) result = result.filter(e => e.category === opts.category);
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteExpense(id: number): void {
  const exp = store.expenses.find(e => e.id === id);
  if (!exp) return;
  store.expenses = store.expenses.filter(e => e.id !== id);
  store.cashTransactions = store.cashTransactions.filter(
    t => !(t.reference_type === 'expense' && t.reference_id === id)
  );
  addAuditLog({ action: 'EXPENSE_DELETE', entity: 'expense', entity_id: id });
}

export function getExpenseCategories(): string[] {
  const defaultCats = ['إيجار', 'رواتب', 'مرافق', 'صيانة', 'مستلزمات', 'مواصلات', 'تسويق', 'أخرى'];
  const existing = new Set(store.expenses.map(e => e.category));
  return [...new Set([...defaultCats, ...existing])];
}

export function getExpensesByCategory(dateFrom: string, dateTo: string): { category: string; total: number }[] {
  const map: Record<string, number> = {};
  store.expenses
    .filter(e => e.date >= dateFrom && e.date <= dateTo)
    .forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
  return Object.entries(map)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// ═══════════════════════════════════════════════════════════
// CASHBOX
// ═══════════════════════════════════════════════════════════

export interface CashboxBalance {
  id: CashboxId;
  label: string;
  shortLabel: string;
  balance: number;
  openingBalance: number;
}

export type CashboxMutationResult = { success: true } | { success: false; error: string };

function transactionCashboxId(transaction: CashTransaction): CashboxId {
  return transaction.cashbox_id ?? 'daily';
}

function appendCashboxTransaction(data: {
  type: CashTransaction['type']; amount: number; cashbox_id: CashboxId; note: string;
  user_id?: number; reference_type?: string | null; reference_id?: number | null; shift_id?: number | null;
}): CashTransaction {
  const transaction: CashTransaction = {
    id: ids.cashTx++, type: data.type, amount: data.amount, cashbox_id: data.cashbox_id,
    reference_type: data.reference_type ?? null, reference_id: data.reference_id ?? null,
    shift_id: data.shift_id ?? null, note: data.note, user_id: data.user_id ?? null,
    date: today(), created_at: now(),
  };
  store.cashTransactions.push(transaction);
  return transaction;
}

/** With no id this retains the legacy behavior and returns the sum of every cashbox. */
export function getCashBalance(cashboxId?: CashboxId): number {
  return store.cashTransactions
    .filter(transaction => cashboxId === undefined || transactionCashboxId(transaction) === cashboxId)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function getCashboxOpeningBalance(cashboxId: CashboxId): number {
  return store.cashTransactions
    .filter(transaction => transaction.type === 'OPENING' && transactionCashboxId(transaction) === cashboxId)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function getCashboxBalances(): CashboxBalance[] {
  return CASHBOXES.map(box => ({
    ...box,
    balance: getCashBalance(box.id),
    openingBalance: getCashboxOpeningBalance(box.id),
  }));
}

export function getCashTransactions(opts?: {
  dateFrom?: string; dateTo?: string; type?: string; limit?: number;
  cashboxId?: CashboxId; direction?: 'in' | 'out'; search?: string;
}): CashTransaction[] {
  let result = [...store.cashTransactions];
  if (opts?.dateFrom) result = result.filter(transaction => transaction.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(transaction => transaction.date <= opts.dateTo!);
  if (opts?.type) result = result.filter(transaction => transaction.type === opts.type);
  if (opts?.cashboxId) result = result.filter(transaction => transactionCashboxId(transaction) === opts.cashboxId);
  if (opts?.direction === 'in') result = result.filter(transaction => transaction.amount > 0);
  if (opts?.direction === 'out') result = result.filter(transaction => transaction.amount < 0);
  if (opts?.search?.trim()) {
    const query = opts.search.trim().toLocaleLowerCase('ar');
    result = result.filter(transaction => [
      transaction.id, transaction.reference_id ?? '', transaction.note ?? '', transaction.type,
      CASHBOXES.find(box => box.id === transactionCashboxId(transaction))?.label ?? '',
    ].some(value => String(value).toLocaleLowerCase('ar').includes(query)));
  }
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function addCashDeposit(amount: number, note: string, user_id?: number, cashboxId: CashboxId = 'daily'): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  appendCashboxTransaction({ type: 'DEPOSIT', amount, cashbox_id: cashboxId, note, user_id });
  persistStore();
}

export function addCashWithdrawal(amount: number, note: string, user_id?: number, cashboxId: CashboxId = 'daily'): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  appendCashboxTransaction({ type: 'WITHDRAWAL', amount: -amount, cashbox_id: cashboxId, note, user_id });
  persistStore();
}

export function addCashboxOpeningBalance(amount: number, cashboxId: CashboxId, note: string, user_id?: number): CashboxMutationResult {
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'أدخل رصيدًا افتتاحيًا أكبر من صفر.' };
  const alreadyHasActivity = store.cashTransactions.some(transaction =>
    transaction.amount !== 0 && transactionCashboxId(transaction) === cashboxId,
  );
  if (alreadyHasActivity) return { success: false, error: 'يسجل الرصيد الافتتاحي قبل أول حركة فقط. استخدم سند قبض أو سند صرف لإضافة حركة لاحقة.' };
  appendCashboxTransaction({ type: 'OPENING', amount, cashbox_id: cashboxId, note, user_id });
  addAuditLog({ action: 'CASHBOX_OPENING_BALANCE', entity: 'cashbox', entity_id: null,
    after_data: JSON.stringify({ cashboxId, amount, note }) });
  persistStore();
  return { success: true };
}

export function addCashboxReceipt(amount: number, cashboxId: CashboxId, note: string, user_id?: number): CashboxMutationResult {
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'أدخل مبلغ سند قبض صحيحًا.' };
  const transaction = appendCashboxTransaction({
    type: 'RECEIPT', amount, cashbox_id: cashboxId, note, user_id, reference_type: 'cash_receipt',
  });
  addAuditLog({ action: 'CASHBOX_RECEIPT', entity: 'cashbox', entity_id: transaction.id,
    after_data: JSON.stringify({ cashboxId, amount, note }) });
  persistStore();
  return { success: true };
}

export function addCashboxPayment(amount: number, cashboxId: CashboxId, note: string, user_id?: number): CashboxMutationResult {
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'أدخل مبلغ سند صرف صحيحًا.' };
  if (getCashBalance(cashboxId) < amount) return { success: false, error: 'رصيد الصندوق المحدد لا يكفي لهذا الصرف.' };
  const transaction = appendCashboxTransaction({
    type: 'PAYMENT', amount: -amount, cashbox_id: cashboxId, note, user_id, reference_type: 'cash_payment',
  });
  addAuditLog({ action: 'CASHBOX_PAYMENT', entity: 'cashbox', entity_id: transaction.id,
    after_data: JSON.stringify({ cashboxId, amount, note }) });
  persistStore();
  return { success: true };
}

export function transferCashBetweenBoxes(
  sourceId: CashboxId, destinationId: CashboxId, amount: number, note: string, user_id?: number,
): CashboxMutationResult {
  if (sourceId === destinationId) return { success: false, error: 'اختر صندوقين مختلفين للتحويل.' };
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'أدخل مبلغ تحويل صحيحًا.' };
  if (getCashBalance(sourceId) < amount) return { success: false, error: 'الرصيد المتاح في الصندوق المصدر لا يكفي.' };
  try {
    return commitReturnAtomically(() => {
      const transferReference = ids.cashTx;
      const source = CASHBOXES.find(box => box.id === sourceId)!.label;
      const destination = CASHBOXES.find(box => box.id === destinationId)!.label;
      appendCashboxTransaction({
        type: 'TRANSFER_OUT', amount: -amount, cashbox_id: sourceId, note: `تحويل إلى ${destination}${note ? ` — ${note}` : ''}`,
        user_id, reference_type: 'cash_transfer', reference_id: transferReference,
      });
      appendCashboxTransaction({
        type: 'TRANSFER_IN', amount, cashbox_id: destinationId, note: `تحويل من ${source}${note ? ` — ${note}` : ''}`,
        user_id, reference_type: 'cash_transfer', reference_id: transferReference,
      });
      addAuditLog({ action: 'CASHBOX_TRANSFER', entity: 'cashbox', entity_id: transferReference,
        after_data: JSON.stringify({ sourceId, destinationId, amount, note }) });
      persistStore();
      return { success: true };
    });
  } catch {
    return { success: false, error: 'تعذر تسجيل التحويل؛ لم يتغير رصيد أي صندوق.' };
  }
}

export type CashboxCloseResult =
  | { success: true; expectedCash: number; actualCash: number; difference: number; shiftClosed: boolean }
  | { success: false; error: string };

/** Stores a zero-value closing snapshot; cash is not silently adjusted to the counted amount. */
export function closeCashboxDay(actualCash: number, note = '', user_id?: number): CashboxCloseResult {
  if (!Number.isFinite(actualCash) || actualCash < 0) return { success: false, error: 'أدخل رصيدًا فعليًا صحيحًا لا يقل عن صفر.' };
  const expectedCash = getCashBalance('daily');
  try {
    return commitReturnAtomically(() => {
      const activeShift = getOpenShift();
      if (activeShift && !closeShift(activeShift.id, actualCash, note || undefined)) {
        throw new Error('تعذر إقفال الوردية المفتوحة.');
      }
      const difference = actualCash - expectedCash;
      appendCashboxTransaction({
        type: 'CLOSING', amount: 0, cashbox_id: 'daily',
        note: `إقفال صندوق اليومية — المتوقع ${expectedCash}، الفعلي ${actualCash}، الفرق ${difference}${note ? ` — ${note}` : ''}`,
        user_id, reference_type: 'cashbox_close', reference_id: activeShift?.id ?? null,
        shift_id: activeShift?.id ?? null,
      });
      addAuditLog({ action: 'CASHBOX_DAILY_CLOSE', entity: 'cashbox', entity_id: activeShift?.id ?? null,
        after_data: JSON.stringify({ expectedCash, actualCash, difference, note, shiftClosed: Boolean(activeShift) }) });
      persistStore();
      return { success: true, expectedCash, actualCash, difference, shiftClosed: Boolean(activeShift) };
    });
  } catch {
    return { success: false, error: 'تعذر حفظ الإقفال؛ لم يتغير رصيد الصندوق.' };
  }
}

// ═══════════════════════════════════════════════════════════
// SHIFTS
// ═══════════════════════════════════════════════════════════

export function openShift(data: {
  user_id?: number; user_name?: string; opening_cash: number;
}): Shift {
  const shift: Shift = {
    id: ids.shifts++,
    user_id: data.user_id ?? null,
    user_name: data.user_name ?? null,
    opening_cash: data.opening_cash,
    expected_cash: data.opening_cash,
    actual_cash: null,
    difference: null,
    difference_reason: null,
    total_sales: 0,
    total_collections: 0,
    total_expenses: 0,
    total_purchases_paid: 0,
    status: 'OPEN',
    opened_at: now(),
    closed_at: null,
    notes: null,
  };
  store.shifts.push(shift);

  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'OPENING',
    amount: 0, // opening_cash already in balance
    cashbox_id: 'daily',
    reference_type: 'shift',
    reference_id: shift.id,
    shift_id: shift.id,
    note: `فتح وردية - رصيد ${data.opening_cash}`,
    user_id: data.user_id ?? null,
    date: today(),
    created_at: now(),
  });

  return shift;
}

export function closeShift(id: number, actual_cash: number, reason?: string): Shift | null {
  const shift = store.shifts.find(s => s.id === id);
  if (!shift || shift.status !== 'OPEN') return null;

  shift.actual_cash = actual_cash;
  shift.expected_cash = getCashBalance('daily');
  shift.difference = actual_cash - shift.expected_cash;
  shift.difference_reason = reason ?? null;
  shift.status = 'CLOSED';
  shift.closed_at = now();

  addAuditLog({ action: 'SHIFT_CLOSE', entity: 'shift', entity_id: id,
    after_data: JSON.stringify({ actual: actual_cash, expected: shift.expected_cash, diff: shift.difference }) });

  return shift;
}

export function getShifts(limit?: number): Shift[] {
  const result = [...store.shifts].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  return limit ? result.slice(0, limit) : result;
}

export function getOpenShift(): Shift | null {
  return store.shifts.find(s => s.status === 'OPEN') ?? null;
}

// ═══════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════

export function getReportSummary(dateFrom: string, dateTo: string): ReportSummary {
  const sales = getSales({ dateFrom, dateTo });
  const expenses = getExpenses({ dateFrom, dateTo });
  const saleReturns = store.saleReturns.filter(entry => entry.status !== 'CANCELLED' && entry.date >= dateFrom && entry.date <= dateTo);
  const purchaseReturns = store.purchaseReturns.filter(entry => entry.status !== 'CANCELLED' && entry.date >= dateFrom && entry.date <= dateTo);

  // Mixed invoices must contribute their actually paid portion to cash sales and
  // their outstanding portion to credit sales; excluding them understated revenue.
  const grossCashSales = sales.reduce((sum, sale) => {
    if (sale.sale_type === 'cash') return sum + sale.total;
    if (sale.sale_type === 'mixed') return sum + sale.amount_paid;
    return sum;
  }, 0);
  const grossCreditSales = sales.reduce((sum, sale) => {
    if (sale.sale_type === 'credit') return sum + sale.total;
    if (sale.sale_type === 'mixed') return sum + sale.remaining;
    return sum;
  }, 0);
  const cashSales = grossCashSales - saleReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const creditSales = grossCreditSales - saleReturns.reduce((sum, entry) => sum + entry.credit_reduction, 0);
  const collections = store.cashTransactions
    .filter(t => t.type === 'COLLECTION' && t.date >= dateFrom && t.date <= dateTo)
    .reduce((a, t) => a + t.amount, 0);
  const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const totalPurchases = getPurchases({ dateFrom, dateTo }).reduce((a, p) => a + p.total, 0) - purchaseReturns.reduce((sum, entry) => sum + entry.total, 0);
  const totalSales = cashSales + creditSales;
  const cogs = sales.reduce((a, s) => a + s.cogs, 0) - saleReturns.reduce((sum, entry) =>
    sum + entry.items.reduce((itemSum, item) => itemSum + item.returned_cogs, 0), 0);
  const purchaseRefunds = purchaseReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const customerRefunds = saleReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const paidPurchases = getPurchases({ dateFrom, dateTo }).reduce((sum, purchase) => sum + purchase.amount_paid, 0);

  return {
    cashSales,
    creditSales,
    totalSales,
    collections,
    totalExpenses,
    totalPurchases,
    cogs,
    grossProfit: totalSales - cogs,
    netCash: grossCashSales + collections - totalExpenses - paidPurchases - customerRefunds + purchaseRefunds,
    transactionCount: sales.length + saleReturns.length + purchaseReturns.length,
  };
}

export function getDashboardKpis(): DashboardKpis {
  const todayStr = today();
  const summary = getReportSummary(todayStr, todayStr);
  const openShift = getOpenShift();

  const lowStockCount = store.products.filter(p => {
    const qty = getProductStock(p.id);
    return qty > 0 && qty <= p.minimum_stock;
  }).length;

  const outOfStockCount = store.products.filter(p => getProductStock(p.id) === 0).length;
  const radar = getExpiryRadar();
  const expiredCount = radar.filter(r => r.group === 'expired').length;
  const expiringCount = radar.filter(r => r.group !== 'expired').length;

  return {
    todaySales: summary.totalSales,
    todayCashSales: summary.cashSales,
    todayCreditSales: summary.creditSales,
    todayCollections: summary.collections,
    todayExpenses: summary.totalExpenses,
    todayPurchases: summary.totalPurchases,
    todayGrossProfit: summary.grossProfit,
    cashBalance: getCashBalance(),
    totalCustomerDebt: store.customers.reduce((a, c) => a + Math.max(0, c.balance), 0),
    totalSupplierDebt: store.suppliers.reduce((a, s) => a + Math.max(0, s.balance), 0),
    lowStockCount,
    outOfStockCount,
    expiringCount,
    expiredCount,
    openShiftId: openShift?.id ?? null,
    recentSales: getSales({ limit: 8 }),
  };
}

// ═══════════════════════════════════════════════════════════
// STOCK ADJUSTMENTS
// ═══════════════════════════════════════════════════════════

export interface StocktakeCountInput {
  product_id: number;
  batch_id: number;
  actual_quantity: number;
}

/** Apply all stocktake differences as one atomic inventory transaction. */
export function applyStocktake(data: {
  counts: StocktakeCountInput[];
  user_id?: number | null;
  reason: string;
}, actor?: User | null): { success: true; applied: number } | { success: false; error: string } {
  const denied = checkPermission(actor, 'inventory.adjust', 'batch');
  if (denied) return { success: false, error: denied };
  if (!Array.isArray(data.counts) || data.counts.length === 0) {
    return { success: false, error: 'لا توجد كميات جرد لاعتمادها' };
  }
  if (!data.reason?.trim()) return { success: false, error: 'أدخل سبب الجرد' };
  const seen = new Set<number>();
  const rows: { product: Product; batch: Batch; actual: number; diff: number }[] = [];
  for (const count of data.counts) {
    if (seen.has(count.batch_id)) return { success: false, error: 'توجد دفعة مكررة في قائمة الجرد' };
    seen.add(count.batch_id);
    const product = getProduct(count.product_id);
    const batch = store.batches.find(entry => entry.id === count.batch_id);
    if (!product || !batch || batch.product_id !== product.id) {
      return { success: false, error: 'إحدى دفعات الجرد غير موجودة أو لا تطابق الصنف' };
    }
    if (batch.status !== 'ACTIVE') return { success: false, error: 'لا يمكن جرد دفعة غير نشطة أو مسحوبة' };
    if (!Number.isFinite(count.actual_quantity) || count.actual_quantity < 0) {
      return { success: false, error: 'توجد كمية فعلية غير صحيحة أو سالبة' };
    }
    rows.push({ product, batch, actual: count.actual_quantity, diff: count.actual_quantity - batch.quantity });
  }
  const changed = rows.filter(row => Math.abs(row.diff) > 1e-8);
  if (!changed.length) return { success: true, applied: 0 };
  return commitReturnAtomically(() => {
    for (const row of changed) {
      const beforeQuantity = row.batch.quantity;
      row.batch.quantity = row.actual;
      if (row.batch.quantity <= 1e-8) row.batch.status = 'DEPLETED';
      store.stockMovements.push({
        id: ids.stockMovements++, product_id: row.product.id, batch_id: row.batch.id,
        type: row.diff > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity: row.diff, unit: row.product.inventory_unit,
        quantity_in_inventory_unit: row.diff, reference_type: 'stocktake',
        reference_id: null,
        note: `${data.reason.trim()}: رصيد النظام ${beforeQuantity}، الرصيد الفعلي ${row.actual}`,
        user_id: data.user_id ?? null, created_at: now(),
      });
      addAuditLog({
        action: 'STOCKTAKE_APPLY', entity: 'batch', entity_id: row.batch.id,
        user_id: data.user_id ?? null,
        before_data: JSON.stringify({ quantity: beforeQuantity, status: 'ACTIVE' }),
        after_data: JSON.stringify({ quantity: row.batch.quantity, status: row.batch.status, reason: data.reason.trim() }),
      });
    }
    return { success: true as const, applied: changed.length };
  });
}

export function adjustStock(data: {
  product_id: number; batch_id: number; quantity_change: number;
  type: TransactionType; note: string; user_id?: number;
}, actor?: User | null): { success: boolean; error?: string } {
  const denied = checkPermission(actor, 'inventory.adjust', 'batch');
  if (denied) return { success: false, error: denied };
  const product = getProduct(data.product_id);
  const batch = store.batches.find(b => b.id === data.batch_id);
  if (!product || !batch || batch.product_id !== product.id) {
    return { success: false, error: 'الصنف أو الدفعة غير موجودة' };
  }
  if (!Number.isFinite(data.quantity_change) || data.quantity_change === 0) {
    return { success: false, error: 'أدخل كمية صحيحة لا تساوي صفراً' };
  }
  const allowedType = data.quantity_change > 0
    ? data.type === 'ADJUSTMENT_IN'
    : ['ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRED', 'WRITE_OFF'].includes(data.type);
  if (!allowedType) return { success: false, error: 'نوع الحركة لا يتوافق مع اتجاه الكمية' };
  if (batch.status !== 'ACTIVE') return { success: false, error: 'لا يمكن تعديل دفعة غير نشطة أو مسحوبة' };
  if (data.quantity_change < 0 && batch.quantity + data.quantity_change < -1e-8) {
    return { success: false, error: 'الكمية المطلوب خصمها أكبر من رصيد الدفعة' };
  }
  if (!data.note?.trim()) return { success: false, error: 'اكتب سبب تسوية المخزون' };

  const result = withAtomicMutation(
    () => JSON.stringify({ store, ids, invoiceCounter }),
    (serialized) => {
      const snapshot = JSON.parse(serialized) as { store: typeof store; ids: typeof ids; invoiceCounter: number };
      Object.keys(store).forEach(key => { (store as any)[key] = (snapshot.store as any)[key]; });
      Object.assign(ids, snapshot.ids);
      invoiceCounter = snapshot.invoiceCounter;
    },
    () => {
      const beforeQuantity = batch.quantity;
      batch.quantity = Math.max(0, beforeQuantity + data.quantity_change);
      if (batch.quantity <= 1e-8) batch.status = 'DEPLETED';
      store.stockMovements.push({
        id: ids.stockMovements++,
        product_id: data.product_id,
        batch_id: data.batch_id,
        type: data.type,
        quantity: data.quantity_change,
        unit: product.inventory_unit,
        quantity_in_inventory_unit: data.quantity_change,
        reference_type: 'adjustment',
        reference_id: null,
        note: data.note.trim(),
        user_id: data.user_id ?? null,
        created_at: now(),
      });
      addAuditLog({ action: 'STOCK_ADJUST', entity: 'batch', entity_id: data.batch_id,
        user_id: data.user_id ?? null,
        before_data: JSON.stringify({ qty: beforeQuantity }),
        after_data: JSON.stringify({ qty: batch.quantity, note: data.note.trim(), type: data.type, change: data.quantity_change }) });
      return { success: true as const };
    },
    persistStore,
  );
  persistStore();
  return result;
}

export function getStockMovements(product_id: number): StockMovement[] {
  return store.stockMovements
    .filter(m => m.product_id === product_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════

function addAuditLog(data: {
  action: string; entity: string; entity_id?: number | null;
  user_id?: number | null; user_name?: string | null;
  before_data?: string | null; after_data?: string | null;
  reason?: string | null;
}): void {
  store.auditLogs.push({
    id: ids.auditLogs++,
    user_id: data.user_id ?? null,
    user_name: data.user_name ?? null,
    action: data.action,
    entity: data.entity,
    entity_id: data.entity_id ?? null,
    before_data: data.before_data ?? null,
    after_data: data.after_data ?? null,
    reason: data.reason ?? null,
    ip: null,
    created_at: now(),
  });
  persistStore();
}

export function getAuditLogs(opts?: { limit?: number; entity?: string }): AuditLog[] {
  let result = [...store.auditLogs];
  if (opts?.entity) result = result.filter(l => l.entity === opts.entity);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

// ═══════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════════════════════

export interface BackupData {
  schema_version: string;
  created_at: string;
  pharmacy_name: string;
  settings: Record<string, string>;
  /** Next-id counters, so a restore does not reuse identifiers. Optional in older backups. */
  ids?: Record<string, number>;
  /** Last invoice counter value (the number inside INV-######). Optional in older backups. */
  invoice_counter?: number;
  products: Product[];
  productUnits: ProductUnit[];
  batches: Batch[];
  stockMovements: StockMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  saleItems: SaleItem[];
  saleBatchAllocations: SaleBatchAllocation[];
  saleReturns: SaleReturn[];
  purchases: Purchase[];
  purchaseItems: PurchaseItem[];
  purchaseReturns: PurchaseReturn[];
  expenses: Expense[];
  cashTransactions: CashTransaction[];
  shifts: Shift[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  auditLogs: AuditLog[];
}

export function createBackup(actor?: User | null): BackupData {
  const denied = checkPermission(actor, 'system.backup', 'backup');
  if (denied) throw new Error(denied);
  // Device-local access controls must never be exported to a shareable backup.
  const backupSettings = { ...store.settings };
  delete backupSettings.pin_code;
  delete backupSettings.pin_enabled;
  return {
    schema_version: '1.1.0',
    created_at: now(),
    pharmacy_name: store.settings['pharmacy_name'] || '',
    settings: backupSettings,
    ids: { ...ids },
    invoice_counter: invoiceCounter,
    products: [...store.products],
    productUnits: [...store.productUnits],
    batches: [...store.batches],
    stockMovements: [...store.stockMovements],
    customers: [...store.customers],
    suppliers: [...store.suppliers],
    sales: [...store.sales],
    saleItems: [...store.saleItems],
    saleBatchAllocations: [...store.saleBatchAllocations],
    saleReturns: [...store.saleReturns],
    purchases: [...store.purchases],
    purchaseItems: [...store.purchaseItems],
    purchaseReturns: [...store.purchaseReturns],
    expenses: [...store.expenses],
    cashTransactions: [...store.cashTransactions],
    shifts: [...store.shifts],
    customerTransactions: [...store.customerTransactions],
    supplierTransactions: [...store.supplierTransactions],
    auditLogs: [...store.auditLogs],
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function maxIdOf(rows: readonly { id: number }[] | undefined): number {
  if (!rows) return 0;
  return rows.reduce((max, row) => (typeof row?.id === 'number' && Number.isFinite(row.id) ? Math.max(max, row.id) : max), 0);
}

function maxInvoiceNumberFromSales(): number {
  let max = 0;
  for (const sale of store.sales) {
    const match = /^INV-(\d+)$/.exec(sale.invoice_number || '');
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

/**
 * Recompute every next-id counter from the restored collections (max(id) + 1)
 * and set the invoice counter to at least the largest INV-###### in the
 * restored sales. Used when a backup carries no (or invalid) counters.
 * Nested return-item ids are recomputed from the items embedded in returns.
 */
function recomputeCountersFromRestoredData(): void {
  const counterFor: [keyof typeof ids, readonly { id: number }[]][] = [
    ['products', store.products],
    ['productUnits', store.productUnits],
    ['batches', store.batches],
    ['stockMovements', store.stockMovements],
    ['customers', store.customers],
    ['suppliers', store.suppliers],
    ['sales', store.sales],
    ['saleItems', store.saleItems],
    ['saleAllocations', store.saleBatchAllocations],
    ['saleReturns', store.saleReturns],
    ['purchases', store.purchases],
    ['purchaseItems', store.purchaseItems],
    ['purchaseReturns', store.purchaseReturns],
    ['expenses', store.expenses],
    ['cashTx', store.cashTransactions],
    ['shifts', store.shifts],
    ['customerTx', store.customerTransactions],
    ['supplierTx', store.supplierTransactions],
    ['auditLogs', store.auditLogs],
  ];
  for (const [counter, rows] of counterFor) {
    ids[counter] = maxIdOf(rows) + 1;
  }
  ids.saleReturnItems = store.saleReturns.flatMap(entry => entry.items || []).reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  ids.purchaseReturnItems = store.purchaseReturns.flatMap(entry => entry.items || []).reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  invoiceCounter = Math.max(1000, maxInvoiceNumberFromSales());
}

export async function restoreBackup(data: BackupData, actor?: User | null): Promise<{ success: boolean; error?: string }> {
  const denied = checkPermission(actor, 'system.backup', 'backup');
  if (denied) return { success: false, error: denied };
  const collectionKeys = [
    'products', 'productUnits', 'batches', 'stockMovements', 'customers', 'suppliers',
    'sales', 'saleItems', 'saleBatchAllocations', 'saleReturns', 'purchases',
    'purchaseItems', 'purchaseReturns', 'expenses', 'cashTransactions', 'shifts',
    'customerTransactions', 'supplierTransactions', 'auditLogs',
  ] as const;

  // Validate the entire envelope before touching live in-memory state.
  if (!data || typeof data !== 'object' || typeof data.schema_version !== 'string' || !data.schema_version.trim()) {
    return { success: false, error: 'نسخة احتياطية غير صالحة' };
  }
  if (data.settings !== undefined && (
    !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
    Object.values(data.settings).some(value => typeof value !== 'string')
  )) {
    return { success: false, error: 'إعدادات النسخة الاحتياطية غير صالحة' };
  }
  for (const key of collectionKeys) {
    const rows = (data as any)[key];
    // Require every collection emitted by the current backup schema; accepting
    // missing arrays would silently interpret a partial file as empty inventory.
    if (!Array.isArray(rows) || rows.some((row: unknown) =>
      !row || typeof row !== 'object' || Array.isArray(row)
    )) {
      return { success: false, error: `بيانات غير مكتملة أو غير صالحة في: ${key}` };
    }
  }

  const previousStore = JSON.parse(JSON.stringify(store)) as typeof store;
  const previousIds = { ...ids };
  const previousInvoiceCounter = invoiceCounter;
  try {
    // A backup may restore business settings, but cannot replace this device's PIN state.
    const safeSettings = { ...(data.settings || {}) };
    delete safeSettings.pin_code;
    delete safeSettings.pin_enabled;
    Object.assign(store.settings, safeSettings);
    store.products = data.products || [];
    store.productUnits = data.productUnits || [];
    store.batches = data.batches || [];
    store.stockMovements = data.stockMovements || [];
    store.customers = data.customers || [];
    store.suppliers = data.suppliers || [];
    store.sales = data.sales || [];
    store.saleItems = data.saleItems || [];
    store.saleBatchAllocations = data.saleBatchAllocations || [];
    store.saleReturns = data.saleReturns || [];
    store.purchases = data.purchases || [];
    store.purchaseItems = data.purchaseItems || [];
    store.purchaseReturns = data.purchaseReturns || [];
    store.expenses = data.expenses || [];
    store.cashTransactions = data.cashTransactions || [];
    store.shifts = data.shifts || [];
    store.customerTransactions = data.customerTransactions || [];
    store.supplierTransactions = data.supplierTransactions || [];
    store.auditLogs = data.auditLogs || [];
    // Restore the next-id counters when the backup carries them (and every
    // supplied value is a known, positive integer); otherwise recompute
    // each counter from max(id) + 1 of the restored collections. The
    // invoice counter is likewise restored when valid, else set to at
    // least the largest INV-###### among the restored sales.
    const suppliedIds = data.ids;
    const hasValidIds = !!suppliedIds && typeof suppliedIds === 'object' && !Array.isArray(suppliedIds)
      && Object.entries(suppliedIds).every(([key, value]) => key in ids && isPositiveInteger(value));
    if (hasValidIds) {
      Object.assign(ids, suppliedIds);
    } else {
      recomputeCountersFromRestoredData();
    }
    if (isPositiveInteger(data.invoice_counter)) {
      invoiceCounter = data.invoice_counter;
    } else if (hasValidIds) {
      invoiceCounter = Math.max(invoiceCounter, maxInvoiceNumberFromSales());
    }
    // Persist the restored counters (and the RESTORE audit entry below)
    // before reporting success.
    addAuditLog({ action: 'RESTORE', entity: 'backup', entity_id: null,
      after_data: JSON.stringify({ from: data.created_at }) });
    persistStore();
    // Do not report a successful restore until the resulting snapshot is durable.
    await flushDatabaseWrites();
    return { success: true };
  } catch (e: any) {
    Object.keys(previousStore).forEach(key => {
      (store as any)[key] = (previousStore as any)[key];
    });
    Object.assign(ids, previousIds);
    invoiceCounter = previousInvoiceCounter;
    return { success: false, error: e?.message || 'فشلت الاستعادة' };
  }
}

// ═══════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY (for existing screens)
// ═══════════════════════════════════════════════════════════

export interface Transaction {
  id: number; type: string; amount: number; date: string;
  customer_id: number | null; supplier_id: number | null;
  customer_name?: string; supplier_name?: string;
  note: string | null; invoice_number: string | null;
  discount: number; amount_paid: number; created_at: string;
}

export interface DashboardData {
  cashSales: number; creditSales: number; totalSales: number;
  collections: number; expenses: number; purchases: number;
  balance: number; recentTransactions: Transaction[];
}

export function getDashboardData(date: string): DashboardData {
  const summary = getReportSummary(date, date);
  const recentSales = getSales({ dateFrom: date, dateTo: date, limit: 10 });
  const recentTx: Transaction[] = recentSales.map(s => ({
    id: s.id,
    type: s.sale_type === 'cash' ? 'cash_sale' : 'credit_sale',
    amount: s.total,
    date: s.date,
    customer_id: s.customer_id,
    supplier_id: null,
    customer_name: s.customer_name ?? undefined,
    supplier_name: undefined,
    note: s.notes,
    invoice_number: s.invoice_number,
    discount: s.discount,
    amount_paid: s.amount_paid,
    created_at: s.created_at,
  }));

  return {
    cashSales: summary.cashSales,
    creditSales: summary.creditSales,
    totalSales: summary.totalSales,
    collections: summary.collections,
    expenses: summary.totalExpenses,
    purchases: summary.totalPurchases,
    balance: getCashBalance(),
    recentTransactions: recentTx,
  };
}

export function addTransaction(data: any): number {
  // Legacy bridge for old screens
  if (data.type === 'expense') {
    const exp = addExpense({ category: 'أخرى', amount: data.amount, date: data.date, note: data.note });
    return exp.id;
  }
  return 0;
}

export function getTransactions(filters?: any): Transaction[] {
  return [];
}

export function deleteTransaction(id: number): void {}

export function getTransactionItems(id: number): any[] { return []; }


export interface DatabaseIntegrityIssue {
  code: string;
  severity: 'error' | 'warning';
  count: number;
  message: string;
}
export interface DatabaseIntegrityReport {
  checked_at: string;
  counts: Record<string, number>;
  issues: DatabaseIntegrityIssue[];
  repaired: number;
}

/**
 * Read-only integrity scan by default. Safe repair only updates derived batch
 * status when a batch has no quantity or its recorded expiry date has passed.
 * It never deletes rows, changes quantities, or edits financial transactions.
 */
export function inspectAndRepairDatabase(repair = false): DatabaseIntegrityReport {
  const issues: DatabaseIntegrityIssue[] = [];
  let repaired = 0;
  const productIds = new Set<number>();
  const duplicateProductIds = new Set<number>();
  for (const product of store.products) {
    if (productIds.has(product.id)) duplicateProductIds.add(product.id);
    productIds.add(product.id);
  }
  const batchIds = new Set<number>();
  const duplicateBatchIds = new Set<number>();
  const missingProductBatches = store.batches.filter(batch => !productIds.has(batch.product_id));
  const invalidBatchQuantities = store.batches.filter(batch => !Number.isFinite(batch.quantity) || batch.quantity < 0);
  const movementMissingBatch = store.stockMovements.filter(movement => !store.batches.some(batch => batch.id === movement.batch_id));
  const movementMissingProduct = store.stockMovements.filter(movement => !productIds.has(movement.product_id));
  const invalidUnits = store.productUnits.filter(unit => !productIds.has(unit.product_id) || !Number.isFinite(unit.conversion_factor) || unit.conversion_factor <= 0);
  const usernameCounts = new Map<string, number>();
  store.users.forEach(user => usernameCounts.set(user.username.trim().toLowerCase(), (usernameCounts.get(user.username.trim().toLowerCase()) || 0) + 1));
  const duplicateUsernames = [...usernameCounts.values()].filter(count => count > 1).reduce((sum, count) => sum + count, 0);

  for (const batch of store.batches) {
    if (batchIds.has(batch.id)) duplicateBatchIds.add(batch.id);
    batchIds.add(batch.id);
    if (!repair || batch.status === 'RECALLED') continue;
    let targetStatus: BatchStatus | null = null;
    if (Number.isFinite(batch.quantity) && batch.quantity <= 1e-8 && batch.status !== 'DEPLETED') targetStatus = 'DEPLETED';
    else if (batch.status === 'ACTIVE' && !!batch.expiry_date && batch.expiry_date <= today()) targetStatus = 'EXPIRED';
    if (targetStatus && targetStatus !== batch.status) {
      const previousStatus = batch.status;
      batch.status = targetStatus;
      repaired += 1;
      addAuditLog({
        action: 'DATABASE_SAFE_REPAIR', entity: 'batch', entity_id: batch.id,
        before_data: JSON.stringify({ status: previousStatus }),
        after_data: JSON.stringify({ status: targetStatus, quantity: batch.quantity, expiry_date: batch.expiry_date }),
        reason: 'تصحيح حالة مشتقة فقط؛ لم تتغير الكمية أو المعاملات المالية',
      });
    }
  }
  if (repaired > 0) persistStore();

  const addIssue = (code: string, severity: 'error' | 'warning', count: number, message: string) => {
    if (count > 0) issues.push({ code, severity, count, message });
  };
  addIssue('duplicate_products', 'error', duplicateProductIds.size, 'معرّفات أصناف مكررة');
  addIssue('duplicate_batches', 'error', duplicateBatchIds.size, 'معرّفات دفعات مكررة');
  addIssue('orphan_batches', 'error', missingProductBatches.length, 'دفعات مرتبطة بأصناف غير موجودة');
  addIssue('invalid_batch_quantity', 'error', invalidBatchQuantities.length, 'كميات دفعات سالبة أو غير رقمية؛ لم يتم تعديلها تلقائياً');
  addIssue('zero_quantity_status', 'warning', store.batches.filter(batch => batch.quantity <= 1e-8 && batch.status !== 'DEPLETED' && batch.status !== 'RECALLED').length, 'دفعات بلا رصيد لم تُحدّث حالتها بعد');
  addIssue('expired_active', 'warning', store.batches.filter(batch => batch.status === 'ACTIVE' && !!batch.expiry_date && batch.expiry_date <= today()).length, 'دفعات منتهية ما زالت نشطة');
  addIssue('movement_missing_batch', 'error', movementMissingBatch.length, 'حركات مخزون تشير إلى دفعات مفقودة');
  addIssue('movement_missing_product', 'error', movementMissingProduct.length, 'حركات مخزون تشير إلى أصناف مفقودة');
  addIssue('invalid_product_units', 'error', invalidUnits.length, 'وحدات تحويل غير صالحة أو مرتبطة بأصناف مفقودة');
  addIssue('duplicate_usernames', 'warning', duplicateUsernames, 'أسماء مستخدمين مكررة بعد تجاهل حالة الأحرف والمسافات');

  return {
    checked_at: now(),
    counts: {
      products: store.products.length, batches: store.batches.length,
      stockMovements: store.stockMovements.length, users: store.users.length,
      customers: store.customers.length, suppliers: store.suppliers.length,
      sales: store.sales.length, purchases: store.purchases.length,
      auditLogs: store.auditLogs.length,
    },
    issues, repaired,
  };
}
