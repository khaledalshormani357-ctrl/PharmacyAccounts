const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

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

function product(name, purchasePrice = 10) {
  return db.addProduct({
    barcode: null, internal_code: null, trade_name: name, generic_name: null, active_ingredient: null,
    strength: null, dosage_form: null, manufacturer: null, category: null, prescription_required: false,
    controlled: false, inventory_unit: 'Tablet', minimum_stock: 0, reorder_level: 0, selling_price: 15,
    default_purchase_price: purchasePrice, active: true, notes: null,
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

function buy(productId, batch, expiry, quantity, unit, price) {
  return db.createPurchase({ supplier_id: null, date: '2026-10-07', items: [{
    product_id: productId, batch_number: batch, expiry_date: expiry, unit, quantity,
    purchase_price: price, free_quantity: 0, discount: 0,
  }], discount: 0, amount_paid: 0 });
}

function fullSnapshot() {
  const store = sqliteStore.emptyStore();
  store.settings = { pharmacy_name: 'Test pharmacy', currency: 'ريال يمني', currency_symbol: 'ر.ي' };
  store.pharmacy = null;
  store.products = [
    { id: 1, trade_name: 'Aspirin', selling_price: 15, created_at: '2026-01-01 00:00:00' },
    { id: 2, trade_name: 'Paracetamol', selling_price: 10, created_at: '2026-01-01 00:00:00' },
  ];
  store.customers = [{ id: 1, name: 'Customer One', balance: 50, credit_limit: 100 }];
  store.batches = [{ id: 1, product_id: 1, batch_number: 'B1', quantity: 20, expiry_date: '2027-12-31' }];
  return { store, ids: { products: 3, customers: 2, batches: 2 }, invoiceCounter: 1007 };
}

test('buildSchemaSql creates the meta and collections tables', () => {
  const sql = sqliteStore.buildSchemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS meta \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS collections \(/);
  assert.match(sql, /PRIMARY KEY \(collection, row_id\)/);
});

test('snapshotToRows / rowsToSnapshot round-trip loses nothing, including pharmacy=null', () => {
  const snapshot = fullSnapshot();
  const rows = sqliteStore.snapshotToRows(snapshot);
  assert.ok(rows.meta.some(([key, value]) => key === 'invoice_counter' && value === '1007'));
  assert.ok(rows.meta.some(([key]) => key === 'settings'));
  assert.equal(rows.rows.filter(row => row.collection === 'products').length, 2);
  const restored = sqliteStore.rowsToSnapshot(rows);
  assert.deepEqual(restored, snapshot);
});

test('snapshotToRows / rowsToSnapshot round-trip preserves a non-null pharmacy', () => {
  const snapshot = fullSnapshot();
  snapshot.store.pharmacy = { id: 1, name: 'City Pharmacy', owner_name: 'Owner', currency: 'ريال يمني' };
  assert.deepEqual(sqliteStore.rowsToSnapshot(sqliteStore.snapshotToRows(snapshot)), snapshot);
});

test('diffSnapshots returns only changed, added and deleted rows', () => {
  const prev = fullSnapshot();
  const next = fullSnapshot();
  next.store.products = [
    { id: 1, trade_name: 'Aspirin (updated)', selling_price: 16, created_at: '2026-01-01 00:00:00' },
    { id: 3, trade_name: 'Ibuprofen', selling_price: 12, created_at: '2026-01-01 00:00:00' },
  ];
  next.ids = { products: 4, customers: 2, batches: 2 };
  next.invoiceCounter = 1008;
  const diff = sqliteStore.diffSnapshots(prev, next);
  assert.deepEqual(
    diff.upserts.map(row => `${row.collection}:${row.rowId}`).sort(),
    ['products:1', 'products:3'],
  );
  assert.deepEqual(diff.deletes, [{ collection: 'products', rowId: 2 }]);
  // The untouched customer row must not be rewritten.
  assert.equal(diff.upserts.some(row => row.collection === 'customers'), false);
  assert.ok(diff.metaUpserts.some(([key, value]) => key === 'invoice_counter' && value === '1008'));
  assert.ok(diff.metaUpserts.some(([key]) => key === 'ids'));
  assert.equal(diff.metaUpserts.some(([key]) => key === 'settings'), false);
  // Applying the diff reproduces the next snapshot exactly.
  assert.deepEqual(sqliteStore.applyDiffToSnapshot(prev, diff), next);
});

test('InMemoryAdapter round-trips a snapshot and a mid-save failure leaves the stored snapshot intact', async () => {
  const adapter = new sqliteStore.InMemoryAdapter();
  const first = fullSnapshot();
  await adapter.saveSnapshot(first);
  assert.deepEqual(await adapter.loadSnapshot(), first);

  adapter.setFailBeforeCommit(() => true);
  const second = fullSnapshot();
  second.invoiceCounter = 2000;
  await assert.rejects(() => adapter.saveSnapshot(second), /injected in-memory save failure/);
  assert.deepEqual(await adapter.loadSnapshot(), first);

  adapter.setFailBeforeCommit(undefined);
  await adapter.saveSnapshot(second);
  assert.deepEqual(await adapter.loadSnapshot(), second);

  // A value that cannot be serialised throws before anything is committed.
  const circular = fullSnapshot();
  circular.store.self = circular.store;
  await assert.rejects(() => adapter.saveSnapshot(circular));
  assert.deepEqual(await adapter.loadSnapshot(), second);
});

test('InMemoryAdapter applies diffs without rewriting unchanged rows', async () => {
  const adapter = new sqliteStore.InMemoryAdapter();
  const prev = fullSnapshot();
  await adapter.saveSnapshot(prev);
  const next = fullSnapshot();
  next.store.products = [{ id: 1, trade_name: 'Aspirin (updated)', selling_price: 16, created_at: '2026-01-01 00:00:00' }];
  next.ids = { products: 2, customers: 2, batches: 2 };
  await adapter.saveDiff(sqliteStore.diffSnapshots(prev, next));
  const loaded = await adapter.loadSnapshot();
  assert.equal(loaded.store.products.length, 1);
  assert.equal(loaded.store.products[0].trade_name, 'Aspirin (updated)');
  assert.equal(loaded.store.customers[0].name, 'Customer One');
});

test('default backend in Node is AsyncStorage and the migration flag starts unset', async () => {
  await db.databaseReady;
  assert.equal(db.getPersistenceBackendName(), 'async-storage');
  assert.equal(db.getMigrationStatus().migratedFromAsyncStorage, false);
});

let migrationAdapter = null;

test('migration moves the legacy AsyncStorage snapshot into the new backend and keeps the legacy copy', async () => {
  await db.databaseReady;
  const medicine = product('Migration example');
  configure(medicine.id);
  buy(medicine.id, 'MIG-BATCH', '2027-12-31', 1, 'Box', 1000);
  await db.flushDatabaseWrites();

  const legacyRaw = persisted.get(STORE_KEY);
  assert.ok(legacyRaw, 'expected a legacy snapshot in AsyncStorage');
  const legacySnapshot = JSON.parse(legacyRaw);

  migrationAdapter = new sqliteStore.InMemoryAdapter();
  db.setPersistenceBackend(migrationAdapter);
  assert.equal(db.getPersistenceBackendName(), 'in-memory');

  const migrated = await db.migrateFromAsyncStorageIfNeeded();
  assert.equal(migrated, true);
  assert.deepEqual(await migrationAdapter.loadSnapshot(), legacySnapshot);
  // Rollback copy: the legacy AsyncStorage snapshot is untouched.
  assert.equal(persisted.get(STORE_KEY), legacyRaw);
  assert.equal(db.getMigrationStatus().migratedFromAsyncStorage, true);
  assert.equal(db.getMigrationStatus().backend, 'in-memory');
  assert.equal(
    await migrationAdapter.getMeta('migrated_from_asyncstorage'),
    '1',
  );
});

test('a mid-commit failure leaves no intermediate rows in the persistence backend', async () => {
  await db.databaseReady;
  assert.ok(migrationAdapter, 'migration test must run first and set the backend');
  const medicine = product('Atomic persistence example');
  configure(medicine.id);
  buy(medicine.id, 'ATOMIC-PERSIST', '2027-12-31', 1, 'Box', 1000);
  const sale = db.createSale({ sale_type: 'cash', items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 15 });
  assert.equal(sale.success, true);
  const item = db.getSaleItems(sale.sale.id)[0];
  await db.flushDatabaseWrites();
  const before = await migrationAdapter.loadSnapshot();

  const originalToISOString = Date.prototype.toISOString;
  let dateCalls = 0;
  // Inject a late failure after stock and cash mutations, as in the
  // existing atomic-rollback test: the commit must roll back in memory
  // AND must not have persisted any intermediate snapshot.
  // eslint-disable-next-line no-extend-native -- scoped deterministic fault injection; immediately restored below
  Date.prototype.toISOString = function () {
    dateCalls += 1;
    if (dateCalls === 7) throw new Error('forced audit persistence failure');
    return originalToISOString.call(this);
  };
  let failed;
  try {
    failed = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: item.id, quantity: 1 }] });
  } finally {
    // eslint-disable-next-line no-extend-native -- restore the built-in method after the synchronous test case
    Date.prototype.toISOString = originalToISOString;
  }
  assert.equal(failed.success, false);
  assert.match(failed.error, /تم التراجع/);
  await db.flushDatabaseWrites();
  assert.deepEqual(await migrationAdapter.loadSnapshot(), before);
  // The in-memory state is intact too, so a retry succeeds.
  const recovered = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: item.id, quantity: 1 }] });
  assert.equal(recovered.success, true);
});
