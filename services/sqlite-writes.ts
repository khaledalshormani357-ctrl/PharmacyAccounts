// SQLite Phase 3 — SQL sale writer.
//
// The sale is the first write path that goes to SQL instead of the
// in-memory store. The design is plan-then-execute:
//
//   1. buildSaleWritePlan() — pure: re-validates the resolved sale
//      against the current state (credit limit, stock per batch) and
//      builds every row the sale will write, with ids reserved from the
//      live counters. It writes nothing.
//   2. executeSaleTransaction() — runs the whole plan inside one SQLite
//      transaction (BEGIN IMMEDIATE ... COMMIT, ROLLBACK on any failure):
//      counters are reserved in meta, batches are deducted with a guarded
//      UPDATE (quantity >= take, or the transaction aborts), and every row
//      is written to both the generic `collections` table and the typed
//      tables. The caller then applies the same rows to the in-memory
//      store and persists the diff (outbox + generic tables) as usual.
//
// The plan's rows are the single source of truth for the sale: the SQL
// transaction and the in-memory application use the same objects, so the
// two copies can never disagree about ids, invoice numbers or amounts.
//
// No silent fallback: if the SQL transaction fails, the sale fails. A
// fallback to the legacy path after a failed SQL write could sell twice
// (the transaction may have committed before the failure was observed).

import type {
  AuditLog,
  Batch,
  CashTransaction,
  Customer,
  CustomerTransaction,
  Sale,
  SaleBatchAllocation,
  SaleItem,
  Shift,
  StockMovement,
} from './erp-database';
import {
  applyDiffToGenericTables,
  applyDiffToTypedTables,
  migrateToTypedTables,
  type TypedDb,
} from './sqlite-typed';
import type { SnapshotDiff } from './sqlite-store';

// ─── UUID (mirrors generateSyncId in erp-database.ts) ────────────────

/** Generate a UUID v4. Uses crypto.randomUUID() when available; the
 * fallback keeps the same shape from time + randomness. */
function newSyncId(): string {
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

// ─── Plan types ─────────────────────────────────────────────────────

/** One FEFO allocation, as resolved by the caller (in-memory allocateFefo). */
export interface PlannedAllocation {
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
}

/** One sale line, already validated and resolved by the caller. The
 * money fields are computed once by the caller with the same formulas as
 * the legacy in-memory sale, so the two paths can never disagree. */
export interface PlannedSaleItem {
  product_id: number;
  product_name: string;
  inventory_unit: string;
  unit: string;
  quantity: number;
  qty_in_inv_unit: number;
  unit_price: number;
  discount: number;
  line_total: number;
  item_cogs: number;
  base_purchase_price: number;
  allocations: PlannedAllocation[];
}

/** Everything buildSaleWritePlan needs. `batches` are the live batch rows
 * the allocations draw from (copied, never mutated); `ids` and
 * `invoice_counter` are the live counters the plan reserves from. */
export interface SalePlanInput {
  sale_type: 'cash' | 'credit' | 'mixed';
  customer_id: number | null;
  customer_name: string | null;
  /** Customer row when a balance update applies, else null. */
  customer: Customer | null;
  /** New balance after this sale, or null when no balance update applies
   * (cash sale fully paid, or no customer). */
  customer_balance_after: number | null;
  /** Customer credit limit (0 or less = no limit); null when no customer. */
  customer_credit_limit: number | null;
  shift: Shift | null;
  user_id: number | null;
  notes: string | null;
  date: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change_given: number;
  remaining: number;
  total_cogs: number;
  items: PlannedSaleItem[];
  /** Live batch rows for every allocated batch. */
  batches: Batch[];
  ids: Record<string, number>;
  invoice_counter: number;
  /** created_at stamp ('YYYY-MM-DD HH:MM:SS', as now() in erp-database). */
  created_at: string;
  /** updatedAt stamp (full ISO, as isoNow() in erp-database). */
  updated_at_iso: string;
  device_id: string;
}

/** The complete, fully-resolved sale. Every row carries its final id,
 * syncId and timestamps; the executor writes exactly these rows. */
export interface SaleWritePlan {
  sale: Sale;
  saleItems: SaleItem[];
  allocations: SaleBatchAllocation[];
  stockMovements: StockMovement[];
  customerTransactions: CustomerTransaction[];
  cashTransaction: CashTransaction | null;
  auditLog: AuditLog;
  /** One guarded deduction per allocation (executed before the upserts). */
  batchDeductions: Array<{ batch_id: number; quantity: number }>;
  /** Full batch rows after deduction (quantity/status). */
  updatedBatches: Batch[];
  /** Full customer row with the new balance, or null. */
  updatedCustomer: Customer | null;
  /** Full shift row with the new totals, or null. */
  updatedShift: Shift | null;
  /** Counters the plan was reserved from (for the in-transaction check). */
  baseIds: Record<string, number>;
  /** Counters after this sale. */
  nextIds: Record<string, number>;
  baseInvoiceCounter: number;
  nextInvoiceCounter: number;
  invoiceNumber: string;
}

export interface SaleWriteResult {
  saleId: number;
  invoiceNumber: string;
  sale: Sale;
}

export type SaleWriteStep = 'begin' | 'counters' | 'batches' | 'rows' | 'commit';

// ─── Step hook (tests only) ─────────────────────────────────────────

/** Optional hook invoked at each transaction step. Tests set it to throw
 * mid-transaction and prove the rollback; production never sets it. */
let stepHook: ((step: SaleWriteStep) => void) | null = null;

export function setSaleWriteStepHook(hook: ((step: SaleWriteStep) => void) | null): void {
  stepHook = hook;
}

export function getSaleWriteStepHook(): ((step: SaleWriteStep) => void) | null {
  return stepHook;
}

// ─── Plan builder (pure) ────────────────────────────────────────────

function stamp<T extends { syncId?: string; updatedAt?: string; syncDeviceId?: string }>(
  row: T,
  input: SalePlanInput,
): T {
  row.syncId = newSyncId();
  row.updatedAt = input.updated_at_iso;
  row.syncDeviceId = input.device_id;
  return row;
}

/**
 * Build the complete sale plan from a validated, resolved sale. Pure:
 * it reads only `input` and writes nothing. It re-validates what the
 * caller already checked (credit limit, stock per batch) so a stale plan
 * can never be built from inconsistent input.
 *
 * Id consumption mirrors the legacy in-memory sale exactly, so a sale
 * takes the same ids on either path: sale, invoice, then per item the
 * sale item, per allocation the allocation + stock movement, then the
 * customer transactions, the cash transaction, and the audit log.
 */
export function buildSaleWritePlan(input: SalePlanInput): SaleWritePlan {
  const ids: Record<string, number> = { ...input.ids };
  const take = (key: string): number => {
    const value = ids[key] ?? 1;
    ids[key] = value + 1;
    return value;
  };

  // Credit limit: refuse a sale whose new balance would exceed the limit.
  if (
    input.customer_balance_after !== null &&
    input.customer_credit_limit !== null &&
    input.customer_credit_limit > 0 &&
    input.customer_balance_after > input.customer_credit_limit
  ) {
    throw new Error('CREDIT_LIMIT_EXCEEDED');
  }

  // Stock: total allocated per batch must not exceed the batch quantity.
  const batchById = new Map<number, Batch>();
  for (const batch of input.batches) batchById.set(batch.id, batch);
  const allocatedByBatch = new Map<number, number>();
  for (const item of input.items) {
    for (const alloc of item.allocations) {
      if (!batchById.has(alloc.batch_id)) {
        throw new Error(`INSUFFICIENT_STOCK: batch ${alloc.batch_id} not found`);
      }
      allocatedByBatch.set(alloc.batch_id, (allocatedByBatch.get(alloc.batch_id) ?? 0) + alloc.quantity);
    }
  }
  for (const [batchId, allocated] of allocatedByBatch) {
    const batch = batchById.get(batchId);
    if (!batch || allocated > batch.quantity) {
      throw new Error('INSUFFICIENT_STOCK');
    }
  }

  const createdAt = input.created_at;
  const invoiceCounter = input.invoice_counter + 1;
  const invoiceNumber = `INV-${String(invoiceCounter).padStart(6, '0')}`;
  const saleId = take('sales');

  const sale: Sale = stamp(
    {
      id: saleId,
      invoice_number: invoiceNumber,
      sale_type: input.sale_type,
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      subtotal: input.subtotal,
      discount: input.discount,
      total: input.total,
      amount_paid: input.amount_paid,
      change_given: input.change_given,
      remaining: input.remaining,
      cogs: input.total_cogs,
      gross_profit: input.total - input.total_cogs,
      date: input.date,
      shift_id: input.shift ? input.shift.id : null,
      user_id: input.user_id,
      notes: input.notes,
      cancelled: false,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: createdAt,
    } as Sale,
    input,
  );

  const saleItems: SaleItem[] = [];
  const allocations: SaleBatchAllocation[] = [];
  const stockMovements: StockMovement[] = [];
  const batchDeductions: Array<{ batch_id: number; quantity: number }> = [];

  for (const item of input.items) {
    const saleItemId = take('saleItems');
    const saleItem: SaleItem = stamp(
      {
        id: saleItemId,
        sale_id: saleId,
        product_id: item.product_id,
        product_name: item.product_name,
        batch_id: item.allocations[0]?.batch_id ?? null,
        unit: item.unit,
        unit_name: item.unit,
        quantity: item.quantity,
        quantity_entered: item.quantity,
        conversion_factor: item.quantity > 0 ? item.qty_in_inv_unit / item.quantity : 0,
        quantity_in_inventory_unit: item.qty_in_inv_unit,
        unit_price: item.unit_price,
        base_purchase_price: item.base_purchase_price,
        discount: item.discount,
        line_total: item.line_total,
        cogs: item.item_cogs,
      } as SaleItem,
      input,
    );
    saleItems.push(saleItem);

    for (const alloc of item.allocations) {
      const allocation: SaleBatchAllocation = stamp(
        {
          id: take('saleAllocations'),
          sale_item_id: saleItemId,
          batch_id: alloc.batch_id,
          quantity_allocated: alloc.quantity,
          purchase_price: alloc.purchase_price,
        } as SaleBatchAllocation,
        input,
      );
      allocations.push(allocation);
      batchDeductions.push({ batch_id: alloc.batch_id, quantity: alloc.quantity });

      const movement: StockMovement = stamp(
        {
          id: take('stockMovements'),
          product_id: item.product_id,
          batch_id: alloc.batch_id,
          type: 'SALE',
          quantity: -alloc.quantity,
          unit: item.inventory_unit,
          quantity_in_inventory_unit: -alloc.quantity,
          reference_type: 'sale',
          reference_id: saleId,
          note: null,
          user_id: input.user_id,
          created_at: createdAt,
        } as StockMovement,
        input,
      );
      stockMovements.push(movement);
    }
  }

  // Full batch rows after deduction (copies; input rows are never mutated).
  const updatedBatches: Batch[] = [];
  for (const [batchId, allocated] of allocatedByBatch) {
    const batch = batchById.get(batchId);
    if (!batch) continue;
    const newQuantity = Math.max(0, batch.quantity - allocated);
    updatedBatches.push({
      ...batch,
      quantity: newQuantity,
      status: newQuantity <= 0 ? 'DEPLETED' : batch.status,
      updatedAt: input.updated_at_iso,
      syncDeviceId: input.device_id,
    });
  }

  // Customer balance + transactions (only when a balance update applies).
  const customerTransactions: CustomerTransaction[] = [];
  let updatedCustomer: Customer | null = null;
  if (input.customer_balance_after !== null && input.customer !== null) {
    updatedCustomer = {
      ...input.customer,
      balance: input.customer_balance_after,
      updatedAt: input.updated_at_iso,
      syncDeviceId: input.device_id,
    };
    customerTransactions.push(
      stamp(
        {
          id: take('customerTx'),
          customer_id: input.customer.id,
          type: 'sale',
          amount: input.total,
          balance_after: input.customer_balance_after,
          reference_id: saleId,
          note: `فاتورة ${invoiceNumber}`,
          date: input.date,
          created_at: createdAt,
        } as CustomerTransaction,
        input,
      ),
    );
    if (input.amount_paid > 0) {
      customerTransactions.push(
        stamp(
          {
            id: take('customerTx'),
            customer_id: input.customer.id,
            type: 'payment',
            amount: -input.amount_paid,
            balance_after: input.customer_balance_after,
            reference_id: saleId,
            note: `دفعة من فاتورة ${invoiceNumber}`,
            date: input.date,
            created_at: createdAt,
          } as CustomerTransaction,
          input,
        ),
      );
    }
  }

  // Cash transaction for the paid part.
  let cashTransaction: CashTransaction | null = null;
  if (input.amount_paid > 0) {
    cashTransaction = stamp(
      {
        id: take('cashTx'),
        type: 'SALE_CASH',
        amount: input.amount_paid,
        reference_type: 'sale',
        reference_id: saleId,
        shift_id: input.shift ? input.shift.id : null,
        note: `بيع نقدي - ${invoiceNumber}`,
        user_id: input.user_id,
        date: input.date,
        created_at: createdAt,
      } as CashTransaction,
      input,
    );
  }

  // Shift totals (same formula as the legacy path: a falsy expected_cash
  // falls back to opening_cash).
  let updatedShift: Shift | null = null;
  if (input.shift) {
    updatedShift = {
      ...input.shift,
      total_sales: input.shift.total_sales + input.total,
      expected_cash: (input.shift.expected_cash || input.shift.opening_cash) + input.amount_paid,
      updatedAt: input.updated_at_iso,
      syncDeviceId: input.device_id,
    };
  }

  const auditLog: AuditLog = stamp(
    {
      id: take('auditLogs'),
      user_id: null,
      user_name: null,
      action: 'SALE_CREATE',
      entity: 'sale',
      entity_id: saleId,
      before_data: null,
      after_data: JSON.stringify({ invoice: invoiceNumber, total: input.total }),
      reason: null,
      ip: null,
      created_at: createdAt,
    } as AuditLog,
    input,
  );

  return {
    sale,
    saleItems,
    allocations,
    stockMovements,
    customerTransactions,
    cashTransaction,
    auditLog,
    batchDeductions,
    updatedBatches,
    updatedCustomer,
    updatedShift,
    baseIds: { ...input.ids },
    nextIds: ids,
    baseInvoiceCounter: input.invoice_counter,
    nextInvoiceCounter: invoiceCounter,
    invoiceNumber,
  };
}

// ─── Plan -> persistence diff ────────────────────────────────────────

/** The plan as a snapshot diff: every new/updated row plus the reserved
 * counters, written to the generic tables and the typed tables. */
function planToDiff(plan: SaleWritePlan): SnapshotDiff {
  const upserts: SnapshotDiff['upserts'] = [];
  const push = (collection: string, row: { id: number }) => {
    upserts.push({ collection, rowId: row.id, data: JSON.stringify(row) });
  };
  push('sales', plan.sale);
  for (const row of plan.saleItems) push('saleItems', row);
  for (const row of plan.allocations) push('saleBatchAllocations', row);
  for (const row of plan.stockMovements) push('stockMovements', row);
  for (const row of plan.customerTransactions) push('customerTransactions', row);
  if (plan.cashTransaction) push('cashTransactions', plan.cashTransaction);
  push('auditLogs', plan.auditLog);
  for (const row of plan.updatedBatches) push('batches', row);
  if (plan.updatedCustomer) push('customers', plan.updatedCustomer);
  if (plan.updatedShift) push('shifts', plan.updatedShift);
  return {
    upserts,
    deletes: [],
    metaUpserts: [
      ['ids', JSON.stringify(plan.nextIds)],
      ['invoice_counter', String(plan.nextInvoiceCounter)],
    ],
    metaDeletes: [],
  };
}

// ─── Transaction executor ───────────────────────────────────────────

function safeJsonNumbers(text: string | undefined): Record<string, number> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function changesOf(result: unknown): number {
  if (result && typeof result === 'object') {
    const changes = (result as { changes?: unknown }).changes;
    if (typeof changes === 'number' && Number.isFinite(changes)) return changes;
  }
  return 0;
}

/**
 * Execute a sale plan inside one SQLite transaction. Steps, in order:
 * counters are verified against meta (the database must not be ahead of
 * the memory the plan was built from — that would mean a previous sale
 * was lost; a database behind memory is fine, it is simply unflushed),
 * batches are deducted with a guarded UPDATE (a zero affected-row count
 * means the stock is gone and aborts the whole sale), then every row is
 * written to the generic and the typed tables and the reserved counters
 * are stored. Any failure rolls everything back and rethrows.
 */
export async function executeSaleTransaction(
  db: TypedDb,
  plan: SaleWritePlan,
  opts?: { onStep?: (step: SaleWriteStep) => void },
): Promise<SaleWriteResult> {
  const step = (name: SaleWriteStep): void => {
    const hook = opts?.onStep ?? stepHook;
    if (hook) hook(name);
  };
  step('begin');
  await db.exec('BEGIN IMMEDIATE');
  try {
    await migrateToTypedTables(db, { inTransaction: true });
    step('counters');
    const idsRow = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['ids']);
    const storedIds = safeJsonNumbers(idsRow?.value);
    for (const [key, base] of Object.entries(plan.baseIds)) {
      if (key in storedIds && storedIds[key] > base) {
        throw new Error(`COUNTER_MISMATCH:${key}`);
      }
    }
    const invoiceRow = await db.get<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      ['invoice_counter'],
    );
    if (invoiceRow && Number(invoiceRow.value) > plan.baseInvoiceCounter) {
      throw new Error('COUNTER_MISMATCH:invoice_counter');
    }
    step('batches');
    for (const deduction of plan.batchDeductions) {
      const result = await db.run(
        'UPDATE batches SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
        [deduction.quantity, deduction.batch_id, deduction.quantity],
      );
      if (changesOf(result) !== 1) {
        throw new Error('INSUFFICIENT_STOCK');
      }
    }
    step('rows');
    const diff = planToDiff(plan);
    await applyDiffToGenericTables(db, diff);
    await applyDiffToTypedTables(db, diff);
    step('commit');
    await db.exec('COMMIT');
    return { saleId: plan.sale.id, invoiceNumber: plan.invoiceNumber, sale: plan.sale };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // The rollback itself failed; the original error is the one to report.
    }
    throw error;
  }
}
