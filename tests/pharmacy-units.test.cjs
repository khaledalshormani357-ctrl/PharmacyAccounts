const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let persistedStore = null;
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: {
      getItem: async () => persistedStore,
      setItem: async (_key, value) => { persistedStore = value; },
      removeItem: async () => { persistedStore = null; },
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const conversion = require('../.test-build/services/unit-conversion.js');
const invoice = require('../.test-build/services/customer-invoice.js');
const db = require('../.test-build/services/erp-database.js');

function product(name, purchasePrice = 10) {
  return db.addProduct({
    barcode: null, internal_code: null, trade_name: name, generic_name: null, active_ingredient: null,
    strength: null, dosage_form: null, manufacturer: null, category: null, prescription_required: false,
    controlled: false, inventory_unit: 'Tablet', minimum_stock: 0, reorder_level: 0, selling_price: 15,
    default_purchase_price: purchasePrice, active: true, notes: null,
  });
}

function configure(productId, stripFactor = 10, boxFactor = stripFactor * 10, stripSaleOverride = null) {
  return db.replaceProductUnits(productId, [
    { unit_name: 'Tablet', conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
      sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true },
    { unit_name: 'Strip', conversion_factor: stripFactor, parent_unit_name: 'Tablet', quantity_per_parent: stripFactor,
      sale_price: stripSaleOverride, purchase_price: null, is_purchase_default: false, is_sale_default: false },
    { unit_name: 'Box', conversion_factor: boxFactor, parent_unit_name: 'Strip', quantity_per_parent: 10,
      sale_price: null, purchase_price: null, is_purchase_default: false, is_sale_default: false },
  ]);
}

function buy(productId, batch, expiry, quantity, unit, price) {
  return db.createPurchase({ supplier_id: null, date: '2026-10-07', items: [{
    product_id: productId, batch_number: batch, expiry_date: expiry, unit, quantity,
    purchase_price: price, free_quantity: 0, discount: 0,
  }], discount: 0, amount_paid: 0 });
}

test('1 Box = 100 Tablets; 5 Boxes convert to 500 base units and prices derive automatically', () => {
  const result = conversion.deriveUnitFactors('Tablet', [
    { unit_name: 'Strip', parent_unit_name: 'Tablet', quantity_per_parent: 10 },
    { unit_name: 'Box', parent_unit_name: 'Strip', quantity_per_parent: 10 },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.factors.Box, 100);
  assert.equal(conversion.toBaseQuantity(5, result.factors.Box), 500);
  assert.equal(conversion.priceForUnit(10, 100), 1000);
  assert.equal(1000 / result.factors.Box, 10);
});

test('3 Strips convert to 30 tablets; mixed quantities total 234 and stock decomposes as 2 Boxes + 3 Strips + 4 Tablets', () => {
  const hierarchy = conversion.deriveUnitFactors('Tablet', [
    { unit_name: 'Strip', parent_unit_name: 'Tablet', quantity_per_parent: 10 },
    { unit_name: 'Box', parent_unit_name: 'Strip', quantity_per_parent: 10 },
  ]);
  assert.equal(conversion.toBaseQuantity(3, hierarchy.factors.Strip), 30);
  const mixed = 2 * hierarchy.factors.Box + 3 * hierarchy.factors.Strip + 4;
  assert.equal(mixed, 234);
  assert.deepEqual(conversion.decomposeBaseQuantity(mixed, 'Tablet', [
    { unit_name: 'Tablet', conversion_factor: 1 }, { unit_name: 'Strip', conversion_factor: 10 }, { unit_name: 'Box', conversion_factor: 100 },
  ]), [{ quantity: 2, unit: 'Box' }, { quantity: 3, unit: 'Strip' }, { quantity: 4, unit: 'Tablet' }]);
  assert.deepEqual(conversion.formatUnitEquivalents(5, 'Box', 'Tablet', [
    { unit_name: 'Tablet', conversion_factor: 1 }, { unit_name: 'Strip', conversion_factor: 10 }, { unit_name: 'Box', conversion_factor: 100 },
  ]), [{ quantity: 5, unit: 'Box' }, { quantity: 50, unit: 'Strip' }, { quantity: 500, unit: 'Tablet' }]);
});

test('rejects duplicate, zero, negative, and circular unit definitions', () => {
  assert.equal(conversion.deriveUnitFactors('Tablet', [{ unit_name: 'Tablet', parent_unit_name: 'Tablet', quantity_per_parent: 2 }]).ok, false);
  assert.equal(conversion.deriveUnitFactors('Tablet', [{ unit_name: 'Strip', parent_unit_name: 'Tablet', quantity_per_parent: 0 }]).ok, false);
  assert.equal(conversion.deriveUnitFactors('Tablet', [{ unit_name: 'Strip', parent_unit_name: 'Tablet', quantity_per_parent: -1 }]).ok, false);
  assert.equal(conversion.deriveUnitFactors('Tablet', [
    { unit_name: 'A', parent_unit_name: 'B', quantity_per_parent: 2 },
    { unit_name: 'B', parent_unit_name: 'A', quantity_per_parent: 3 },
  ]).ok, false);
  assert.throws(() => conversion.toBaseQuantity(-1, 10));
  assert.equal(conversion.isValidIsoDate('2026-02-28'), true);
  assert.equal(conversion.isValidIsoDate('2026-02-31'), false);
  assert.equal(conversion.isValidUnitQuantity(0.5, 'Box'), false);
  assert.equal(conversion.isValidUnitQuantity(1.25, 'مل'), true);
});

test('opening stock creates a batch and audit/movement only; cash, supplier payable and purchase count stay unchanged', () => {
  const supplier = db.addSupplier({ name: 'Opening-test supplier' });
  const medicine = product('Opening stock example');
  configure(medicine.id);
  const cashBefore = db.getCashBalance();
  const purchasesBefore = db.getPurchases().length;
  const opening = db.createOpeningStock({ product_id: medicine.id, unit: 'Box', quantity: 5, unit_cost: 1000 });
  assert.equal(opening.success, true);
  assert.equal(opening.base_quantity, 500);
  assert.equal(db.getProductStock(medicine.id), 500);
  assert.equal(opening.batch.purchase_price, 10);
  assert.equal(opening.batch.is_opening, true);
  assert.equal(db.getCashBalance(), cashBefore);
  assert.equal(db.getSupplier(supplier.id).balance, 0);
  assert.equal(db.getPurchases().length, purchasesBefore);
  assert.equal(db.getStockMovements(medicine.id)[0].type, 'OPENING');
  assert.equal(db.canEditOpeningStock(opening.batch.id), true);
  const edited = db.updateOpeningStock({ batch_id: opening.batch.id, base_quantity: 400, unit_cost_per_base: 9, expiry_date: '' });
  assert.equal(edited.success, true);
  assert.equal(db.getProductStock(medicine.id), 400);
  const sale = db.createSale({ sale_type: 'cash', items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 15 });
  assert.equal(sale.success, true);
  assert.equal(db.canEditOpeningStock(opening.batch.id), false);
  assert.equal(db.updateOpeningStock({ batch_id: opening.batch.id, base_quantity: 300, unit_cost_per_base: 9 }).success, false);
});

test('unit-based purchases convert stock and cost to the base unit, and free stock is not billed', () => {
  const medicine = product('Purchase conversion example');
  configure(medicine.id);
  const purchase = buy(medicine.id, 'PURCHASE-A', '2027-01-31', 5, 'Box', 1000);
  assert.equal(purchase.success, true);
  assert.equal(db.getProductStock(medicine.id), 500);
  assert.equal(db.getBatches(medicine.id, false).find(batch => batch.batch_number === 'PURCHASE-A').purchase_price, 10);
  const item = db.getPurchaseItems(purchase.purchase.id)[0];
  assert.equal(item.conversion_factor, 100);
  assert.equal(item.quantity_in_inventory_unit, 500);
  assert.equal(purchase.purchase.total, 5000);

  const freeMedicine = product('Free goods example');
  configure(freeMedicine.id);
  const freePurchase = db.createPurchase({ items: [{ product_id: freeMedicine.id, batch_number: 'FREE-A', expiry_date: '2027-02-01', unit: 'Box', quantity: 1, purchase_price: 1000, free_quantity: 1, discount: 0 }], discount: 0, amount_paid: 0 });
  assert.equal(freePurchase.purchase.total, 1000);
  assert.equal(db.getProductStock(freeMedicine.id), 200);
  assert.equal(db.getBatches(freeMedicine.id, false)[0].purchase_price, 5);
  const freeItem = db.getPurchaseItems(freePurchase.purchase.id)[0];
  const returnAll = db.createPurchaseReturn({ purchase_id: freePurchase.purchase.id, items: [{ purchase_item_id: freeItem.id, quantity: 2 }] });
  assert.equal(returnAll.success, true);
  assert.equal(returnAll.record.total, 1000);
  assert.equal(db.getProductStock(freeMedicine.id), 0);
});

test('sales convert selected units, consume base stock through FEFO, and preserve historical conversion for both returns', () => {
  const medicine = product('FEFO and return example');
  configure(medicine.id);
  const purchaseA = buy(medicine.id, 'BATCH-A', '2027-01-31', 2, 'Box', 1000);
  buy(medicine.id, 'BATCH-B', '2027-06-30', 1, 'Box', 1200);
  assert.equal(db.getProductStock(medicine.id), 300);

  const sale = db.createSale({ sale_type: 'cash', customer_id: null, items: [{ product_id: medicine.id, unit: 'Strip', quantity: 2, unit_price: 120, discount: 0 }], discount: 40, amount_paid: 200 });
  assert.equal(sale.success, true);
  assert.equal(db.getProductStock(medicine.id), 280);
  const saleItem = db.getSaleItems(sale.sale.id)[0];
  assert.equal(saleItem.conversion_factor, 10);
  assert.equal(saleItem.quantity_in_inventory_unit, 20);
  assert.equal(sale.sale.cogs, 200);
  assert.equal(db.getBatches(medicine.id, false).find(batch => batch.batch_number === 'BATCH-A').quantity, 180);
  assert.equal(db.getBatches(medicine.id, false).find(batch => batch.batch_number === 'BATCH-B').quantity, 100);

  configure(medicine.id, 12, 120, 15); // New configuration must not rewrite old transactions or batch cost.
  assert.equal(db.getUnitPrice(medicine.id, 'Strip', 'sale'), 15);
  assert.equal(db.getUnitPrice(medicine.id, 'Strip', 'purchase'), 120);
  assert.equal(db.getBatches(medicine.id, false).find(batch => batch.batch_number === 'BATCH-A').purchase_price, 10);
  assert.equal(db.getProductStock(medicine.id), 280);

  const saleReturn = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: saleItem.id, quantity: 1 }] });
  assert.equal(saleReturn.success, true);
  assert.equal(saleReturn.record.total, 100);
  assert.equal(saleReturn.record.cash_refund, 100);
  assert.equal(saleReturn.record.items[0].conversion_factor, 10);
  assert.equal(saleReturn.record.items[0].quantity_in_inventory_unit, 10);
  assert.equal(db.getProductStock(medicine.id), 290);
  assert.equal(db.getBatches(medicine.id, false).find(batch => batch.batch_number === 'BATCH-A').quantity, 190);
  assert.equal(db.getSaleItemReturnableQuantity(saleItem.id), 1);

  const purchaseItem = db.getPurchaseItems(purchaseA.purchase.id)[0];
  const purchaseReturn = db.createPurchaseReturn({ purchase_id: purchaseA.purchase.id, items: [{ purchase_item_id: purchaseItem.id, quantity: 1 }] });
  assert.equal(purchaseReturn.success, true);
  assert.equal(purchaseReturn.record.items[0].conversion_factor, 100);
  assert.equal(purchaseReturn.record.items[0].quantity_in_inventory_unit, 100);
  assert.equal(db.getProductStock(medicine.id), 190);
  assert.equal(db.getPurchaseItemReturnableQuantity(purchaseItem.id), 1);

  const overReturn = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: saleItem.id, quantity: 2 }] });
  assert.equal(overReturn.success, false);
});

test('customer invoice HTML uses only the whitelisted customer fields', () => {
  const unsafeRuntimeInput = {
    pharmacyName: 'صيدلية', invoiceNumber: 'S-1', date: '2026-10-07', customerName: 'عميل',
    subtotal: 240, discount: 0, total: 240, amountPaid: 240, remaining: 0,
    items: [{ name: 'Panadol', quantity: 2, unit: 'Strip', unitPrice: 120, total: 240 }],
    grossProfit: 999999, netProfit: 999999, cogs: 999999, margin: 99, costPrice: 1000, purchaseCost: 1000,
  };
  const body = invoice.buildCustomerSaleInvoiceBody(unsafeRuntimeInput, amount => `$${amount.toFixed(2)}`);
  assert.match(body, /Panadol/);
  assert.match(body, /2 Strip/);
  assert.match(body, /\$120\.00/);
  assert.doesNotMatch(body, /gross.?profit|net.?profit|margin|COGS|cost.?price|purchase.?cost|999999|تكلفة|الربح|هامش/i);
});
