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

const db = require('../.test-build/services/erp-database.js');

test('opening balances, vouchers, and transfers keep each cashbox and the combined balance consistent', async () => {
  await db.databaseReady;
  assert.equal(db.getCashboxBalances().length, 3);
  assert.equal(db.getCashBalance(), 0);

  assert.deepEqual(db.addCashboxOpeningBalance(100, 'bank', 'رصيد بداية'), { success: true });
  assert.equal(db.getCashBalance('bank'), 100);
  assert.equal(db.addCashboxOpeningBalance(20, 'bank', 'محاولة ثانية').success, false);

  const transfer = db.transferCashBetweenBoxes('bank', 'pharmacy', 30, 'تغذية الصيدلية');
  assert.deepEqual(transfer, { success: true });
  assert.equal(db.getCashBalance('bank'), 70);
  assert.equal(db.getCashBalance('pharmacy'), 30);
  assert.equal(db.getCashBalance(), 100);

  const transferRows = db.getCashTransactions({ search: 'تغذية الصيدلية' });
  assert.equal(transferRows.length, 2);
  assert.equal(transferRows[0].reference_id, transferRows[1].reference_id);
  assert.equal(transferRows[0].amount + transferRows[1].amount, 0);

  assert.equal(db.transferCashBetweenBoxes('bank', 'daily', 71, '').success, false);
  assert.equal(db.transferCashBetweenBoxes('bank', 'bank', 5, '').success, false);
  assert.equal(db.getCashBalance(), 100);

  assert.deepEqual(db.addCashboxReceipt(20, 'pharmacy', 'تحصيل'), { success: true });
  assert.deepEqual(db.addCashboxPayment(15, 'pharmacy', 'شراء مستلزم'), { success: true });
  assert.equal(db.addCashboxPayment(1000, 'pharmacy', 'صرف غير متاح').success, false);
  assert.equal(db.getCashBalance('pharmacy'), 35);

  db.addCashDeposit(12, 'إيداع اليومية');
  assert.equal(db.addCashboxOpeningBalance(50, 'daily', 'رصيد متأخر').success, false);
  const balanceBeforeStandaloneClose = db.getCashBalance();
  const standaloneClose = db.closeCashboxDay(10, 'فارق عد');
  assert.deepEqual(standaloneClose, { success: true, expectedCash: 12, actualCash: 10, difference: -2, shiftClosed: false });
  assert.equal(db.getCashBalance(), balanceBeforeStandaloneClose);

  const dailyShift = db.openShift({ opening_cash: 0 });
  const closed = db.closeCashboxDay(12, 'مطابق');
  assert.deepEqual(closed, { success: true, expectedCash: 12, actualCash: 12, difference: 0, shiftClosed: true });
  assert.equal(dailyShift.status, 'CLOSED');
  assert.equal(db.getCashTransactions({ cashboxId: 'daily', type: 'CLOSING' }).length, 2);
  assert.equal(db.getCashBalance(), 117);

  assert.equal(db.getCashTransactions({ cashboxId: 'pharmacy', direction: 'in' }).every(row => row.amount > 0), true);
  assert.equal(db.getCashTransactions({ cashboxId: 'daily', search: 'إيداع اليومية' }).length, 1);
  assert.deepEqual(
    db.getCashboxBalances().map(box => box.balance),
    [12, 35, 70],
  );
  assert.equal(db.getCashboxBalances().reduce((sum, box) => sum + box.balance, 0), db.getCashBalance());
});
