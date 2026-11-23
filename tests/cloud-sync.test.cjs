const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const sync = require('../.test-build/services/cloud-sync.js');

// ─── Fake Supabase client (in-memory tables) ────────────────────────

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.orderBy = null;
    this.limitN = null;
    this.selectCols = '*';
    this.pendingUpdate = null;
  }

  select(cols = '*') { this.selectCols = cols; return this; }
  eq(col, val) { this.filters.push(r => r[col] === val); return this; }
  in(col, vals) { this.filters.push(r => vals.includes(r[col])); return this; }
  gt(col, val) { this.filters.push(r => String(r[col] ?? '') > String(val)); return this; }
  order(col, opts = {}) { this.orderBy = { col, asc: opts.ascending !== false }; return this; }
  limit(n) { this.limitN = n; return this; }

  _rows() {
    return this.client.tables[this.table] ? [...this.client.tables[this.table]] : [];
  }

  _run() {
    let rows = this._rows();
    if (this.pendingUpdate) {
      for (const row of rows) {
        if (this.filters.every(f => f(row))) Object.assign(row, this.pendingUpdate);
      }
    }
    rows = rows.filter(r => this.filters.every(f => f(r)));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows.sort((a, b) => (asc
        ? String(a[col] ?? '').localeCompare(String(b[col] ?? ''))
        : String(b[col] ?? '').localeCompare(String(a[col] ?? ''))));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.selectCols && this.selectCols !== '*') {
      const cols = this.selectCols.split(',').map(s => s.trim());
      rows = rows.map(r => {
        const out = {};
        for (const c of cols) out[c] = r[c];
        return out;
      });
    }
    return rows;
  }

  async maybeSingle() {
    const rows = this._run();
    return { data: rows[0] ?? null, error: null };
  }

  async upsert(rows) {
    const table = this.client.tables[this.table] || (this.client.tables[this.table] = []);
    for (const row of rows) {
      const stored = { ...row };
      if (!stored.id) stored.id = `remote-${stored.client_id}`;
      const i = table.findIndex(r => r.client_id === stored.client_id);
      if (i >= 0) table[i] = { ...table[i], ...stored };
      else table.push(stored);
    }
    return { data: rows, error: null };
  }

  update(values) { this.pendingUpdate = values; return this; }

  then(onFulfilled, onRejected) {
    return Promise.resolve({ data: this._run(), error: null }).then(onFulfilled, onRejected);
  }
}

function makeFakeClient({ sessionUserId = 'user-1', pharmacyId = 'pharm-1' } = {}) {
  const client = {
    tables: {},
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
      }),
    },
    from(table) { return new FakeQuery(client, table); },
  };
  client.tables.pharmacy_profiles = [{ id: sessionUserId, pharmacy_id: pharmacyId }];
  return client;
}

// ─── Fixture helpers ────────────────────────────────────────────────

function makeProduct(name) {
  return db.addProduct({
    barcode: null, internal_code: null, trade_name: name, generic_name: null, active_ingredient: null,
    strength: null, dosage_form: null, manufacturer: null, category: null, prescription_required: false,
    controlled: false, inventory_unit: 'Tablet', minimum_stock: 0, reorder_level: 0, selling_price: 15,
    default_purchase_price: 10, active: true, notes: null,
  });
}

function configureUnits(productId) {
  return db.replaceProductUnits(productId, [
    { unit_name: 'Tablet', conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
      sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true },
  ]);
}

// ─── Pure helpers ───────────────────────────────────────────────────

test('resolveConflict: the newer row wins, ties break on the larger device id', () => {
  assert.equal(sync.resolveConflict(
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'aaa' },
    { updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'aaa' },
  ), 'remote');
  assert.equal(sync.resolveConflict(
    { updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'aaa' },
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'zzz' },
  ), 'local');
  // Exact tie: larger device id wins, deterministically on every device.
  assert.equal(sync.resolveConflict(
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'aaa' },
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'zzz' },
  ), 'remote');
  assert.equal(sync.resolveConflict(
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'zzz' },
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'aaa' },
  ), 'local');
  // Same timestamp and same device: the same write, keep local.
  assert.equal(sync.resolveConflict(
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'aaa' },
    { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'aaa' },
  ), 'local');
});

test('parseSyncTimestamp reads ISO and legacy space-separated timestamps', () => {
  assert.equal(sync.parseSyncTimestamp('2026-01-02T00:00:00.000Z'), Date.parse('2026-01-02T00:00:00.000Z'));
  assert.equal(sync.parseSyncTimestamp('2026-01-02 00:00:00'), Date.parse('2026-01-02T00:00:00.000Z'));
  assert.equal(sync.parseSyncTimestamp('2026-01-02'), Date.parse('2026-01-02T00:00:00.000Z'));
  assert.equal(sync.parseSyncTimestamp(null), 0);
  assert.equal(sync.parseSyncTimestamp('not-a-date'), 0);
  assert.ok(sync.parseSyncTimestamp('2026-01-02T00:00:00.000Z') > sync.parseSyncTimestamp('2026-01-01 00:00:00'));
});

test('buildPullQuery describes a pull by table and lower bound', () => {
  assert.deepEqual(sync.buildPullQuery('sales', '2026-01-01T00:00:00.000Z'), {
    table: 'sales',
    gt: '2026-01-01T00:00:00.000Z',
  });
});

test('mapLocalRowToRemote and mapRemoteRowToLocal round-trip products, sales and customers', () => {
  const ctx = {
    pharmacyId: 'pharm-1',
    deviceId: 'device-1',
    updatedBy: 'user-1',
    resolveSyncId: (collection, localId) => `sync-${collection}-${localId}`,
  };
  const pullCtx = {
    resolveLocalId: (collection, clientId) => {
      const match = /^sync-(.+)-(\d+)$/.exec(clientId);
      return match ? Number(match[2]) : null;
    },
  };

  const product = {
    id: 7, syncId: 'sync-products-7', updatedAt: '2026-11-20T10:00:00.000Z', syncDeviceId: 'device-1',
    barcode: '123', internal_code: null, trade_name: 'Paracetamol', generic_name: null,
    active_ingredient: null, strength: '500mg', dosage_form: 'Tablet', manufacturer: null,
    category: null, prescription_required: false, controlled: false, inventory_unit: 'Tablet',
    minimum_stock: 5, reorder_level: 2, selling_price: 15, default_purchase_price: 10,
    active: true, notes: null, created_at: '2026-11-20 10:00:00', updated_at: '2026-11-20 10:00:00',
  };
  const remoteProduct = sync.mapLocalRowToRemote('products', product, ctx);
  assert.equal(remoteProduct.client_id, 'sync-products-7');
  assert.equal(remoteProduct.pharmacy_id, 'pharm-1');
  assert.equal(remoteProduct.trade_name, 'Paracetamol');
  assert.equal(remoteProduct.selling_price, 15);
  assert.equal(remoteProduct.updated_at, '2026-11-20T10:00:00.000Z');
  assert.equal(remoteProduct.device_id, 'device-1');
  assert.equal('id' in remoteProduct, false);
  const backProduct = sync.mapRemoteRowToLocal('products', remoteProduct, pullCtx);
  assert.equal(backProduct.syncId, 'sync-products-7');
  assert.equal(backProduct.trade_name, 'Paracetamol');
  assert.equal(backProduct.selling_price, 15);
  assert.equal(backProduct.minimum_stock, 5);

  const sale = {
    id: 3, syncId: 'sync-sales-3', updatedAt: '2026-11-21T09:00:00.000Z', syncDeviceId: 'device-1',
    invoice_number: 'INV-000123', sale_type: 'credit', customer_id: 9, customer_name: 'Ahmad',
    subtotal: 100, discount: 0, total: 100, amount_paid: 40, change_given: 0, remaining: 60,
    cogs: 60, gross_profit: 40, date: '2026-11-21', shift_id: null, user_id: 1, notes: null,
    cancelled: false, cancelled_by: null, cancelled_at: null, cancel_reason: null,
    created_at: '2026-11-21 09:00:00',
  };
  const remoteSale = sync.mapLocalRowToRemote('sales', sale, ctx);
  assert.equal(remoteSale.client_id, 'sync-sales-3');
  assert.equal(remoteSale.customer_client_id, 'sync-customers-9');
  assert.equal(remoteSale.invoice_number, 'INV-000123');
  assert.equal('customer_id' in remoteSale, false);
  const backSale = sync.mapRemoteRowToLocal('sales', remoteSale, pullCtx);
  assert.equal(backSale.syncId, 'sync-sales-3');
  assert.equal(backSale.customer_id, 9);
  assert.equal(backSale.total, 100);
  assert.equal(backSale.remaining, 60);

  const customer = {
    id: 9, syncId: 'sync-customers-9', updatedAt: '2026-11-21T09:00:00.000Z', syncDeviceId: 'device-1',
    name: 'Ahmad', phone: '777', address: null, credit_limit: 500, balance: 60, notes: null,
    created_at: '2026-11-21 09:00:00',
  };
  const remoteCustomer = sync.mapLocalRowToRemote('customers', customer, ctx);
  assert.equal(remoteCustomer.client_id, 'sync-customers-9');
  assert.equal(remoteCustomer.name, 'Ahmad');
  assert.equal(remoteCustomer.balance, 60);
  const backCustomer = sync.mapRemoteRowToLocal('customers', remoteCustomer, pullCtx);
  assert.equal(backCustomer.syncId, 'sync-customers-9');
  assert.equal(backCustomer.name, 'Ahmad');
  assert.equal(backCustomer.credit_limit, 500);
});

// ─── Outbox ─────────────────────────────────────────────────────────

test('a local edit lands in the outbox and clearSyncedOutbox removes it', async () => {
  await db.databaseReady;
  const before = db.getPendingSyncCount();
  const product = makeProduct('Outbox product');
  await db.flushDatabaseWrites();
  assert.ok(db.getPendingSyncCount() > before);
  const entry = db.getSyncOutboxSnapshot().find(e => e.syncId === product.syncId);
  assert.ok(entry, 'product edit should be in the outbox');
  assert.equal(entry.collection, 'products');
  assert.equal(entry.op, 'upsert');
  assert.ok(product.syncId);
  assert.ok(product.updatedAt);

  const customer = db.addCustomer({ name: 'Outbox customer', opening_balance: 0 });
  db.updateCustomer(customer.id, { name: 'Outbox customer (renamed)' });
  await db.flushDatabaseWrites();
  const customerEntries = db.getSyncOutboxSnapshot().filter(e => e.syncId === customer.syncId);
  assert.equal(customerEntries.length, 1, 'repeated edits merge into one entry');
  assert.equal(customerEntries[0].op, 'upsert');

  db.clearSyncedOutbox([product.syncId, customer.syncId]);
  await db.flushDatabaseWrites();
  assert.equal(db.getSyncOutboxSnapshot().some(e => e.syncId === product.syncId), false);
  assert.equal(db.getSyncOutboxSnapshot().some(e => e.syncId === customer.syncId), false);
});

test('deleting a customer records a delete entry, not an upsert', async () => {
  await db.databaseReady;
  const customer = db.addCustomer({ name: 'Delete-me customer', opening_balance: 0 });
  await db.flushDatabaseWrites();
  db.clearSyncedOutbox([customer.syncId]);
  await db.flushDatabaseWrites();
  db.deleteCustomer(customer.id);
  await db.flushDatabaseWrites();
  const entry = db.getSyncOutboxSnapshot().find(e => e.syncId === customer.syncId);
  assert.ok(entry);
  assert.equal(entry.op, 'delete');
  db.clearSyncedOutbox([customer.syncId]);
});

// ─── Engine with a fake client ──────────────────────────────────────

test('syncNow pushes the outbox, clears it, and pulls remote rows', async () => {
  await db.databaseReady;
  const client = makeFakeClient();
  const product = makeProduct('Sync push product');
  configureUnits(product.id);
  const customer = db.addCustomer({ name: 'Sync push customer', opening_balance: 0 });
  await db.flushDatabaseWrites();
  assert.ok(db.getPendingSyncCount() > 0);

  const result = await sync.syncNow({ client });
  assert.ok(result.pushed > 0, `expected pushed > 0, got ${JSON.stringify(result)}`);
  assert.deepEqual(result.errors, []);
  assert.equal(db.getPendingSyncCount(), 0);

  const remoteProduct = client.tables.products.find(r => r.client_id === product.syncId);
  assert.ok(remoteProduct);
  assert.equal(remoteProduct.trade_name, 'Sync push product');
  assert.equal(remoteProduct.pharmacy_id, 'pharm-1');
  const remoteUnits = client.tables.product_units.filter(r => r.product_client_id === product.syncId);
  assert.ok(remoteUnits.length >= 1, 'product units should push with the product client id');

  // A newer remote row replaces the local row (conflict resolved to remote).
  remoteProduct.trade_name = 'Sync push product (renamed remotely)';
  remoteProduct.updated_at = '2999-01-01T00:00:00.000Z';
  const pulled = await sync.syncNow({ client });
  assert.ok(pulled.pulled > 0);
  assert.ok(pulled.conflictsResolved >= 1);
  assert.equal(db.getProduct(product.id).trade_name, 'Sync push product (renamed remotely)');

  // An older remote row must not touch the newer local row.
  remoteProduct.trade_name = 'Stale remote name';
  remoteProduct.updated_at = '2020-01-01T00:00:00.000Z';
  const stale = await sync.syncNow({ client });
  assert.equal(db.getProduct(product.id).trade_name, 'Sync push product (renamed remotely)');
  assert.ok(stale.errors.length === 0);

  // A remote delete removes the local row.
  const remoteCustomer = client.tables.customers.find(r => r.client_id === customer.syncId);
  assert.ok(remoteCustomer);
  remoteCustomer.deleted_at = '2999-01-01T00:00:00.000Z';
  remoteCustomer.updated_at = '2999-01-01T00:00:00.000Z';
  const deleted = await sync.syncNow({ client });
  assert.ok(deleted.deletedApplied >= 1);
  assert.equal(db.getCustomer(customer.id), null);

  // A brand-new remote row appears locally.
  client.tables.products.push({
    id: 'remote-new', client_id: 'sync-remote-new-product', pharmacy_id: 'pharm-1',
    trade_name: 'Remote-only product', barcode: null, internal_code: null, generic_name: null,
    active_ingredient: null, strength: null, dosage_form: null, manufacturer: null, category: null,
    prescription_required: false, controlled: false, inventory_unit: 'Tablet', minimum_stock: 0,
    reorder_level: 0, selling_price: 20, default_purchase_price: 12, active: true, notes: null,
    created_at: '2999-01-01T00:00:00.000Z', updated_at: '2999-01-01T00:00:00.000Z',
    deleted_at: null, device_id: 'device-2',
  });
  const inserted = await sync.syncNow({ client });
  assert.ok(inserted.pulled > 0);
  const localNew = db.getProducts().find(p => p.syncId === 'sync-remote-new-product');
  assert.ok(localNew, 'remote-only product should appear locally');
  assert.equal(localNew.trade_name, 'Remote-only product');
  // Pulled rows must not echo back into the outbox.
  assert.equal(db.getPendingSyncCount(), 0);
});

test('syncNow without a signed-in user fails with not-signed-in and changes nothing', async () => {
  await db.databaseReady;
  const client = makeFakeClient({ sessionUserId: null });
  const before = db.getPendingSyncCount();
  await assert.rejects(
    () => sync.syncNow({ client }),
    (error) => {
      assert.equal(error.code, 'not-signed-in');
      assert.match(error.message, /سجّل الدخول/);
      return true;
    },
  );
  assert.equal(db.getPendingSyncCount(), before);
});

test('syncNow without a client fails with not-configured', async () => {
  await assert.rejects(
    () => sync.syncNow({}),
    (error) => {
      assert.equal(error.code, 'not-configured');
      return true;
    },
  );
});

test('getSyncStatus reports pending changes and the signed-in state', async () => {
  await db.databaseReady;
  const client = makeFakeClient();
  const status = await sync.getSyncStatus({ client });
  assert.equal(status.configured, true);
  assert.equal(status.signedIn, true);
  assert.equal(status.hasPharmacy, true);
  assert.equal(status.pending, db.getPendingSyncCount());
  assert.ok(status.deviceId);

  const anonymous = await sync.getSyncStatus({ client: makeFakeClient({ sessionUserId: null }) });
  assert.equal(anonymous.signedIn, false);

  const unconfigured = await sync.getSyncStatus({});
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.signedIn, false);
});

// ─── SQL migration file ─────────────────────────────────────────────

test('006_cloud_sync.sql covers every synced table with RLS and client_id', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/006_cloud_sync.sql'), 'utf8');
  const tables = [
    'batches', 'stock_movements', 'sales', 'sale_items', 'sale_batch_allocations',
    'sale_payments', 'sale_returns', 'purchases', 'purchase_items', 'purchase_returns',
    'customers', 'customer_transactions', 'suppliers', 'supplier_transactions',
    'cash_transactions', 'shifts', 'expenses', 'audit_logs',
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`, 'i'), `missing table ${table}`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `missing RLS on ${table}`);
    assert.match(sql, new RegExp(`${table}_member_all`, 'i'), `missing RLS policy on ${table}`);
  }
  assert.match(sql, /client_id uuid not null unique/);
  assert.match(sql, /deleted_at timestamptz/);
  assert.match(sql, /device_id text/);
  assert.match(sql, /alter table public\.products/);
  assert.match(sql, /alter table public\.product_units/);
  assert.match(sql, /current_pharmacy_id\(\)/);
  assert.match(sql, /\(pharmacy_id, updated_at\)/);
});
