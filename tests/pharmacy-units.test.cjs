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
const returnInvoice = require('../.test-build/services/return-invoice.js');
const atomicStore = require('../.test-build/services/atomic-store.js');
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

test('independent sales return documents support repeated partials, full completion, and idempotent retries', () => {
  const medicine = product('Independent return example');
  configure(medicine.id);
  buy(medicine.id, 'RETURN-FULL', '2027-12-31', 1, 'Box', 1000);
  const sale = db.createSale({ sale_type: 'cash', items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 10, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 150 });
  assert.equal(sale.success, true);
  const original = sale.sale;
  const item = db.getSaleItems(original.id)[0];
  const stockAfterSale = db.getProductStock(medicine.id);
  const first = db.createSaleReturn({ sale_id: original.id, items: [{ sale_item_id: item.id, quantity: 2 }], idempotency_key: 'sales-partial-unique' });
  assert.equal(first.success, true);
  assert.equal(first.record.return_number.startsWith('SR-'), true);
  assert.equal(first.record.items[0].refund_amount, 30);
  const repeated = db.createSaleReturn({ sale_id: original.id, items: [{ sale_item_id: item.id, quantity: 2 }], idempotency_key: 'sales-partial-unique' });
  assert.equal(repeated.record.id, first.record.id);
  assert.equal(db.getProductStock(medicine.id), stockAfterSale + 2);
  assert.equal(db.getSaleItemReturnableQuantity(item.id), 8);
  const second = db.createSaleReturn({ sale_id: original.id, items: [{ sale_item_id: item.id, quantity: 3 }] });
  assert.equal(second.success, true);
  assert.equal(db.getSaleItemReturnedQuantity(item.id), 5);
  assert.equal(db.getSaleItemReturnableQuantity(item.id), 5);
  const full = db.createSaleReturn({ sale_id: original.id, items: [{ sale_item_id: item.id, quantity: 5 }] });
  assert.equal(full.success, true);
  assert.equal(db.getSaleItemReturnableQuantity(item.id), 0);
  assert.equal(db.getSale(original.id).total, original.total);
  assert.equal(db.getSale(original.id).cancelled, false);
  assert.equal(db.getSaleReturns(original.id).length, 3);
  assert.equal(db.getSaleReturn(full.record.id).return_number, full.record.return_number);
  assert.equal(db.getAllSaleReturns().some(entry => entry.id === full.record.id), true);
  assert.equal(db.getProductStock(medicine.id), 100);
});

test('credit sales returns reduce customer balance while a damaged return is quarantined from sellable stock', () => {
  const customer = db.addCustomer({ name: 'Return credit customer', phone: '555-0101' });
  const medicine = product('Quarantine example');
  configure(medicine.id);
  buy(medicine.id, 'RETURN-DAMAGE', '2027-12-31', 1, 'Box', 1000);
  const sale = db.createSale({ sale_type: 'credit', customer_id: customer.id, items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 10, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 0 });
  const item = db.getSaleItems(sale.sale.id)[0];
  const before = db.getProductStock(medicine.id);
  const damaged = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: item.id, quantity: 2 }], settlement_method: 'CUSTOMER_CREDIT', condition: 'DAMAGED' });
  assert.equal(damaged.success, true);
  assert.equal(damaged.record.cash_refund, 0);
  assert.equal(damaged.record.credit_reduction, damaged.record.total);
  assert.equal(db.getCustomer(customer.id).balance, sale.sale.remaining - damaged.record.total);
  assert.equal(db.getProductStock(medicine.id), before);
  const batch = db.getBatches(medicine.id, false)[0];
  assert.equal(batch.quarantined_quantity, 2);
  assert.equal(db.getStockMovements(medicine.id).find(movement => movement.reference_type === 'sale_return').type, 'DAMAGE');
  assert.equal(damaged.record.condition, 'DAMAGED');
});

test('purchase returns create separate PR records and apply the selected supplier or cash settlement once', () => {
  const supplier = db.addSupplier({ name: 'Return supplier' });
  const medicine = product('Purchase return invoice example');
  configure(medicine.id);
  const purchase = db.createPurchase({ supplier_id: supplier.id, date: '2026-10-07', items: [{ product_id: medicine.id, batch_number: 'SUPPLIER-RETURN', expiry_date: '2027-12-31', unit: 'Box', quantity: 2, purchase_price: 1000, free_quantity: 0, discount: 0 }], discount: 0, amount_paid: 0 });
  const item = db.getPurchaseItems(purchase.purchase.id)[0];
  const beforeStock = db.getProductStock(medicine.id);
  const credit = db.createPurchaseReturn({ purchase_id: purchase.purchase.id, items: [{ purchase_item_id: item.id, quantity: 1 }], settlement_method: 'SUPPLIER_BALANCE', idempotency_key: 'purchase-return-unique' });
  assert.equal(credit.success, true);
  assert.equal(credit.record.return_number.startsWith('PR-'), true);
  assert.equal(credit.record.payable_reduction, credit.record.total);
  assert.equal(credit.record.cash_refund, 0);
  assert.equal(db.getSupplier(supplier.id).balance, purchase.purchase.remaining - credit.record.total);
  assert.equal(db.getProductStock(medicine.id), beforeStock - 100);
  const duplicate = db.createPurchaseReturn({ purchase_id: purchase.purchase.id, items: [{ purchase_item_id: item.id, quantity: 1 }], settlement_method: 'SUPPLIER_BALANCE', idempotency_key: 'purchase-return-unique' });
  assert.equal(duplicate.record.id, credit.record.id);
  assert.equal(db.getProductStock(medicine.id), beforeStock - 100);
  const cashBefore = db.getCashBalance();
  const refundShift = db.openShift({ opening_cash: 2000 });
  const cashPurchase = db.createPurchase({ items: [{ product_id: medicine.id, batch_number: 'CASH-RETURN', expiry_date: '2027-12-31', unit: 'Tablet', quantity: 2, purchase_price: 10, free_quantity: 0, discount: 0 }], discount: 0, amount_paid: 0 });
  const cashItem = db.getPurchaseItems(cashPurchase.purchase.id)[0];
  const cashReturn = db.createPurchaseReturn({ purchase_id: cashPurchase.purchase.id, items: [{ purchase_item_id: cashItem.id, quantity: 1 }], settlement_method: 'CASH_REFUND' });
  assert.equal(cashReturn.success, true);
  assert.equal(cashReturn.record.payable_reduction, 0);
  assert.equal(db.getCashBalance(), cashBefore + cashReturn.record.cash_refund);
  assert.equal(db.getOpenShift().expected_cash, refundShift.opening_cash + cashReturn.record.cash_refund);
  assert.equal(db.getCashTransactions().find(transaction => transaction.reference_type === 'purchase_return' && transaction.reference_id === cashReturn.record.id).shift_id, refundShift.id);
  assert.equal(db.getPurchase(cashPurchase.purchase.id).total, cashPurchase.purchase.total);
  db.closeShift(refundShift.id, db.getCashBalance());
});

test('returning one item from a multi-item invoice leaves every other item untouched', () => {
  const medicines = ['Multi return A', 'Multi return B', 'Multi return C'].map(name => {
    const medicine = product(name);
    configure(medicine.id);
    buy(medicine.id, `BATCH-${medicine.id}`, '2027-12-31', 1, 'Box', 1000);
    return medicine;
  });
  const sale = db.createSale({ sale_type: 'cash', items: medicines.map((medicine, index) => ({ product_id: medicine.id, unit: 'Tablet', quantity: [10, 5, 8][index], unit_price: 15, discount: 0 })), discount: 0, amount_paid: 345 });
  const saleItems = db.getSaleItems(sale.sale.id);
  const before = medicines.map(medicine => db.getProductStock(medicine.id));
  const target = saleItems.find(item => item.product_id === medicines[1].id);
  const result = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: target.id, quantity: 2 }] });
  assert.equal(result.success, true);
  assert.equal(result.record.items.length, 1);
  assert.equal(result.record.items[0].product_id, medicines[1].id);
  assert.equal(db.getSaleItemReturnedQuantity(saleItems.find(item => item.product_id === medicines[0].id).id), 0);
  assert.equal(db.getSaleItemReturnableQuantity(target.id), 3);
  assert.equal(db.getSaleItemReturnedQuantity(saleItems.find(item => item.product_id === medicines[2].id).id), 0);
  assert.equal(db.getProductStock(medicines[0].id), before[0]);
  assert.equal(db.getProductStock(medicines[1].id), before[1] + 2);
  assert.equal(db.getProductStock(medicines[2].id), before[2]);
});

test('an actual mid-commit failure restores batch, cash, movements, audit, return and next identifier', () => {
  const medicine = product('Atomic rollback integration example');
  configure(medicine.id);
  buy(medicine.id, 'ATOMIC-ROLLBACK', '2027-12-31', 1, 'Box', 1000);
  const sale = db.createSale({ sale_type: 'cash', items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 15 });
  const item = db.getSaleItems(sale.sale.id)[0];
  const batchBefore = db.getBatches(medicine.id, false)[0].quantity;
  const stockBefore = db.getProductStock(medicine.id);
  const cashBefore = db.getCashBalance();
  const movementsBefore = db.getStockMovements(medicine.id).length;
  const returnCountBefore = db.getAllSaleReturns().length;
  const auditCountBefore = db.getAuditLogs({ entity: 'sale_return' }).length;
  const nextExpectedId = Math.max(0, ...db.getAllSaleReturns().map(entry => entry.id)) + 1;
  const originalToISOString = Date.prototype.toISOString;
  let dateCalls = 0;
  // Inject a late storage-stage failure after stock and cash mutations to verify the real rollback boundary.
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
  assert.equal(db.getProductStock(medicine.id), stockBefore);
  assert.equal(db.getBatches(medicine.id, false)[0].quantity, batchBefore);
  assert.equal(db.getCashBalance(), cashBefore);
  assert.equal(db.getStockMovements(medicine.id).length, movementsBefore);
  assert.equal(db.getAllSaleReturns().length, returnCountBefore);
  assert.equal(db.getAuditLogs({ entity: 'sale_return' }).length, auditCountBefore);
  assert.equal(db.getSaleItemReturnableQuantity(item.id), 1);
  const recovered = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: item.id, quantity: 1 }] });
  assert.equal(recovered.success, true);
  assert.equal(recovered.record.id, nextExpectedId);
});

test('atomic mutation restores store and identifiers after a forced mid-transaction failure', () => {
  const state = { stock: 3, cash: 20, returns: ['before'], ids: { next: 8 } };
  const before = JSON.parse(JSON.stringify(state));
  assert.throws(() => atomicStore.withAtomicMutation(
    () => JSON.parse(JSON.stringify(state)),
    snapshot => Object.assign(state, snapshot),
    () => { state.stock += 5; state.cash -= 10; state.returns.push('partial'); state.ids.next++; throw new Error('forced failure'); },
  ), /forced failure/);
  assert.deepEqual(state, before);
});

test('returns preserve recalled batch state instead of reactivating recalled stock', () => {
  const saleMedicine = product('Recalled sale return example');
  configure(saleMedicine.id);
  buy(saleMedicine.id, 'RECALLED-SALE', '2027-12-31', 1, 'Box', 1000);
  const sale = db.createSale({ sale_type: 'cash', items: [{ product_id: saleMedicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 15 });
  const saleItem = db.getSaleItems(sale.sale.id)[0];
  const saleBatch = db.getBatches(saleMedicine.id, false)[0];
  saleBatch.status = 'RECALLED';
  assert.equal(db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: saleItem.id, quantity: 1 }] }).success, true);
  assert.equal(db.getBatches(saleMedicine.id, false).find(batch => batch.id === saleBatch.id).status, 'RECALLED');
  assert.equal(db.getProductStock(saleMedicine.id), 0);

  const purchaseMedicine = product('Recalled purchase return example');
  configure(purchaseMedicine.id);
  const purchase = buy(purchaseMedicine.id, 'RECALLED-PURCHASE', '2027-12-31', 1, 'Box', 1000);
  const purchaseItem = db.getPurchaseItems(purchase.purchase.id)[0];
  const purchaseBatch = db.getBatches(purchaseMedicine.id, false)[0];
  purchaseBatch.status = 'RECALLED';
  assert.equal(db.createPurchaseReturn({ purchase_id: purchase.purchase.id, items: [{ purchase_item_id: purchaseItem.id, quantity: 1 }] }).success, true);
  assert.equal(db.getBatches(purchaseMedicine.id, false).find(batch => batch.id === purchaseBatch.id).status, 'RECALLED');
  assert.equal(db.getProductStock(purchaseMedicine.id), 0);
});

test('a late cash sale return is assigned to the currently open shift, not the original closed shift', () => {
  const medicine = product('Shift allocation return example');
  configure(medicine.id);
  buy(medicine.id, 'SHIFT-RETURN', '2027-12-31', 1, 'Box', 1000);
  const oldShift = db.openShift({ opening_cash: 500 });
  const sale = db.createSale({ sale_type: 'cash', shift_id: oldShift.id, items: [{ product_id: medicine.id, unit: 'Tablet', quantity: 1, unit_price: 15, discount: 0 }], discount: 0, amount_paid: 15 });
  const saleItem = db.getSaleItems(sale.sale.id)[0];
  db.closeShift(oldShift.id, db.getCashBalance());
  const currentShift = db.openShift({ opening_cash: 100 });
  const result = db.createSaleReturn({ sale_id: sale.sale.id, items: [{ sale_item_id: saleItem.id, quantity: 1 }], settlement_method: 'CASH_REFUND' });
  assert.equal(result.success, true);
  assert.equal(db.getCashTransactions().find(transaction => transaction.reference_type === 'sale_return' && transaction.reference_id === result.record.id).shift_id, currentShift.id);
  assert.equal(db.getOpenShift().expected_cash, currentShift.opening_cash - result.record.cash_refund);
  assert.equal(db.getShifts().find(shift => shift.id === oldShift.id).status, 'CLOSED');
});

test('return customer document references the original invoice and never renders private cost/profit fields', () => {
  const body = returnInvoice.buildReturnInvoiceBody({
    kind: 'sale', returnNumber: 'SR-000001', originalInvoiceNumber: 'INV-001000',
    date: '2026-10-07', partyName: 'عميل', settlementLabel: 'رد نقدي', total: 2400,
    items: [{ name: 'Panadol', quantity: 2, unit: 'Box', unitPrice: 1200, total: 2400 }],
    grossProfit: 999999, cogs: 999999, margin: 99, costPrice: 500,
  });
  assert.match(body, /مرتجع مبيعات/);
  assert.match(body, /SR-000001/);
  assert.match(body, /INV-001000/);
  assert.match(body, /Panadol/);
  assert.match(body, /2 Box/);
  assert.match(body, /رد نقدي/);
  assert.match(body, /الفاتورة الأصلية/);
  assert.doesNotMatch(body, /999999|gross.?profit|COGS|margin|cost.?price|التكلفة|الربح|الهامش/i);
});
