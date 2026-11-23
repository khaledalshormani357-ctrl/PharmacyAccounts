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
const expiryNotifications = require('../.test-build/services/expiry-notifications.js');

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

function isoInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

test('updateCustomer persists the new name to device storage', async () => {
  await db.databaseReady;
  const customer = db.addCustomer({ name: 'Audit persistence customer', opening_balance: 0 });
  db.updateCustomer(customer.id, { name: 'Audit persistence customer (updated)' });
  await db.flushDatabaseWrites();
  const snapshot = JSON.parse(persisted.get(STORE_KEY));
  const saved = snapshot.store.customers.find(c => c.id === customer.id);
  assert.ok(saved);
  assert.equal(saved.name, 'Audit persistence customer (updated)');
  assert.equal(db.getCustomer(customer.id).name, 'Audit persistence customer (updated)');
});

test('credit limit blocks a credit sale over the limit and allows one within it', () => {
  const medicine = product('Credit limit example');
  configure(medicine.id);
  buy(medicine.id, 'CREDIT-LIMIT-BATCH', '2027-12-31', 20, 'Tablet', 10);
  assert.equal(db.getProductStock(medicine.id), 20);
  const customer = db.addCustomer({ name: 'Credit limit customer', credit_limit: 100 });
  assert.equal(db.checkCreditLimit(customer.id, 150).allowed, false);
  assert.equal(db.checkCreditLimit(customer.id, 50).allowed, true);
  assert.equal(db.checkCreditLimit(999999, 1), null);

  const overLimit = db.createSale({
    sale_type: 'credit', customer_id: customer.id,
    items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 10, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  });
  assert.equal(overLimit.success, false);
  assert.match(overLimit.error || '', /تجاوز حد الائتمان/);
  assert.equal(db.getProductStock(medicine.id), 20);

  const withinLimit = db.createSale({
    sale_type: 'credit', customer_id: customer.id,
    items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 10, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 100,
  });
  assert.equal(withinLimit.success, true);
  assert.equal(withinLimit.sale.remaining, 50);
  assert.equal(db.getCustomer(customer.id).balance, 50);
  assert.equal(db.getProductStock(medicine.id), 10);
});

test('restoreBackup without counters recomputes ids so a new product does not reuse an id', async () => {
  await db.databaseReady;
  const backup = db.createBackup();
  const maxBackupProductId = Math.max(0, ...backup.products.map(p => p.id));
  delete backup.ids;
  delete backup.invoice_counter;
  const result = await db.restoreBackup(backup);
  assert.equal(result.success, true);
  const created = product('Restore recompute example');
  assert.ok(created.id > maxBackupProductId);
});

test('getExpiryAlerts returns only batches expiring within 30 days', () => {
  const near = product('Expiry near example');
  configure(near.id);
  buy(near.id, 'EXPIRY-NEAR', isoInDays(10), 5, 'Tablet', 10);
  const far = product('Expiry far example');
  configure(far.id);
  buy(far.id, 'EXPIRY-FAR', isoInDays(80), 5, 'Tablet', 10);

  const alerts = expiryNotifications.getExpiryAlerts();
  assert.ok(alerts.some(a => a.batch_number === 'EXPIRY-NEAR'));
  assert.equal(alerts.some(a => a.batch_number === 'EXPIRY-FAR'), false);
  const nearAlert = alerts.find(a => a.batch_number === 'EXPIRY-NEAR');
  assert.equal(nearAlert.product_name, 'Expiry near example');
  assert.equal(nearAlert.expiry_date, isoInDays(10));
  assert.ok(nearAlert.days_to_expiry > 0 && nearAlert.days_to_expiry <= 30);
  assert.equal(nearAlert.quantity, 5);
  assert.match(expiryNotifications.formatExpiryAlertSummary(alerts), /تنبيه صلاحية/);
});
