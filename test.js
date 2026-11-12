// Run: node test.js
const C = require('./core.js'), assert = require('node:assert/strict'), test = require('node:test');
const acc = [{ id: 'cash', kind: 'cash', opening: 500000 }, { id: 'deb', kind: 'debit', opening: 1000000 }, { id: 'cc', kind: 'credit', opening: 200000 }];
const tx = (type, amount, accountId, extra = {}) => ({ id: Math.random() + '', type, amount, accountId, description: 'x', date: '2026-11-05', ...extra });
const scenario = () => [tx('expense', 50000, 'cash'), tx('expense', 100000, 'deb'), tx('expense', 200000, 'cc'), tx('transfer', 100000, 'deb', { toId: 'cc' })];
test('spec scenario', () => {
  const t = scenario(), b = id => C.balance(acc.find(a => a.id === id), t), tot = C.totals(acc, t, '2026-11-31'), s = C.summary(t, '2026-11');
  assert.deepEqual([b('cash'), b('deb'), b('cc')], [450000, 800000, 300000]);
  assert.deepEqual(tot, { assets: 1250000, liab: 300000, net: 950000 });
  assert.equal(s.expense, 350000); assert.equal(s.income, 0); // card payment is not an expense
});
test('edit and delete recompute balances', () => {
  const t = scenario(); t[1].amount = 150000;
  assert.equal(C.balance(acc[1], t), 750000);
  t.splice(1, 1); assert.equal(C.balance(acc[1], t), 900000);
});
test('transfers and adjustments are never income/expense', () => {
  const t = [tx('transfer', 100, 'cash', { toId: 'deb' }), tx('adjustment', -500, 'deb')];
  assert.deepEqual(C.summary(t, '2026-11'), { income: 0, expense: 0, net: 0 });
  assert.equal(C.balance(acc[1], t), 1000000 + 100 - 500);
});
test('credit rules', () => {
  assert.match(C.validateTx(tx('income', 100, 'cc'), acc, '2026-12-01'), /credit card/);
  assert.match(C.validateTx(tx('transfer', 100, 'cc', { toId: 'deb' }), acc, '2026-12-01'), /credit card/);
  assert.equal(C.validateTx(tx('income', 100, 'cash'), acc, '2026-12-01'), null);
  assert.match(C.validateTx(tx('expense', 100, 'cash', { date: '2027-01-01' }), acc, '2026-12-01'), /future/);
});
test('money parsing is exact', () => {
  assert.equal(C.parseMoney('1,234.5'), 123450); assert.equal(C.parseMoney('0.07'), 7); assert.equal(C.parseMoney('19.99'), 1999);
  assert.equal(C.parseMoney('1.234'), null); assert.equal(C.parseMoney('abc'), null); assert.equal(C.plain(-1999), '-19.99');
  assert.equal(C.fmt(1000000), '₱10,000.00');
});
test('month filtering and shift', () => {
  const t = [tx('income', 100, 'cash', { date: '2026-10-31' }), tx('income', 200, 'cash', { date: '2026-11-01' })];
  assert.equal(C.summary(t, '2026-11').income, 200); assert.equal(C.shift('2026-01', -1), '2025-12');
});
test('backup validation', () => {
  const ok = { app: 'fintrack', version: 1, data: { accounts: [{ id: 'cash', kind: 'cash', name: 'Cash', opening: 0 }], tx: [], cats: [] } };
  assert.ok(C.validateBackup(ok).ok);
  assert.ok(C.validateBackup({ ...ok, app: 'x' }).error);
  const many = { ...ok, data: { ...ok.data, accounts: [...ok.data.accounts, ...Array.from({ length: 11 }, (_, i) => ({ id: 'd' + i, kind: 'debit', name: 'd', opening: 0 }))] } };
  assert.match(C.validateBackup(many).error, /more than 10/);
  const orphan = { ...ok, data: { ...ok.data, tx: [tx('expense', 1, 'nope')] } };
  assert.match(C.validateBackup(orphan).error, /invalid/);
});
test('csv escapes formulas and quotes', () => {
  const out = C.csv([tx('expense', 1050, 'cash', { description: '=HYPERLINK("x")' })], acc, []);
  assert.ok(out.includes(`"'=HYPERLINK(""x"")"`)); assert.ok(out.includes(',10.50,'));
});
