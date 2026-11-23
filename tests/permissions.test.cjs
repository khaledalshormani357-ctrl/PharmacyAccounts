const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
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
const session = require('../.test-build/services/session.js');

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

function cashSale(productId, quantity = 1) {
  return db.createSale({
    sale_type: 'cash', customer_id: null,
    items: [{ product_id: productId, unit: 'Tablet', quantity, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 15 * quantity,
  });
}

function deniedCount() {
  return db.getAuditLogs().filter(log => log.action === 'PERMISSION_DENIED').length;
}

let admin; let cashier; let storekeeper; let overrideCashier; let inactiveUser;
let medicine; let customer; let cashierSale;

test('setup: users, product, stock and customer (legacy local mode)', async () => {
  await db.databaseReady;
  session.clearCurrentActor();
  admin = db.addUser({ username: 'perm-admin', password: 'admin-pass', full_name: 'Perm Admin', role: 'ADMIN' });
  cashier = db.addUser({ username: 'perm-cashier', password: 'cashier-pass', full_name: 'Perm Cashier', role: 'CASHIER' });
  storekeeper = db.addUser({ username: 'perm-store', password: 'store-pass', full_name: 'Perm Storekeeper', role: 'STOREKEEPER' });
  overrideCashier = db.addUser({
    username: 'perm-cashier-plus', password: 'plus-pass', full_name: 'Perm Cashier Plus',
    role: 'CASHIER', permissions: { 'sales.cancel': true },
  });
  inactiveUser = db.addUser({ username: 'perm-inactive', password: 'inactive-pass', full_name: 'Perm Inactive', role: 'CASHIER' });
  db.updateUser(inactiveUser.id, { active: false });
  medicine = product('Permission medicine');
  configure(medicine.id);
  assert.equal(buy(medicine.id, 'PERM-BATCH', '2027-12-31', 1, 'Box', 1000).success, true);
  assert.equal(db.getProductStock(medicine.id), 100);
  customer = db.addCustomer({ name: 'Permission customer', opening_balance: 0 });
});

test('cashier can create a cash sale', () => {
  session.setCurrentActor(cashier);
  const result = cashSale(medicine.id, 1);
  assert.equal(result.success, true);
  cashierSale = result.sale;
  assert.equal(db.getProductStock(medicine.id), 99);
});

test('cashier is refused a credit sale and nothing changes', () => {
  session.setCurrentActor(cashier);
  const stockBefore = db.getProductStock(medicine.id);
  const balanceBefore = db.getCustomer(customer.id).balance;
  const salesBefore = db.getSales().length;
  const deniedBefore = deniedCount();
  const result = db.createSale({
    sale_type: 'credit', customer_id: customer.id,
    items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 2, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  });
  assert.equal(result.success, false);
  assert.match(result.error, /ليس لديك صلاحية/);
  assert.equal(db.getProductStock(medicine.id), stockBefore);
  assert.equal(db.getCustomer(customer.id).balance, balanceBefore);
  assert.equal(db.getSales().length, salesBefore);
  assert.equal(deniedCount(), deniedBefore + 1);
});

test('cashier is refused cancelSale, addUser and restoreBackup', async () => {
  session.clearCurrentActor();
  const backup = db.createBackup();
  session.setCurrentActor(cashier);
  assert.throws(() => db.cancelSale(cashierSale.id, 'permission test'), /ليس لديك صلاحية/);
  assert.equal(db.getSale(cashierSale.id).cancelled, false);
  assert.throws(
    () => db.addUser({ username: 'perm-nope', password: 'nope-pass', full_name: 'Nope', role: 'CASHIER' }),
    /ليس لديك صلاحية/,
  );
  const restored = await db.restoreBackup(backup);
  assert.equal(restored.success, false);
  assert.match(restored.error, /ليس لديك صلاحية/);
});

test('storekeeper is refused a sale but may apply a stocktake', () => {
  session.setCurrentActor(storekeeper);
  assert.equal(cashSale(medicine.id, 1).success, false);
  const batch = db.getBatches(medicine.id, false)[0];
  const result = db.applyStocktake({
    counts: [{ product_id: medicine.id, batch_id: batch.id, actual_quantity: batch.quantity }],
    reason: 'permission test',
  });
  assert.equal(result.success, true);
});

test('admin is allowed a credit sale, cancellation, user creation and restore', async () => {
  session.setCurrentActor(admin);
  const credit = db.createSale({
    sale_type: 'credit', customer_id: customer.id,
    items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  });
  assert.equal(credit.success, true);
  db.cancelSale(credit.sale.id, 'admin permission test');
  assert.equal(db.getSale(credit.sale.id).cancelled, true);
  const created = db.addUser({ username: 'perm-admin-created', password: 'created-pass', full_name: 'Admin Created', role: 'CASHIER' });
  assert.ok(created.id);
  const backup = db.createBackup();
  const restored = await db.restoreBackup(backup);
  assert.equal(restored.success, true);
});

test('a per-user override lets a cashier cancel a sale', () => {
  session.setCurrentActor(admin);
  const sale = cashSale(medicine.id, 1);
  assert.equal(sale.success, true);
  session.setCurrentActor(overrideCashier);
  assert.equal(session.can('sales.cancel'), true);
  assert.equal(session.can('sales.create'), true);
  assert.equal(session.can('system.users'), false);
  db.cancelSale(sale.sale.id, 'override permission test');
  assert.equal(db.getSale(sale.sale.id).cancelled, true);
});

test('denials change no data and are recorded in the audit log', () => {
  session.setCurrentActor(cashier);
  const stockBefore = db.getProductStock(medicine.id);
  const balanceBefore = db.getCustomer(customer.id).balance;
  const salesBefore = db.getSales().length;
  const usersBefore = db.getUsers().length;
  const deniedBefore = deniedCount();
  assert.equal(db.createSale({
    sale_type: 'credit', customer_id: customer.id,
    items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }],
    discount: 0, amount_paid: 0,
  }).success, false);
  assert.throws(() => db.cancelSale(cashierSale.id, 'denial audit test'), /ليس لديك صلاحية/);
  assert.throws(
    () => db.addUser({ username: 'perm-nope-2', password: 'nope-pass', full_name: 'Nope 2', role: 'CASHIER' }),
    /ليس لديك صلاحية/,
  );
  assert.equal(db.getProductStock(medicine.id), stockBefore);
  assert.equal(db.getCustomer(customer.id).balance, balanceBefore);
  assert.equal(db.getSales().length, salesBefore);
  assert.equal(db.getUsers().length, usersBefore);
  assert.equal(deniedCount(), deniedBefore + 3);
  const lastDenials = db.getAuditLogs().filter(log => log.action === 'PERMISSION_DENIED').slice(-3);
  assert.deepEqual(lastDenials.map(log => log.reason), ['customers.credit', 'sales.cancel', 'system.users']);
});

test('an inactive user is denied everything', () => {
  session.setCurrentActor(inactiveUser);
  assert.equal(session.can('sales.create'), false);
  assert.throws(() => session.requirePermission('sales.create'), /PERMISSION_DENIED: sales\.create/);
  assert.equal(cashSale(medicine.id, 1).success, false);
  assert.throws(
    () => db.addUser({ username: 'perm-nope-3', password: 'nope-pass', full_name: 'Nope 3', role: 'CASHIER' }),
    /ليس لديك صلاحية/,
  );
  assert.throws(() => db.createBackup(), /ليس لديك صلاحية/);
});

test('with no actor bound (local mode) operations work as before', () => {
  session.clearCurrentActor();
  assert.equal(session.getCurrentActor(), null);
  assert.equal(session.can('sales.create'), false);
  assert.equal(cashSale(medicine.id, 1).success, true);
  const created = db.addUser({ username: 'perm-local', password: 'local-pass', full_name: 'Local Mode', role: 'CASHIER' });
  assert.ok(created.id);
});

test('resolveActorForUsername matches case-insensitively and ignores inactive users', () => {
  assert.equal(session.resolveActorForUsername(' PERM-CASHIER ').id, cashier.id);
  assert.equal(session.resolveActorForUsername('perm-admin').id, admin.id);
  assert.equal(session.resolveActorForUsername('perm-inactive'), null);
  assert.equal(session.resolveActorForUsername('no-such-user'), null);
  session.clearCurrentActor();
});
