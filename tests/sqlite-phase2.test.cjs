// SQLite Phase 2 tests — typed tables, v2 migration, dual-write and
// SQL read parity against the in-memory computations. Runs on REAL
// node:sqlite (DatabaseSync, :memory:) through a small test adapter
// that mirrors the ExpoSqliteAdapter's transaction structure using the
// same shared helpers from services/sqlite-typed.ts.
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

// ─── Test adapter over node:sqlite ──────────────────────────────────

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
    this.typedCalls = 0;
    this.getDbCalls = 0;
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
    this.getDbCalls++;
    return this.typedDb();
  }

  async ensureTypedTables() {
    this.typedCalls++;
    await typed.migrateToTypedTables(this.typedDb());
    return true;
  }
}

// ─── Seed helpers (same shapes as the earlier test files) ───────────

const DAY_MS = 24 * 60 * 60 * 1000;
const todayStr = new Date().toISOString().slice(0, 10);
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
const yesterdayStr = isoDate(-1);

function product(name, minimumStock, active = true) {
  return db.addProduct({
    barcode: null, internal_code: null, trade_name: name, generic_name: null, active_ingredient: null,
    strength: null, dosage_form: null, manufacturer: null, category: null, prescription_required: false,
    controlled: false, inventory_unit: 'Tablet', minimum_stock: minimumStock, reorder_level: 0, selling_price: 15,
    default_purchase_price: 10, active, notes: null,
  });
}

function configure(productId) {
  return db.replaceProductUnits(productId, [
    { unit_name: 'Tablet', conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
      sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true },
    { unit_name: 'Strip', conversion_factor: 10, parent_unit_name: 'Tablet', quantity_per_parent: 10,
      sale_price: null, purchase_price: null, is_purchase_default: false, is_sale_default: false },
    { unit_name: 'Box', conversion_factor: 100, parent_unit_name: 'Strip', quantity_per_parent: 10,
      sale_price: null, purchase_price: null, is_purchase_default: false, is_sale_default: false },
  ]);
}

function buy(productId, batch, expiry, quantity, date) {
  return db.createPurchase({ supplier_id: null, date, items: [{
    product_id: productId, batch_number: batch, expiry_date: expiry, unit: 'Tablet', quantity,
    purchase_price: 10, free_quantity: 0, discount: 0,
  }], discount: 0, amount_paid: 0 });
}

// ─── 1. Migration v2 on a raw generic database ──────────────────────

test('migration v2 copies generic rows to typed tables and is idempotent', async () => {
  const database = new DatabaseSync(':memory:');
  const t = wrapNodeDb(database);
  database.exec(sqliteStore.buildSchemaSql());
  const insertMeta = (key, value) => t.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
  insertMeta('schema_version', '1');
  insertMeta('ids', JSON.stringify({ products: 3, batches: 2, sales: 1 }));
  insertMeta('invoice_counter', '1001');
  const insertRow = (collection, rowId, data) =>
    t.run('INSERT INTO collections (collection, row_id, data) VALUES (?, ?, ?)', [collection, rowId, data]);
  insertRow('products', 1, JSON.stringify({ id: 1, trade_name: 'Aspirin', selling_price: 15, minimum_stock: 10, active: true, syncId: 'aaa', updatedAt: '2026-01-01T00:00:00.000Z' }));
  insertRow('products', 2, JSON.stringify({ id: 2, trade_name: 'Paracetamol', selling_price: 10, minimum_stock: 0, active: true }));
  insertRow('products', 99, '{corrupt json');
  insertRow('batches', 1, JSON.stringify({ id: 1, product_id: 1, batch_number: 'B1', expiry_date: '2027-12-31', quantity: 20, purchase_price: 10, status: 'ACTIVE' }));
  insertRow('sales', 1, JSON.stringify({ id: 1, invoice_number: 'INV-001001', sale_type: 'cash', total: 30, date: todayStr, cancelled: false }));
  insertRow('users', 1, JSON.stringify({ id: 1, username: 'admin' }));

  const result = await typed.migrateToTypedTables(t);
  assert.equal(result.alreadyMigrated, false);
  assert.equal(result.skipped, 1);
  assert.equal(result.migrated, 4);

  const products = t.all('SELECT * FROM products ORDER BY id');
  assert.equal(products.length, 2);
  assert.equal(products[0].trade_name, 'Aspirin');
  assert.equal(products[0].sync_id, 'aaa');
  assert.equal(products[0].minimum_stock, 10);
  assert.equal(t.all('SELECT * FROM batches').length, 1);
  assert.equal(t.all('SELECT * FROM sales').length, 1);
  // Generic table stays as the rollback source; untyped collections are untouched.
  assert.equal(t.all('SELECT * FROM collections').length, 6);
  assert.equal((await t.get('SELECT value FROM meta WHERE key = ?', ['schema_version'])).value, '2');
  assert.equal(t.all('SELECT * FROM schema_migrations').length, 1);

  const again = await typed.migrateToTypedTables(t);
  assert.equal(again.alreadyMigrated, true);
  assert.equal(again.migrated, 0);
  assert.equal(t.all('SELECT * FROM products').length, 2);
});

// ─── 2. Seeded store on the node-sqlite backend ─────────────────────

let adapter;
let prodA; let prodB; let prodC; let prodD; let prodE; let prodF; let prodG;
let customer; let cashSale; let creditSale;

test('setup: seed products, batches, sales and a return on node-sqlite', async () => {
  adapter = new NodeSqliteAdapter();
  db.setPersistenceBackend(adapter);
  await db.databaseReady;

  prodA = product('Alpha', 10);
  prodB = product('Beta', 5);
  prodC = product('Gamma', 0);
  prodD = product('Delta', 3);
  prodE = product('Epsilon', 0);
  prodF = product('Zeta inactive', 10, false);
  prodG = product('Eta FEFO', 0);
  for (const p of [prodA, prodB, prodC, prodD, prodE, prodF, prodG]) configure(p.id);

  assert.equal(buy(prodA.id, 'A1', isoDate(10), 5, todayStr).success, true);
  assert.equal(buy(prodA.id, 'A2', isoDate(40), 4, todayStr).success, true);
  assert.equal(buy(prodB.id, 'B1', todayStr, 3, todayStr).success, true); // expires today: days_to_expiry 0 -> 'expired' group
  assert.equal(buy(prodB.id, 'B2', isoDate(20), 2, todayStr).success, true);
  assert.equal(buy(prodC.id, 'C1', isoDate(100), 50, todayStr).success, true);
  // Zeta stays inactive with no batches: it must be excluded from the
  // inventory list and low-stock results, but counted as out of stock
  // by the dashboard (which does not filter by product.active).
  assert.equal(buy(prodG.id, 'G1', isoDate(30), 3, todayStr).success, true);
  assert.equal(buy(prodG.id, 'G2', isoDate(5), 4, todayStr).success, true);
  assert.equal(buy(prodG.id, 'G3', isoDate(60), 10, todayStr).success, true);
  assert.equal(buy(prodG.id, 'G4', '2999-12-31', 100, todayStr).success, true);

  customer = db.addCustomer({ name: 'Phase2 customer', credit_limit: 10000, opening_balance: 0 });
  cashSale = db.createSale({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodA.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(cashSale.success, true);
  creditSale = db.createSale({
    sale_type: 'credit', customer_id: customer.id, date: todayStr,
    items: [{ product_id: prodC.id, unit: 'Tablet', quantity: 2, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  });
  assert.equal(creditSale.success, true);
  const yesterdaySale = db.createSale({
    sale_type: 'cash', customer_id: null, date: yesterdayStr,
    items: [{ product_id: prodC.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15,
  });
  assert.equal(yesterdaySale.success, true);
  const cashItem = db.getSaleItems(cashSale.sale.id)[0];
  const ret = db.createSaleReturn({ sale_id: cashSale.sale.id, items: [{ sale_item_id: cashItem.id, quantity: 1 }] });
  assert.equal(ret.success, true);
  db.addExpense({ category: 'أخرى', amount: 5, date: todayStr });

  await db.flushDatabaseWrites();
  assert.equal(db.getProductStock(prodA.id), 9);
});

test('dual-write: generic and typed tables match after persist', () => {
  const t = adapter.typedDb();
  const genericCounts = new Map(
    t.all('SELECT collection, COUNT(*) AS n FROM collections GROUP BY collection').map(r => [r.collection, r.n]),
  );
  const typedCounts = {
    products: t.all('SELECT * FROM products').length,
    batches: t.all('SELECT * FROM batches').length,
    sales: t.all('SELECT * FROM sales').length,
    sale_items: t.all('SELECT * FROM sale_items').length,
    sale_returns: t.all('SELECT * FROM sale_returns').length,
    purchases: t.all('SELECT * FROM purchases').length,
    purchase_items: t.all('SELECT * FROM purchase_items').length,
    expenses: t.all('SELECT * FROM expenses').length,
    customers: t.all('SELECT * FROM customers').length,
  };
  assert.equal(typedCounts.products, genericCounts.get('products'));
  assert.equal(typedCounts.batches, genericCounts.get('batches'));
  assert.equal(typedCounts.sales, genericCounts.get('sales'));
  assert.equal(typedCounts.sale_items, genericCounts.get('saleItems'));
  assert.equal(typedCounts.sale_returns, genericCounts.get('saleReturns'));
  assert.equal(typedCounts.purchases, genericCounts.get('purchases'));
  assert.equal(typedCounts.purchase_items, genericCounts.get('purchaseItems'));
  assert.equal(typedCounts.expenses, genericCounts.get('expenses'));
  assert.equal(typedCounts.customers, genericCounts.get('customers'));
  const typedA = t.get('SELECT * FROM products WHERE id = ?', [prodA.id]);
  assert.equal(typedA.trade_name, 'Alpha');
  assert.equal(typedA.minimum_stock, 10);
  assert.equal(typedA.sync_id, db.getProduct(prodA.id).syncId);
  const typedReturn = t.get('SELECT * FROM sale_returns');
  assert.equal(typedReturn.cash_refund, 15);
  assert.ok(typedReturn.returned_cogs_total > 0);
  assert.equal(t.get('SELECT value FROM meta WHERE key = ?', ['schema_version']).value, '2');
});

test('dual-write: deleting a row removes it from both tables', async () => {
  const expense = db.addExpense({ category: 'حذف', amount: 7, date: todayStr });
  await db.flushDatabaseWrites();
  const t = adapter.typedDb();
  assert.equal(t.all('SELECT * FROM expenses WHERE id = ?', [expense.id]).length, 1);
  assert.equal(t.all("SELECT * FROM collections WHERE collection = 'expenses' AND row_id = ?", [expense.id]).length, 1);
  db.deleteExpense(expense.id);
  await db.flushDatabaseWrites();
  assert.equal(t.all('SELECT * FROM expenses WHERE id = ?', [expense.id]).length, 0);
  assert.equal(t.all("SELECT * FROM collections WHERE collection = 'expenses' AND row_id = ?", [expense.id]).length, 0);
});

// ─── 3. SQL read parity with the in-memory computations ─────────────

test('SQL low stock matches the in-memory inventory (incl. no-batch products)', async () => {
  const t = adapter.typedDb();
  const sql = await typed.getLowStock(t);
  const expected = db.getInventoryList()
    .filter(item => item.total_quantity < item.minimum_stock)
    .map(item => ({ productId: item.product_id, totalQuantity: item.total_quantity, minimumStock: item.minimum_stock }))
    .sort((a, b) => a.productId - b.productId);
  assert.deepEqual(sql, expected);
  assert.ok(sql.some(row => row.productId === prodA.id));
  assert.ok(sql.some(row => row.productId === prodD.id)); // no batches, quantity 0
  assert.ok(!sql.some(row => row.productId === prodF.id)); // inactive product excluded
});

test('SQL expiring/expired batches match the expiry radar', async () => {
  const t = adapter.typedDb();
  const radar = db.getExpiryRadar();
  const expiring = await typed.getExpiringBatches(t, 30, { today: todayStr });
  assert.deepEqual(
    expiring.map(r => r.batchId),
    radar.filter(r => r.group === '30').map(r => r.batch_id),
  );
  const expired = await typed.getExpiredBatches(t, { today: todayStr });
  assert.deepEqual(
    expired.map(r => r.batchId),
    radar.filter(r => r.group === 'expired').map(r => r.batch_id),
  );
  assert.ok(expiring.every(r => r.daysToExpiry > 0 && r.daysToExpiry <= 30));
  assert.ok(expired.every(r => r.daysToExpiry <= 0));
});

test('SQL inventory summary matches the in-memory inventory item', async () => {
  const t = adapter.typedDb();
  const summary = await typed.getInventorySummary(t, prodA.id);
  const item = db.getInventoryList().find(entry => entry.product_id === prodA.id);
  assert.equal(summary.totalQuantity, item.total_quantity);
  assert.equal(summary.nearestExpiry, item.nearest_expiry);
  assert.equal(summary.batchCount, item.batches.length);
  const empty = await typed.getInventorySummary(t, prodD.id);
  assert.deepEqual(empty, { totalQuantity: 0, nearestExpiry: null, batchCount: 0 });
});

test('SQL sales summary and report summary match in-memory', async () => {
  const t = adapter.typedDb();
  const summary = await typed.getSalesSummary(t, todayStr, todayStr);
  const memory = db.getReportSummary(todayStr, todayStr);
  assert.equal(summary.cashSales, memory.cashSales);
  assert.equal(summary.creditSales, memory.creditSales);
  assert.equal(summary.totalSales, memory.totalSales);
  assert.equal(summary.transactionCount, memory.transactionCount);
  const report = await typed.getReportSummarySql(t, yesterdayStr, todayStr);
  const memoryReport = db.getReportSummary(yesterdayStr, todayStr);
  assert.deepEqual(report, memoryReport);
});

test('SQL dashboard KPIs match in-memory', async () => {
  const t = adapter.typedDb();
  const sql = await typed.getDashboardKpisSql(t, todayStr);
  const memory = db.getDashboardKpis();
  assert.equal(sql.todaySales, memory.todaySales);
  assert.equal(sql.todayCashSales, memory.todayCashSales);
  assert.equal(sql.todayCreditSales, memory.todayCreditSales);
  assert.equal(sql.lowStockCount, memory.lowStockCount);
  assert.equal(sql.expiringCount, memory.expiringCount);
  assert.equal(sql.expiredCount, memory.expiredCount);
  assert.equal(sql.outOfStockCount, memory.outOfStockCount);
});

test('SQL expiry radar matches in-memory', async () => {
  const t = adapter.typedDb();
  const sql = await typed.getExpiryRadarSql(t, { today: todayStr });
  assert.deepEqual(sql, db.getExpiryRadar());
});

test('SQL inventory list matches in-memory', async () => {
  const t = adapter.typedDb();
  const sql = await typed.getInventoryListSql(t, {}, { today: todayStr });
  const memory = db.getInventoryList();
  const slim = (list) => list.map(item => ({
    product_id: item.product_id,
    trade_name: item.trade_name,
    total_quantity: item.total_quantity,
    minimum_stock: item.minimum_stock,
    status: item.status,
    nearest_expiry: item.nearest_expiry,
    days_to_nearest_expiry: item.days_to_nearest_expiry,
    batches: item.batches.map(b => ({ id: b.id, quantity: b.quantity, expiry_date: b.expiry_date, status: b.status })),
  }));
  assert.deepEqual(slim(sql), slim(memory));
  assert.deepEqual(
    slim(await typed.getInventoryListSql(t, { status: 'low' }, { today: todayStr })),
    slim(memory.filter(item => item.status === 'low')),
  );
});

// ─── 4. FEFO parity ─────────────────────────────────────────────────

test('SQL FEFO matches the in-memory allocation of the same sale', async () => {
  const t = adapter.typedDb();
  const sqlAlloc = await typed.allocateFefo(t, prodG.id, 6, { today: todayStr });
  assert.deepEqual(sqlAlloc, [
    { batchId: db.getBatches(prodG.id).find(b => b.batch_number === 'G2').id, quantity: 4 },
    { batchId: db.getBatches(prodG.id).find(b => b.batch_number === 'G1').id, quantity: 2 },
  ]);
  const sale = db.createSale({
    sale_type: 'cash', customer_id: null, date: todayStr,
    items: [{ product_id: prodG.id, unit: 'Tablet', quantity: 6, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 90,
  });
  assert.equal(sale.success, true);
  await db.flushDatabaseWrites();
  const itemId = db.getSaleItems(sale.sale.id)[0].id;
  const stored = t.all('SELECT batch_id AS batchId, quantity_allocated AS quantity FROM sale_batch_allocations WHERE sale_item_id = ? ORDER BY batch_id', [itemId]);
  const byBatch = new Map(sqlAlloc.map(a => [a.batchId, a.quantity]));
  assert.equal(stored.length, sqlAlloc.length);
  for (const row of stored) assert.equal(row.quantity, byBatch.get(row.batchId));
  // Insufficient stock allocates nothing.
  assert.deepEqual(await typed.allocateFefo(t, prodG.id, 1000, { today: todayStr }), []);
  // A batch with no expiry date sorts last.
  t.run("INSERT INTO batches (id, product_id, batch_number, expiry_date, quantity, status) VALUES (?, ?, ?, '', 50, 'ACTIVE')", [9999, prodG.id, 'G0', ]);
  const alloc = await typed.allocateFefo(t, prodG.id, 150, { today: todayStr });
  assert.equal(alloc[alloc.length - 1].batchId, 9999);
  t.run('DELETE FROM batches WHERE id = ?', [9999]);
});

// ─── 5. Async variants use SQL when ready, memory otherwise ─────────

test('typed store status and async variants use the SQL path', async () => {
  assert.equal(await db.ensureTypedStoreReady(), true);
  assert.equal(db.isTypedStoreReady(), true);
  assert.deepEqual(db.getTypedStoreStatus(), { ready: true, schemaVersion: '2' });
  const callsBefore = adapter.getDbCalls;
  const kpis = await db.getDashboardKpisAsync();
  const memoryKpis = db.getDashboardKpis();
  assert.equal(kpis.todaySales, memoryKpis.todaySales);
  assert.equal(kpis.lowStockCount, memoryKpis.lowStockCount);
  assert.equal(kpis.expiredCount, memoryKpis.expiredCount);
  assert.deepEqual(await db.getReportSummaryAsync(yesterdayStr, todayStr), db.getReportSummary(yesterdayStr, todayStr));
  assert.deepEqual(await db.getExpiryRadarAsync(), db.getExpiryRadar());
  assert.ok(adapter.getDbCalls > callsBefore, 'SQL path was actually used');
  const low = await db.getLowStockProductsAsync();
  assert.deepEqual(low.map(item => item.product_id).sort((a, b) => a - b),
    db.getInventoryList().filter(item => item.status === 'low').map(item => item.product_id).sort((a, b) => a - b));
});

test('async variants fall back to memory when the backend has no typed tables', async () => {
  const { InMemoryAdapter } = sqliteStore;
  db.setPersistenceBackend(new InMemoryAdapter());
  assert.equal(await db.ensureTypedStoreReady(), false);
  assert.equal(db.isTypedStoreReady(), false);
  const kpis = await db.getDashboardKpisAsync();
  assert.equal(kpis.todaySales, db.getDashboardKpis().todaySales);
  assert.deepEqual(await db.getReportSummaryAsync(todayStr, todayStr), db.getReportSummary(todayStr, todayStr));
  // Restore the node-sqlite backend for any later work.
  db.setPersistenceBackend(adapter);
});
