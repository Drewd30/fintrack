// Pure financial logic. No DOM, no storage. Amounts are integer centavos.
(function (root) {
  'use strict';
  const MAX_CARDS = 10, TYPES = ['income', 'expense', 'transfer', 'adjustment'], DATE = /^\d{4}-\d{2}-\d{2}$/;
  const nf = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const fmt = c => nf.format(c / 100); // display only
  function parseMoney(s) { // "1,234.5" -> 123450 (no floats); null if invalid
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s).replace(/[₱,\s]/g, ''));
    if (!m) return null;
    const v = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
    return Number.isSafeInteger(v) ? (m[1] && v ? -v : v) : null;
  }
  const plain = c => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0');
  // Change to an account's balance caused by one transaction.
  // Cash/debit balance = money held. Credit balance = debt owed.
  function effect(t, a) {
    const cr = a.kind === 'credit';
    if (t.type === 'adjustment') return t.accountId === a.id ? t.amount : 0;
    if (t.type === 'income') return t.accountId === a.id && !cr ? t.amount : 0;
    if (t.type === 'expense') return t.accountId === a.id ? (cr ? t.amount : -t.amount) : 0;
    if (t.type === 'transfer') {
      if (t.accountId === a.id) return -t.amount;
      if (t.toId === a.id) return cr ? -t.amount : t.amount; // paying a card lowers its debt
    }
    return 0;
  }
  function balance(a, txs, asOf = '9999-12-31') {
    let b = a.opening;
    for (const t of txs) if (t.date <= asOf) b += effect(t, a);
    return b;
  }
  function totals(accs, txs, asOf) {
    let assets = 0, liab = 0;
    for (const a of accs) { const b = balance(a, txs, asOf); if (a.kind === 'credit') liab += b; else assets += b; }
    return { assets, liab, net: assets - liab };
  }
  function summary(txs, ym) { // only income/expense count; transfers and adjustments never do
    let income = 0, expense = 0;
    for (const t of txs) if (t.date.startsWith(ym)) { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; }
    return { income, expense, net: income - expense };
  }
  function groupSum(txs, ym, type, key) {
    const m = new Map();
    for (const t of txs) if (t.type === type && t.date.startsWith(ym)) m.set(key(t), (m.get(key(t)) || 0) + t.amount);
    return [...m].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  }
  function shift(ym, n) {
    const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function validateTx(t, accs, today) {
    const A = id => accs.find(a => a.id === id);
    if (!TYPES.includes(t.type)) return 'Pick a type.';
    if (!t.description || !t.description.trim()) return 'Add a description.';
    if (!DATE.test(t.date) || isNaN(new Date(t.date))) return 'Pick a valid date.';
    if (t.date > today) return 'Date can’t be in the future.';
    if (!Number.isInteger(t.amount)) return 'Enter a valid amount.';
    if (t.type === 'adjustment' ? t.amount === 0 : t.amount <= 0) return t.type === 'adjustment' ? 'Change can’t be zero.' : 'Amount must be more than zero.';
    const a = A(t.accountId);
    if (!a) return 'Pick an account.';
    if (t.type === 'income' && a.kind === 'credit') return 'Income can’t go to a credit card. Use Adjust balance for refunds.';
    if (t.type === 'transfer') {
      const b = A(t.toId);
      if (!b) return 'Pick a destination account.';
      if (b.id === a.id) return 'Choose two different accounts.';
      if (a.kind === 'credit') return 'Transfers can’t start from a credit card.';
    }
    return null;
  }
  function validateBackup(o) {
    const bad = error => ({ error });
    if (!o || o.app !== 'fintrack' || o.version !== 1 || !o.data) return bad('This isn’t a FinTrack backup.');
    const { accounts: A, tx: T, cats: C } = o.data;
    if (![A, T, C].every(Array.isArray)) return bad('The backup is missing data.');
    const ids = new Set();
    for (const a of A) {
      if (!a || typeof a.id !== 'string' || !['cash', 'debit', 'credit'].includes(a.kind) || typeof a.name !== 'string' || !Number.isInteger(a.opening)) return bad('An account in the backup is invalid.');
      if (ids.has(a.id)) return bad('The backup has a duplicate account.');
      ids.add(a.id);
    }
    if (A.filter(a => a.kind === 'cash').length !== 1) return bad('The backup needs exactly one cash account.');
    if (A.filter(a => a.kind !== 'cash').length > MAX_CARDS) return bad('The backup has more than 10 cards.');
    for (const c of C) if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !['income', 'expense'].includes(c.kind)) return bad('A category in the backup is invalid.');
    const cids = new Set(C.map(c => c.id)), tids = new Set();
    for (const t of T) {
      const ok = t && typeof t.id === 'string' && !tids.has(t.id) && TYPES.includes(t.type) && Number.isInteger(t.amount) && typeof t.description === 'string' &&
        DATE.test(t.date) && ids.has(t.accountId) && (t.type !== 'transfer' || ids.has(t.toId)) && (!t.categoryId || cids.has(t.categoryId));
      if (!ok) return bad('A transaction in the backup is invalid.');
      tids.add(t.id);
    }
    return { ok: true };
  }
  function csv(txs, accs, cats) {
    const A = id => (accs.find(a => a.id === id) || {}).name || '', C = id => (cats.find(c => c.id === id) || {}).name || '';
    const q = s => { s = String(s ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }; // blocks spreadsheet formulas
    const rows = [['Date', 'Type', 'Description', 'Category', 'Account', 'To account', 'Amount', 'Notes']];
    [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach(t => rows.push([t.date, t.type, t.description, C(t.categoryId), A(t.accountId), A(t.toId), plain(t.amount), t.notes]));
    return '\ufeff' + rows.map(r => r.map((v, i) => (i === 6 ? v : q(v))).join(',')).join('\r\n');
  }
  const api = { MAX_CARDS, fmt, parseMoney, plain, effect, balance, totals, summary, groupSum, shift, validateTx, validateBackup, csv };
  if (typeof module === 'object') module.exports = api; else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
