// SQLite Phase 3 tests — the SQL sale path: plan-then-execute inside one
// SQLite transaction, atomic rollback on failure, invoice reservation,
// and parity with the legacy in-memory sale. Runs on REAL node:sqlite
// (DatabaseSync, :memory:) through the same test adapter shape as the
// Phase 2 tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const originalLoad = Module._load;
const STORE_KEY = '@pharmacy_accounts/store/v1';
const persisted = new Map();
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: {
      getItem: async (key) => (persisted.has(key) ? persisted.get(key) : null),
      setItem: async (key, value) => { persisted.set(key, value); },
      removeItem: async (key) => { persisted.delete(key); },
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const db = require('../.test-build/services/erp-database.js');
const sqliteStore = require('../.test-build/services/sqlite-store.js');
const typed = require('../.test-build/services/sqlite-typed.js');
const writes = require('../.test-build/services/sqlite-writes.js');

// ─── Test adapter over node:sqlite (same shape as Phase 2) ──────────

function wrapNodeDb(database) {
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, params = []) => database.prepare(sql).run(...params),
    all: (sql, params = []) => database.prepare(sql).all(...params),
    get: (sql, params = []) => database.prepare(sql).get(...params) ?? null,
  };
}

class NodeSqliteAdapter {
  constructor() {
    this.name = 'node-sqlite';
    this.database = new DatabaseSync(':memory:');
    this.database.exec(sqliteStore.buildSchemaSql());
    this.database.exec(typed.buildTypedSchemaSql());
  }

  typedDb() {
    return wrapNodeDb(this.database);
  }

  async loadSnapshot() {
    const t = this.typedDb();
    const metaRows = t.all('SELECT key, value FROM meta');
    const rows = t.all('SELECT collection, row_id, data FROM collections ORDER BY collection, row_id');
    if (metaRows.length === 0 && rows.length === 0) return null;
    return sqliteStore.rowsToSnapshot({
      meta: metaRows.map(r => [r.key, r.value]),
      rows: rows.map(r => ({ collection: r.collection, rowId: r.row_id, data: r.data })),
    });
  }

  async saveSnapshot(snapshot) {
    const rows = sqliteStore.snapshotToRows(snapshot);
    const t = this.typedDb();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      await typed.migrateToTypedTables(t, { inTransaction: true });
      await typed.applySnapshotToGenericTables(t, rows);
      await typed.rebuildTypedTablesFromRows(t, rows);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async saveDiff(diff) {
    const t = this.typedDb();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      await typed.migrateToTypedTables(t, { inTransaction: true });
      await typed.applyDiffToGenericTables(t, diff);
      await typed.applyDiffToTypedTables(t, diff);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async getMeta(key) {
    const row = this.typedDb().get('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async getTypedDb() {
    return this.typedDb();
  }

  async ensureTypedTables() {
    await typed.migrateToTypedTables(this.typedDb());
    return true;
  }
}

// ─── Seed helpers ───────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const todayStr = new Date().toISOString().slice(0, 10);
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

function product(name) {
  return db.addProduct({
    barcode: null, internal_code: null, trade_name: name, generic_name: null, active_ingredient: null,
    strength: null, dosage_form: null, manufacturer: null, category: null, prescription_required: false,
    controlled: false, inventory_unit: 'Tablet', minimum_stock: 0, reorder_level: 0, selling_price: 15,
    default_purchase_price: 10, active: true, notes: null,
  });
}

function configure(productId) {
  return db.replaceProductUnits(productId, [
    { unit_name: 'Tablet', conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
      sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true },
  ]);
}

function buy(productId, batch, expiry, quantity, date) {
  return db.createPurchase({ supplier_id: null, date, items: [{
    product_id: productId, batch_number: batch, expiry_date: expiry, unit: 'Tablet', quantity,
    purchase_price: 10, free_quantity: 0, discount: 0,
  }], discount: 0, amount_paid: 0 });
}

function sqlCount(table, where = '', params = []) {
  const row = adapter.typedDb().get(`SELECT COUNT(*) AS n FROM ${table} ${where}`, params);
  return row.n;
}

function sqlMeta(key) {
  const row = adapter.typedDb().get('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

function stripSync(row) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.id;
  delete copy.invoice_number;
  delete copy.sale_id;
  delete copy.created_at;
  delete copy.time;
  delete copy.syncId;
  delete copy.updatedAt;
  delete copy.syncDeviceId;
  return copy;
}

// Sale items point at different twin products/batches, so only the
// money and quantity fields can agree between the two sales.
function pickItem(it) {
  return {
    quantity: it.quantity, quantity_entered: it.quantity_entered,
    conversion_factor: it.conversion_factor,
    quantity_in_inventory_unit: it.quantity_in_inventory_unit,
    unit: it.unit, unit_name: it.unit_name, unit_price: it.unit_price,
    base_purchase_price: it.base_purchase_price, discount: it.discount,
    line_total: it.line_total, cogs: it.cogs,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────

let adapter;
let prodA; let prodB; let prodB2; let prodC;
let batchA1; let batchA2;
let customer; let shift;

test('setup: seed products, batches, customer and shift on node-sqlite', async () => {
  adapter = new NodeSqliteAdapter();
  db.setPersistenceBackend(adapter);
  await db.databaseReady;

  prodA = product('Phase3 A');
  prodB = product('Phase3 B');
  prodB2 = product('Phase3 B2');
  prodC = product('Phase3 C');
  for (const p of [prodA, prodB, prodB2, prodC]) configure(p.id);

  assert.equal(buy(prodA.id, 'A1', isoDate(30), 50, todayStr).success, true);
  assert.equal(buy(prodA.id, 'A2', isoDate(5), 50, todayStr).success, true);
  assert.equal(buy(prodB.id, 'B1', isoDate(30), 50, todayStr).success, true);
  assert.equal(buy(prodB.id, 'B2', isoDate(5), 50, todayStr).success, true);
  assert.equal(buy(prodB2.id, 'B1', isoDate(30), 50, todayStr).success, true);
  assert.equal(buy(prodB2.id, 'B2', isoDate(5), 50, todayStr).success, true);
  assert.equal(buy(prodC.id, 'C1', isoDate(100), 3, todayStr).success, true);

  customer = db.addCustomer({ name: 'Phase3 customer', credit_limit: 10000, opening_balance: 0 });
  shift = db.openShift({ opening_cash: 100 });
  await db.flushDatabaseWrites();

  assert.equal(db.getProductStock(prodA.id), 100);
  assert.equal(db.getProductStock(prodC.id), 3);
  assert.equal(await db.ensureTypedStoreReady(), true);
  assert.equal(db.isSqlSaleWriteEnabled(), true);

  batchA1 = db.getBatches(prodA.id).find(b => b.batch_number === 'A1');
  batchA2 = db.getBatches(prodA.id).find(b => b.batch_number === 'A2');
  assert.ok(batchA1 && batchA2);
});

// ─── 1. SQL sale succeeds and memory matches the typed tables ───────

test('SQL sale writes every table atomically and matches memory', async () => {
  const pendingBefore = db.getPendingSyncCount();
  const result = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr, shift_id: shift.id,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 60, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 900,
  });
  assert.equal(result.success, true);
  assert.equal(result.sale.invoice_number, 'INV-001008'); // 7 setup purchases took 001001–001007
  assert.equal(result.sale.total, 900);
  assert.equal(result.sale.cogs, 600);
  assert.equal(result.sale.gross_profit, 300);
  assert.equal(result.sale.remaining, 0);
  await db.flushDatabaseWrites();

  const t = adapter.typedDb();
  // Typed tables
  const sales = t.all('SELECT * FROM sales');
  assert.equal(sales.length, 1);
  assert.equal(sales[0].invoice_number, 'INV-001008');
  assert.equal(sales[0].total, 900);
  assert.equal(sales[0].cogs, 600);
  assert.equal(t.all('SELECT * FROM sale_items').length, 1);
  const allocs = t.all('SELECT * FROM sale_batch_allocations ORDER BY quantity_allocated');
  assert.equal(allocs.length, 2);
  assert.deepEqual(allocs.map(a => a.quantity_allocated), [10, 50]);
  // FEFO: the earliest-expiry batch (A2) is drained first.
  const a2 = t.get('SELECT * FROM batches WHERE id = ?', [batchA2.id]);
  const a1 = t.get('SELECT * FROM batches WHERE id = ?', [batchA1.id]);
  assert.equal(a2.quantity, 0);
  assert.equal(a2.status, 'DEPLETED');
  assert.equal(a1.quantity, 40);
  assert.equal(a1.status, 'ACTIVE');
  const movements = t.all("SELECT * FROM stock_movements WHERE type = 'SALE' ORDER BY quantity");
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map(m => m.quantity), [-50, -10]);
  assert.equal(movements.every(m => m.type === 'SALE'), true);
  assert.equal(t.all("SELECT * FROM cash_transactions WHERE type = 'SALE_CASH'").length, 1);
  assert.equal(t.all("SELECT * FROM cash_transactions WHERE type = 'SALE_CASH'")[0].amount, 900);
  // No typed audit_logs table exists in Phase 2: the audit row lives in
  // the generic collections table only.
  const auditRows = t.all("SELECT data FROM collections WHERE collection = 'auditLogs'")
    .map(r => JSON.parse(r.data));
  assert.equal(auditRows.filter(a => a.action === 'SALE_CREATE').length, 1);
  // Generic table mirrors the typed tables (dual-write invariant).
  // NOTE: the generic table keys by the in-memory camelCase collection
  // names, unlike the snake_case typed tables.
  assert.equal(sqlCount('collections', "WHERE collection = 'sales'"), 1);
  assert.equal(sqlCount('collections', "WHERE collection = 'saleItems'"), 1);
  assert.equal(sqlCount('collections', "WHERE collection = 'saleBatchAllocations'"), 2);
  // Counters advanced (setup already consumed 7 purchase movements and
  // 15 audit entries; the sale adds 2 movements and 1 audit log).
  assert.equal(sqlMeta('invoice_counter'), '1008');
  const ids = JSON.parse(sqlMeta('ids'));
  assert.equal(ids.sales, 2);
  assert.equal(ids.saleItems, 2);
  assert.equal(ids.saleAllocations, 3);
  assert.equal(ids.stockMovements, 10);
  assert.equal(ids.auditLogs, 17);
  // Memory matches the typed tables.
  assert.equal(db.getSaleItems(result.sale.id).length, 1);
  assert.equal(db.getProductStock(prodA.id), 40);
  assert.equal(db.getSales().length, 1);
  const memShift = db.getShifts().find(s => s.id === shift.id);
  assert.equal(memShift.total_sales, 900);
  assert.equal(memShift.expected_cash, 1000);
  const sqlShift = t.get('SELECT * FROM shifts WHERE id = ?', [shift.id]);
  assert.equal(sqlShift.total_sales, 900);
  assert.equal(sqlShift.expected_cash, 1000);
  // Outbox: sale + item + 2 allocations + 2 movements + cash +
  // 2 batches + shift = 10 entries. The audit log is written to the
  // store but is not a syncable collection, so it never enters the outbox.
  assert.equal(db.getPendingSyncCount() - pendingBefore, 10);
  assert.ok(db.getSyncOutboxSnapshot().some(e => e.syncId === result.sale.syncId));
});

// ─── 2. Sequential invoice numbers ──────────────────────────────────

test('sequential SQL sales take sequential invoice numbers', async () => {
  const second = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(second.success, true);
  assert.equal(second.sale.invoice_number, 'INV-001009');
  const third = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(third.success, true);
  assert.equal(third.sale.invoice_number, 'INV-001010');
  await db.flushDatabaseWrites();
  assert.equal(sqlMeta('invoice_counter'), '1010');
  assert.equal(db.getProductStock(prodA.id), 38);
});

// ─── 3. Mid-transaction failure rolls everything back ───────────────

test('injected failure mid-transaction leaves no trace; retry reuses the invoice number', async () => {
  const salesBefore = sqlCount('sales');
  const stockBefore = db.getProductStock(prodA.id);
  writes.setSaleWriteStepHook((step) => {
    if (step === 'commit') throw new Error('injected failure');
  });
  const failed = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(failed.success, false);
  writes.setSaleWriteStepHook(null);
  await db.flushDatabaseWrites();

  // Nothing changed anywhere: SQL tables, memory, or counters.
  assert.equal(sqlCount('sales'), salesBefore);
  assert.equal(sqlCount('sale_items'), 3);
  assert.equal(sqlCount('stock_movements'), 11); // 7 setup purchases + 2 + 2 sales
  assert.equal(db.getSales().length, salesBefore);
  assert.equal(db.getProductStock(prodA.id), stockBefore);
  assert.equal(sqlMeta('invoice_counter'), '1010');
  assert.equal(JSON.parse(sqlMeta('ids')).sales, salesBefore + 1);

  // Retry with the same inputs succeeds and takes the same invoice number.
  const retry = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(retry.success, true);
  assert.equal(retry.sale.invoice_number, 'INV-001011');
  await db.flushDatabaseWrites();
  assert.equal(db.getProductStock(prodA.id), 37);
});

// ─── 4. Last units: first sale wins, second fails cleanly ───────────

test('two sales for the last units: first wins, second fails with no partial effect', async () => {
  const first = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodC.id, unit: 'Tablet', quantity: 3, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 45,
  });
  assert.equal(first.success, true);
  await db.flushDatabaseWrites();
  assert.equal(db.getProductStock(prodC.id), 0);
  const batchC = adapter.typedDb().get('SELECT * FROM batches WHERE product_id = ?', [prodC.id]);
  assert.equal(batchC.status, 'DEPLETED');

  const salesBefore = sqlCount('sales');
  const movementsBefore = sqlCount('stock_movements');
  const second = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodC.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(second.success, false);
  assert.match(second.error || '', /المخزون/);
  await db.flushDatabaseWrites();
  assert.equal(sqlCount('sales'), salesBefore);
  assert.equal(sqlCount('stock_movements'), movementsBefore);
  assert.equal(db.getSales().length, salesBefore);
  assert.equal(db.getProductStock(prodC.id), 0);
});

// ─── 5. SQL sale and legacy sale produce identical results ──────────

test('SQL sale and legacy sale agree on identical inputs', async () => {
  const input = {
    sale_type: 'credit', customer_id: customer.id, date: todayStr,
    items: [{ product_id: prodB.id, unit: 'Tablet', quantity: 5, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  };
  const sqlSale = await db.createSaleAsync(input);
  assert.equal(sqlSale.success, true);
  const legacyInput = {
    ...input,
    items: [{ product_id: prodB2.id, unit: 'Tablet', quantity: 5, unit_price: 15, discount: 0 }],
  };
  const legacySale = db.createSale(legacyInput);
  assert.equal(legacySale.success, true);
  await db.flushDatabaseWrites();

  assert.deepEqual(stripSync(sqlSale.sale), stripSync(legacySale.sale));
  assert.deepEqual(
    db.getSaleItems(sqlSale.sale.id).map(pickItem),
    db.getSaleItems(legacySale.sale.id).map(pickItem),
  );
  assert.equal(db.getProductStock(prodB.id), 95);
  assert.equal(db.getProductStock(prodB2.id), 95);
  // Same FEFO split on both paths (all 5 from the earliest-expiry batch).
  const t = adapter.typedDb();
  const sqlAllocs = t.all('SELECT quantity_allocated FROM sale_batch_allocations WHERE sale_item_id = ?',
    [db.getSaleItems(sqlSale.sale.id)[0].id]);
  const legacyAllocs = t.all('SELECT quantity_allocated FROM sale_batch_allocations WHERE sale_item_id = ?',
    [db.getSaleItems(legacySale.sale.id)[0].id]);
  assert.deepEqual(sqlAllocs.map(a => a.quantity_allocated), [5]);
  assert.deepEqual(legacyAllocs.map(a => a.quantity_allocated), [5]);
  // Credit branch: both sales land on the same customer (75 + 75).
  assert.equal(db.getCustomer(customer.id).balance, 150);
  assert.equal(db.getCustomerTransactions(customer.id).length, 2);
  assert.deepEqual(db.getCustomerTransactions(customer.id).map(t => t.amount), [75, 75]);
});

// ─── 6. Guarded batch deduction rejects a stale plan ────────────────

test('guarded UPDATE rejects a plan built on stale stock and rolls back', async () => {
  const t = adapter.typedDb();
  const batchB2 = t.get("SELECT * FROM batches WHERE product_id = ? AND batch_number = 'B2'", [prodB.id]);
  const staleBatch = { ...batchB2 };
  const ids = JSON.parse(sqlMeta('ids'));
  const invoiceCounter = Number(sqlMeta('invoice_counter'));
  const salesBefore = sqlCount('sales');

  // Another writer drains the batch after the plan was built.
  t.run('UPDATE batches SET quantity = ? WHERE id = ?', [5, batchB2.id]);

  const plan = writes.buildSaleWritePlan({
    sale_type: 'cash', customer_id: null, customer_name: null, customer: null,
    customer_balance_after: null, customer_credit_limit: null, shift: null,
    user_id: null, notes: null, date: todayStr,
    subtotal: 150, discount: 0, total: 150, amount_paid: 150, change_given: 0,
    remaining: 0, total_cogs: 100,
    items: [{
      product_id: prodB.id, product_name: 'Phase3 B', inventory_unit: 'Tablet',
      unit: 'Tablet', quantity: 10, qty_in_inv_unit: 10, unit_price: 15, discount: 0,
      line_total: 150, item_cogs: 100, base_purchase_price: 10,
      allocations: [{ batch_id: batchB2.id, batch_number: 'B2', expiry_date: batchB2.expiry_date, quantity: 10, purchase_price: 10 }],
    }],
    batches: [staleBatch],
    ids, invoice_counter: invoiceCounter,
    created_at: '2026-01-01 00:00:00', updated_at_iso: new Date().toISOString(), device_id: 'test-device',
  });

  await assert.rejects(
    writes.executeSaleTransaction(t, plan),
    (error) => error instanceof Error && error.message === 'INSUFFICIENT_STOCK',
  );
  // Rollback: no sale, batch untouched at 5, counters untouched.
  assert.equal(sqlCount('sales'), salesBefore);
  assert.equal(t.get('SELECT * FROM batches WHERE id = ?', [batchB2.id]).quantity, 5);
  assert.equal(sqlMeta('invoice_counter'), String(invoiceCounter));

  // Restore the batch so later tests see the memory state again.
  t.run('UPDATE batches SET quantity = ? WHERE id = ?', [45, batchB2.id]);
  assert.equal(t.get('SELECT * FROM batches WHERE id = ?', [batchB2.id]).quantity, 45);
});

// ─── 7. Legacy path still works when the typed store is absent ──────

test('legacy path still works on the AsyncStorage backend', async () => {
  db.setPersistenceBackend(new sqliteStore.AsyncStorageAdapter());
  assert.equal(db.isSqlSaleWriteEnabled(), false);
  const salesBefore = db.getSales().length;
  const sqlSalesBefore = sqlCount('sales');
  const result = await db.createSaleAsync({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(result.success, true);
  assert.equal(db.getSales().length, salesBefore + 1);
  assert.equal(db.getProductStock(prodA.id), 36);
  // The legacy write went to AsyncStorage, not to the SQLite tables.
  assert.equal(sqlCount('sales'), sqlSalesBefore);
  await db.flushDatabaseWrites();
});
