(() => {
'use strict';
const { fmt, parseMoney, plain } = Core;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const S = { accounts: [], tx: [], cats: [], theme: 'auto', lastBackup: null, view: 'dash', ym: today().slice(0, 7),
  f: { q: '', type: '', acc: '', cat: '', month: '', sort: 'new' } };
const NETS = ['Visa', 'Mastercard', 'JCB'], FALLBACK = { income: 'c_i_other', expense: 'c_e_others' };
const PAL = ['#1f6f5c', '#d4553f', '#e0a82e', '#4a7fb5', '#8a63b8', '#c46a9b', '#6b8e3d', '#b5651d'];
const DEF = { income: ['Salary', 'Business Income', 'Allowance', 'Interest', 'Other'],
  expense: ['Food', 'Groceries', 'Transportation', 'Shopping', 'Bills and Utilities', 'Housing', 'Healthcare', 'Entertainment', 'Travel', 'Education', 'Subscriptions', 'Personal Care', 'Others'] };
const defaultCats = () => Object.entries(DEF).flatMap(([kind, ns]) => ns.map(name => ({ id: 'c_' + kind[0] + '_' + name.toLowerCase().replace(/\W+/g, '_'), name, kind })));
const acc = id => S.accounts.find(a => a.id === id), cat = id => S.cats.find(c => c.id === id);
const bal = a => Core.balance(a, S.tx);
const mfull = ym => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
const mshort = ym => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString('en-PH', { month: 'short' });
let db, pending;

/* ---------- IndexedDB (source of truth) ---------- */
const open = () => new Promise((ok, no) => {
  const r = indexedDB.open('fintrack', 1);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('accounts', { keyPath: 'id' }); d.createObjectStore('tx', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'k' }); };
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
const getAll = s => new Promise((ok, no) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
// ops: [store, 'put'|'delete'|'clear', value]; all run in ONE transaction (all-or-nothing)
const write = ops => new Promise((ok, no) => {
  const t = db.transaction([...new Set(ops.map(o => o[0]))], 'readwrite');
  ops.forEach(([s, op, v]) => t.objectStore(s)[op](v));
  t.oncomplete = ok; t.onerror = t.onabort = () => no(t.error || new Error('Write failed'));
});
async function load() {
  S.accounts = (await getAll('accounts')).sort((a, b) => (a.kind === 'cash' ? 0 : 1) - (b.kind === 'cash' ? 0 : 1) || (a.created || 0) - (b.created || 0));
  S.tx = await getAll('tx');
  const meta = Object.fromEntries((await getAll('meta')).map(m => [m.k, m.v]));
  S.cats = meta.cats; S.theme = meta.theme || 'auto'; S.lastBackup = meta.lastBackup || null;
  const ops = []; // seed only what's missing; never overwrite existing data
  if (!S.accounts.some(a => a.kind === 'cash')) { const c = { id: 'cash', kind: 'cash', name: 'Cash', opening: 0, color: '#2f7d5b', created: 0 }; S.accounts.unshift(c); ops.push(['accounts', 'put', c]); }
  if (!S.cats) { S.cats = defaultCats(); ops.push(['meta', 'put', { k: 'cats', v: S.cats }]); }
  if (ops.length) await write(ops);
}
const refresh = async () => { await load(); render(); };

/* ---------- Charts (inline SVG) ---------- */
const LEG = '<div class="leg"><span><i class="dot" style="background:var(--inc)"></i>Income</span><span><i class="dot" style="background:var(--exp)"></i>Expenses</span></div>';
function bars(d) {
  const mx = Math.max(1, ...d.flatMap(x => [x.income, x.expense])), W = 320, H = 120, bw = W / d.length;
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="chart" role="img" aria-label="Income versus expenses">` + d.map((x, i) => {
    const h1 = x.income / mx * H, h2 = x.expense / mx * H, cx = i * bw + bw / 2;
    return `<rect x="${cx - 13}" y="${H - h1}" width="12" height="${h1}" rx="3" fill="var(--inc)"/><rect x="${cx + 1}" y="${H - h2}" width="12" height="${h2}" rx="3" fill="var(--exp)"/><text x="${cx}" y="${H + 14}" text-anchor="middle">${esc(x.label)}</text>`;
  }).join('') + '</svg>' + LEG;
}
function line(d) {
  const v = d.map(x => x.net), mx = Math.max(0, ...v), mn = Math.min(0, ...v), r = (mx - mn) || 1, W = 320, H = 110;
  const X = i => 14 + i * (W - 28) / Math.max(1, d.length - 1), Y = n => 6 + (mx - n) / r * (H - 12);
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="chart" role="img" aria-label="Monthly net cash flow"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/>
  <polyline fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round" points="${v.map((n, i) => X(i) + ',' + Y(n)).join(' ')}"/>
  ${v.map((n, i) => `<circle cx="${X(i)}" cy="${Y(n)}" r="3.5" fill="var(--acc)"/><text x="${X(i)}" y="${H + 14}" text-anchor="middle">${esc(d[i].label)}</text>`).join('')}</svg>`;
}
function donut(items) {
  const tot = items.reduce((s, i) => s + i.value, 0), C = 2 * Math.PI * 40;
  if (!tot) return '<p class="muted">No expenses this month.</p>';
  let off = 0;
  const segs = items.map(i => { const len = i.value / tot * C, s = `<circle cx="60" cy="60" r="40" fill="none" stroke="${i.color}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<svg viewBox="0 0 120 120" class="chart" style="max-width:200px;display:block;margin:auto" role="img" aria-label="Expenses by category">${segs}</svg>` +
    `<div class="leg" style="display:grid;gap:4px">${items.map(i => `<span style="display:flex;justify-content:space-between"><span><i class="dot" style="background:${i.color}"></i>${esc(i.label)} · ${Math.round(i.value / tot * 100)}%</span><b>${fmt(i.value)}</b></span>`).join('')}</div>`;
}

/* ---------- Views ---------- */
const logo = n => n === 'Visa' ? '<span class="visa">VISA</span>'
  : n === 'Mastercard' ? '<svg width="40" height="24" viewBox="0 0 40 24" aria-label="Mastercard"><circle cx="14" cy="12" r="10" fill="#eb001b"/><circle cx="26" cy="12" r="10" fill="#f79e1b" fill-opacity=".9"/></svg>'
  : n === 'JCB' ? '<svg width="42" height="26" viewBox="0 0 42 26" aria-label="JCB">' + [['#0b4ea2', 'J'], ['#d6202e', 'C'], ['#2a8c3c', 'B']].map(([c, l], i) => `<rect x="${1 + i * 14}" y="1" width="12" height="24" rx="3" fill="${c}"/><text x="${7 + i * 14}" y="18" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${l}</text>`).join('') + '</svg>' : '';
const card = a => {
  const cr = a.kind === 'credit', b = bal(a);
  return `<button class="card ${a.kind}" data-act="acc" data-id="${a.id}" style="--c:${esc(a.color || '#2f7d5b')}">
  <div class="top"><span class="tag">${cr ? 'CREDIT' : a.kind === 'debit' ? 'DEBIT' : 'CASH'}</span>${logo(a.network)}</div>
  <div class="nm">${esc(a.name)}</div><div class="bk">${esc(a.bank || ' ')}</div>
  <div class="bal"><small>${cr ? 'Outstanding balance' : a.kind === 'cash' ? 'Cash on hand' : 'Available balance'}</small>${fmt(b)}</div>
  ${cr && a.limit ? `<small>${fmt(Math.max(0, a.limit - b))} available of ${fmt(a.limit)}</small>` : ''}
  ${cr && (a.bill || a.due) ? `<small>${a.bill ? 'Bills on the ' + a.bill + 'th' : ''}${a.bill && a.due ? ' · ' : ''}${a.due ? 'due on the ' + a.due + 'th' : ''}</small>` : ''}</button>`;
};
const monthBar = () => `<div class="mbar"><button data-act="mo" data-n="-1" aria-label="Previous month">‹</button><b>${mfull(S.ym)}</b><button data-act="mo" data-n="1" aria-label="Next month" ${S.ym >= today().slice(0, 7) ? 'disabled' : ''}>›</button></div>`;
const txRow = t => {
  const a = acc(t.accountId), b = acc(t.toId), c = cat(t.categoryId);
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : t.type === 'adjustment' ? (t.amount < 0 ? '−' : '+') : '';
  const sub = t.type === 'transfer' ? `${b && b.kind === 'credit' ? 'Card payment · ' : 'Transfer · '}${a ? a.name : '?'} → ${b ? b.name : '?'}` : `${t.type === 'adjustment' ? 'Adjustment · ' : c ? c.name + ' · ' : ''}${a ? a.name : '?'}`;
  return `<button class="tx" data-act="tx" data-id="${t.id}"><div><b>${esc(t.description)}</b><small>${esc(sub)} · ${t.date}</small></div><span class="${t.type === 'income' ? 'inc' : t.type === 'expense' ? 'exp' : ''}">${sign}${fmt(Math.abs(t.amount))}</span></button>`;
};
const sortTx = (list, dir = -1) => list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.createdAt || 0) - (y.createdAt || 0)) * dir);

function dash() {
  const asOf = S.ym + '-31', t = Core.totals(S.accounts, S.tx, asOf), m = Core.summary(S.tx, S.ym);
  const six = Array.from({ length: 6 }, (_, i) => { const ym = Core.shift(S.ym, i - 5); return { label: mshort(ym), ...Core.summary(S.tx, ym) }; });
  const recent = sortTx(S.tx.filter(x => x.date.startsWith(S.ym))).slice(0, 5);
  return `${monthBar()}
  <section class="hero"><small>Net worth · end of ${mfull(S.ym)}</small><h1>${fmt(t.net)}</h1>
   <div class="row"><div><small>Assets</small><b>${fmt(t.assets)}</b></div><div><small>Liabilities</small><b>${fmt(t.liab)}</b></div></div></section>
  <section class="grid3"><div class="panel"><small>Income</small><b class="inc">${fmt(m.income)}</b></div><div class="panel"><small>Expenses</small><b class="exp">${fmt(m.expense)}</b></div><div class="panel"><small>Net cash flow</small><b>${fmt(m.net)}</b></div></section>
  <section class="panel"><h2>Income vs expenses</h2>${bars(six)}</section>
  <section class="panel"><h2>Accounts</h2>${S.accounts.map(a => `<div class="acc"><span><i class="dot" style="background:${esc(a.color || '#2f7d5b')}"></i>${esc(a.name)}${a.kind === 'credit' ? ' <small>(owed)</small>' : ''}</span><b>${fmt(Core.balance(a, S.tx, asOf))}</b></div>`).join('')}</section>
  <section class="panel"><h2>Recent transactions</h2>${recent.map(txRow).join('') || '<p class="muted">Nothing in this month yet. Tap + to add a transaction.</p>'}</section>`;
}
function accountsView() {
  const n = S.accounts.filter(a => a.kind !== 'cash').length;
  return `<h1 class="pg">Accounts</h1><section class="cards">${S.accounts.map(card).join('')}</section>
  <div class="panel"><small>${n} of ${Core.MAX_CARDS} cards used. Cash doesn’t count toward the limit.</small><div class="btns" style="margin-top:10px"><button class="pri" data-act="addacc" ${n >= Core.MAX_CARDS ? 'disabled' : ''}>Add card</button></div></div>`;
}
const filtered = () => {
  const f = S.f, q = f.q.trim().toLowerCase();
  return sortTx(S.tx.filter(t => (!q || t.description.toLowerCase().includes(q)) && (!f.type || t.type === f.type) && (!f.acc || t.accountId === f.acc || t.toId === f.acc) && (!f.cat || t.categoryId === f.cat) && (!f.month || t.date.startsWith(f.month))), f.sort === 'old' ? 1 : -1);
};
const txList = () => { const l = filtered(); return (l.slice(0, 300).map(txRow).join('') || '<p class="muted">No transactions match.</p>') + (l.length > 300 ? '<small>Showing the first 300. Narrow the filters to see more.</small>' : ''); };
function txView() {
  const f = S.f, o = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `<h1 class="pg">Transactions</h1><section class="panel"><div class="filters">
  <input type="search" data-f="q" placeholder="Search description" value="${esc(f.q)}">
  <select data-f="type">${o('', 'All types', f.type)}${['income', 'expense', 'transfer', 'adjustment'].map(t => o(t, t[0].toUpperCase() + t.slice(1), f.type)).join('')}</select>
  <select data-f="acc">${o('', 'All accounts', f.acc)}${S.accounts.map(a => o(a.id, a.name, f.acc)).join('')}</select>
  <select data-f="cat">${o('', 'All categories', f.cat)}${S.cats.map(c => o(c.id, c.name, f.cat)).join('')}</select>
  <input type="month" data-f="month" value="${esc(f.month)}" aria-label="Month">
  <select data-f="sort" style="grid-column:1/-1">${o('new', 'Newest first', f.sort)}${o('old', 'Oldest first', f.sort)}</select></div></section>
  <section class="panel" id="txlist">${txList()}</section>`;
}
function insights() {
  const pv = Core.shift(S.ym, -1), c = Core.summary(S.tx, S.ym), p = Core.summary(S.tx, pv);
  const trend = Array.from({ length: 6 }, (_, i) => { const ym = Core.shift(S.ym, i - 5); return { label: mshort(ym), ...Core.summary(S.tx, ym) }; });
  const cmp = (a, b) => b === 0 ? (a === 0 ? '—' : 'new') : `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a - b) / Math.abs(b) * 100))}%`;
  const nm = id => (cat(id) || {}).name || 'Uncategorized';
  const hb = (rows, label) => { const tot = rows.reduce((s, r) => s + r.value, 0) || 1; return rows.map(r => `<div class="hb"><span>${esc(label(r.key))}</span><b>${fmt(r.value)}</b><i style="width:${Math.max(2, Math.round(r.value / tot * 100))}%"></i></div>`).join('') || '<p class="muted">Nothing this month.</p>'; };
  const k = (l, v, a, b, cls = '') => `<div class="panel"><small>${l}</small><b class="${cls}">${fmt(v)}</b><small>${cmp(a, b)} vs ${mshort(pv)}</small></div>`;
  return `${monthBar()}<h1 class="pg">Insights</h1>
  <section class="grid3">${k('Income', c.income, c.income, p.income, 'inc')}${k('Expenses', c.expense, c.expense, p.expense, 'exp')}${k('Net cash flow', c.net, c.net, p.net)}</section>
  <section class="panel"><h2>${mshort(pv)} vs ${mshort(S.ym)}</h2>${bars([{ label: mshort(pv), ...p }, { label: mshort(S.ym), ...c }])}</section>
  <section class="panel"><h2>Expenses by category</h2>${donut(Core.groupSum(S.tx, S.ym, 'expense', t => t.categoryId || '').map((r, i) => ({ label: nm(r.key), value: r.value, color: PAL[i % PAL.length] })))}</section>
  <section class="panel"><h2>Income by category</h2>${hb(Core.groupSum(S.tx, S.ym, 'income', t => t.categoryId || ''), nm)}</section>
  <section class="panel"><h2>Spending by account</h2>${hb(Core.groupSum(S.tx, S.ym, 'expense', t => t.accountId), id => (acc(id) || {}).name || 'Deleted account')}</section>
  <section class="panel"><h2>Net cash flow, last 6 months</h2>${line(trend)}</section>`;
}
function catMgr() {
  return ['expense', 'income'].map(kind => `<small>${kind === 'expense' ? 'Expense' : 'Income'} categories</small><div>${S.cats.filter(c => c.kind === kind).map(c =>
    `<span class="chip"><button data-act="rencat" data-id="${c.id}">${esc(c.name)}</button>${c.id === FALLBACK[kind] ? '' : `<button data-act="delcat" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">×</button>`}</span>`).join('')}</div>`).join('') +
    `<form data-form="cat" class="inline"><input name="name" placeholder="New category" required maxlength="30"><select name="kind"><option value="expense">Expense</option><option value="income">Income</option></select><button class="pri">Add</button></form><p class="err" id="err"></p>`;
}
function settings() {
  const lb = S.lastBackup ? new Date(S.lastBackup).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : 'never';
  return `<h1 class="pg">Settings</h1>
  <section class="panel"><h2>Appearance</h2><div class="seg">${['auto', 'light', 'dark'].map(k => `<button data-act="theme" data-k="${k}" class="${S.theme === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></section>
  <section class="panel warn"><h2>Your data lives only on this device</h2>
  <p>Clearing browser data, deleting the app, or losing or resetting this phone permanently erases your records unless you have a backup. Last backup: <b>${lb}</b>.</p>
  <p>Safari and the Home Screen app store data separately. Add the app to your Home Screen first, then enter your records there.</p>
  <div class="btns col"><button class="pri" data-act="exjson">Export backup (JSON)</button><button data-act="excsv">Export transactions (CSV)</button><label class="btn">Import backup<input type="file" id="imp" accept="application/json,.json" hidden></label></div></section>
  <section class="panel"><h2>Categories</h2>${catMgr()}</section>`;
}
const NAV = [['dash', 'Dashboard', '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['accounts', 'Accounts', '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>'],
  ['tx', 'Transactions', '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'],
  ['insights', 'Insights', '<path d="M5 20v-6M12 20V5M19 20v-10"/>'],
  ['settings', 'Settings', '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>']];
const VIEWS = { dash, accounts: accountsView, tx: txView, insights, settings };
function render() {
  document.documentElement.dataset.theme = S.theme;
  $('#main').innerHTML = VIEWS[S.view]() + (S.view === 'dash' || S.view === 'tx' ? '<button class="fab" data-act="addtx" aria-label="Add transaction">+</button>' : '');
  $('#nav').innerHTML = NAV.map(([v, l, p]) => `<button data-act="nav" data-v="${v}" class="${S.view === v ? 'on' : ''}" aria-label="${l}"><svg viewBox="0 0 24 24">${p}</svg><span>${l}</span></button>`).join('');
}

/* ---------- Sheets and forms ---------- */
const sheet = html => { $('#sheet').innerHTML = `<div class="box">${html}</div>`; $('#sheet').hidden = false; };
const closeSheet = () => { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; };
const err = m => { const el = $('#err'); if (el) el.textContent = m; };
const read = () => Object.fromEntries(new FormData($('#sheet form')));
const confirmBox = (msg, label, fn) => { pending = fn; sheet(`<h2>Are you sure?</h2><p>${esc(msg)}</p><div class="btns"><button data-act="close">Cancel</button><button class="danger" data-act="ok">${label}</button></div>`); };
const opts = (list, v) => list.map(x => `<option value="${esc(x.id)}" ${x.id === v ? 'selected' : ''}>${esc(x.name)}${x.bank ? ' · ' + esc(x.bank) : ''}</option>`).join('');

function accForm(a = {}, kind = a.kind || 'debit') {
  const edit = !!a.id, cr = kind === 'credit';
  sheet(`<form data-form="acc"><h2>${edit ? 'Edit' : 'Add'} ${cr ? 'credit' : 'debit'} card</h2>
  <input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="kind" value="${kind}">
  ${edit ? '' : `<div class="seg"><button type="button" data-act="kind" data-k="debit" class="${cr ? '' : 'on'}">Debit</button><button type="button" data-act="kind" data-k="credit" class="${cr ? 'on' : ''}">Credit</button></div>`}
  <label>Card name<input name="name" required maxlength="40" value="${esc(a.name)}"></label>
  <label>Bank<input name="bank" maxlength="40" value="${esc(a.bank)}"></label>
  <label>Card network<select name="network">${NETS.map(n => `<option ${n === a.network ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  <label>Card color<input type="color" name="color" value="${esc(a.color || '#1f6f5c')}"></label>
  ${edit ? '' : `<label>${cr ? 'Outstanding balance' : 'Available balance'}<input name="opening" inputmode="decimal" value="${esc(a.openingStr ?? '0.00')}"></label>`}
  ${cr ? `<label>Credit limit (optional)<input name="limit" inputmode="decimal" value="${a.limit != null ? plain(a.limit) : ''}"></label>
  <div class="two"><label>Billing day<input name="bill" type="number" min="1" max="31" value="${a.bill || ''}"></label><label>Payment due day<input name="due" type="number" min="1" max="31" value="${a.due || ''}"></label></div>` : ''}
  <p class="err" id="err"></p><div class="btns"><button type="button" data-act="close">Cancel</button><button class="pri">Save</button></div></form>`);
}
async function saveAcc(f) {
  const edit = acc(f.id), kind = f.kind, name = f.name.trim();
  if (!name) return err('Add a card name.');
  if (!edit && S.accounts.filter(a => a.kind !== 'cash').length >= Core.MAX_CARDS) return err('You can add up to 10 cards.');
  const opening = edit ? edit.opening : parseMoney(f.opening);
  if (opening === null || opening < 0) return err('Enter a balance of zero or more.');
  const limit = kind === 'credit' && f.limit ? parseMoney(f.limit) : null;
  if (kind === 'credit' && f.limit && (limit === null || limit <= 0)) return err('Enter a valid credit limit.');
  const day = v => (v ? Math.min(31, Math.max(1, parseInt(v, 10))) : null);
  const a = { ...(edit || {}), id: edit ? edit.id : uid(), kind, name, bank: f.bank.trim(), network: f.network, color: f.color, opening, limit, bill: kind === 'credit' ? day(f.bill) : null, due: kind === 'credit' ? day(f.due) : null, created: edit ? edit.created : Date.now() };
  await write([['accounts', 'put', a]]); closeSheet(); await refresh();
}
function accSheet(a) {
  const cr = a.kind === 'credit', cash = a.kind === 'cash';
  sheet(`<h2>${esc(a.name)}</h2><p class="muted">${cr ? 'Outstanding' : 'Balance'}: <b>${fmt(bal(a))}</b></p><div class="list">
  ${cash ? '<button data-act="cashin">Add money</button><button data-act="cashout">Deduct money</button>' : ''}
  ${cr ? `<button data-act="pay" data-id="${a.id}">Pay this card</button>` : ''}
  <button data-act="adj" data-id="${a.id}">Adjust balance</button>
  ${cash ? '' : `<button data-act="editacc" data-id="${a.id}">Edit</button><button class="danger" data-act="delacc" data-id="${a.id}">Delete</button>`}
  <button data-act="close">Close</button></div>`);
}
function delAcc(a) {
  const rel = S.tx.filter(t => t.accountId === a.id || t.toId === a.id);
  confirmBox(rel.length ? `“${a.name}” has ${rel.length} transaction${rel.length > 1 ? 's' : ''}. Deleting it also deletes them, including transfers that involve other accounts, so those balances will change. Export a backup first if you’re unsure.` : `Delete “${a.name}”?`, 'Delete',
    async () => { await write([['accounts', 'delete', a.id], ...rel.map(t => ['tx', 'delete', t.id])]); await refresh(); });
}
function adjForm(a) {
  sheet(`<form data-form="adj"><h2>Adjust ${esc(a.name)}</h2><p class="muted">Current ${a.kind === 'credit' ? 'outstanding balance' : 'balance'}: ${fmt(bal(a))}. The correction is logged and never counts as income or an expense.</p>
  <input type="hidden" name="id" value="${a.id}"><label>New balance<input name="nb" inputmode="decimal" required></label>
  <p class="err" id="err"></p><div class="btns"><button type="button" data-act="close">Cancel</button><button class="pri">Save</button></div></form>`);
}
async function saveAdj(f) {
  const a = acc(f.id), nb = parseMoney(f.nb);
  if (nb === null) return err('Enter a valid balance.');
  const d = nb - bal(a); if (d === 0) return closeSheet();
  await write([['tx', 'put', { id: uid(), type: 'adjustment', amount: d, accountId: a.id, toId: null, categoryId: null, description: 'Balance adjustment', notes: '', date: today(), createdAt: Date.now() }]]);
  closeSheet(); await refresh();
}
function txForm(t = {}) {
  const type = t.type || 'expense', money = type === 'income' || type === 'expense';
  const from = S.accounts.filter(a => !(a.kind === 'credit' && (type === 'income' || type === 'transfer')));
  const src = t.accountId && from.some(a => a.id === t.accountId) ? t.accountId : from[0].id;
  const to = t.toId || (S.accounts.find(a => a.id !== src) || {}).id;
  const amt = t.amountStr ?? (t.amount != null ? plain(t.amount) : '');
  sheet(`<form data-form="tx"><h2>${t.id ? 'Edit' : 'New'} transaction</h2><input type="hidden" name="id" value="${esc(t.id)}"><input type="hidden" name="type" value="${type}">
  <div class="seg">${[['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer'], ['adjustment', 'Adjust']].map(([k, l]) => `<button type="button" data-act="ttype" data-k="${k}" class="${k === type ? 'on' : ''}">${l}</button>`).join('')}</div>
  <label>${type === 'adjustment' ? 'Change (use - for a decrease)' : 'Amount'}<input name="amount" inputmode="${type === 'adjustment' ? 'text' : 'decimal'}" placeholder="0.00" value="${esc(amt)}" required></label>
  <label>${type === 'transfer' ? 'From' : 'Account'}<select name="account">${opts(from, src)}</select></label>
  ${type === 'transfer' ? `<label>To (pick a credit card to pay it)<select name="to">${opts(S.accounts, to)}</select></label>` : ''}
  ${money ? `<label>Category<select name="cat">${opts(S.cats.filter(c => c.kind === type), t.categoryId || FALLBACK[type])}</select></label>` : ''}
  <label>Description<input name="desc" maxlength="80" value="${esc(t.description)}" ${money ? 'required' : 'placeholder="Optional"'}></label>
  <label>Date<input type="date" name="date" max="${today()}" value="${esc(t.date || today())}" required></label>
  <label>Notes (optional)<textarea name="notes" rows="2" maxlength="300">${esc(t.notes)}</textarea></label>
  <p class="err" id="err"></p><div class="btns">${t.id ? `<button type="button" class="danger" data-act="deltx" data-id="${t.id}">Delete</button>` : ''}<button type="button" data-act="close">Cancel</button><button class="pri">Save</button></div></form>`);
}
async function saveTx(f) {
  const old = S.tx.find(x => x.id === f.id), type = f.type, dest = acc(f.to);
  const t = { id: old ? old.id : uid(), type, amount: parseMoney(f.amount), accountId: f.account, toId: type === 'transfer' ? f.to : null,
    categoryId: type === 'income' || type === 'expense' ? f.cat : null, notes: (f.notes || '').trim(), date: f.date, createdAt: old ? old.createdAt : Date.now(),
    description: (f.desc || '').trim() || (type === 'transfer' ? (dest && dest.kind === 'credit' ? 'Card payment' : 'Transfer') : type === 'adjustment' ? 'Balance adjustment' : '') };
  const e = t.amount === null ? 'Enter a valid amount, like 1250.50.' : Core.validateTx(t, S.accounts, today());
  if (e) return err(e);
  await write([['tx', 'put', t]]); closeSheet(); await refresh();
}
const saveCats = cats => write([['meta', 'put', { k: 'cats', v: cats }]]);
async function saveCat(f) {
  const name = f.name.trim();
  if (!name) return err('Add a category name.');
  if (S.cats.some(c => c.kind === f.kind && c.name.toLowerCase() === name.toLowerCase())) return err('That category already exists.');
  await saveCats([...S.cats, { id: 'c_' + uid(), name, kind: f.kind }]); await refresh();
}

/* ---------- Backup / export ---------- */
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return true;
}
async function exportJson() {
  const data = { app: 'fintrack', version: 1, exportedAt: new Date().toISOString(), data: { accounts: S.accounts, tx: S.tx, cats: S.cats } };
  if (await saveFile(`fintrack-backup-${today()}.json`, JSON.stringify(data, null, 1), 'application/json')) { await write([['meta', 'put', { k: 'lastBackup', v: Date.now() }]]); await refresh(); }
}
async function importFile(file) {
  let o; try { o = JSON.parse(await file.text()); } catch { return sheet('<h2>Can’t import</h2><p>That file isn’t valid JSON.</p><div class="btns"><button data-act="close">OK</button></div>'); }
  const v = Core.validateBackup(o);
  if (v.error) return sheet(`<h2>Can’t import</h2><p>${esc(v.error)} Nothing was changed.</p><div class="btns"><button data-act="close">OK</button></div>`);
  const d = o.data;
  confirmBox(`Replace your current data (${S.accounts.length} accounts, ${S.tx.length} transactions) with this backup (${d.accounts.length} accounts, ${d.tx.length} transactions)? This can’t be undone, so export a backup of your current data first if you need it.`, 'Replace data',
    async () => { await write([['accounts', 'clear'], ['tx', 'clear'], ...d.accounts.map(a => ['accounts', 'put', a]), ...d.tx.map(t => ['tx', 'put', t]), ['meta', 'put', { k: 'cats', v: d.cats }]]); await refresh(); });
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id, k } = el.dataset;
  try {
    switch (act) {
      case 'nav': S.view = el.dataset.v; render(); scrollTo(0, 0); break;
      case 'mo': S.ym = Core.shift(S.ym, +el.dataset.n); render(); break;
      case 'close': closeSheet(); break;
      case 'ok': { const f = pending; closeSheet(); if (f) await f(); break; }
      case 'addtx': txForm({ type: 'expense' }); break;
      case 'tx': txForm(S.tx.find(t => t.id === id)); break;
      case 'ttype': { const f = read(); txForm({ id: f.id, type: k, amountStr: f.amount, accountId: f.account, toId: f.to, description: f.desc, notes: f.notes, date: f.date }); break; }
      case 'deltx': confirmBox('Delete this transaction? Balances and summaries update automatically.', 'Delete', async () => { await write([['tx', 'delete', id]]); await refresh(); }); break;
      case 'addacc': if (S.accounts.filter(a => a.kind !== 'cash').length < Core.MAX_CARDS) accForm(); break;
      case 'kind': { const f = read(); accForm({ name: f.name, bank: f.bank, network: f.network, color: f.color, openingStr: f.opening }, k); break; }
      case 'acc': accSheet(acc(id)); break;
      case 'editacc': accForm(acc(id)); break;
      case 'delacc': delAcc(acc(id)); break;
      case 'adj': adjForm(acc(id)); break;
      case 'cashin': txForm({ type: 'income', accountId: 'cash' }); break;
      case 'cashout': txForm({ type: 'expense', accountId: 'cash' }); break;
      case 'pay': txForm({ type: 'transfer', toId: id, description: 'Card payment' }); break;
      case 'theme': await write([['meta', 'put', { k: 'theme', v: k }]]); S.theme = k; render(); break;
      case 'exjson': await exportJson(); break;
      case 'excsv': await saveFile(`fintrack-transactions-${today()}.csv`, Core.csv(S.tx, S.accounts, S.cats), 'text/csv'); break;
      case 'rencat': { const c = cat(id), n = (prompt('Rename category', c.name) || '').trim(); if (n && n !== c.name) { await saveCats(S.cats.map(x => x.id === id ? { ...x, name: n } : x)); await refresh(); } break; }
      case 'delcat': { const c = cat(id), n = S.tx.filter(t => t.categoryId === id).length;
        confirmBox(`Delete “${c.name}”?${n ? ` Its ${n} transaction${n > 1 ? 's' : ''} will move to “${cat(FALLBACK[c.kind]).name}”.` : ''}`, 'Delete',
          async () => { await write([['meta', 'put', { k: 'cats', v: S.cats.filter(x => x.id !== id) }], ...S.tx.filter(t => t.categoryId === id).map(t => ['tx', 'put', { ...t, categoryId: FALLBACK[c.kind] }])]); await refresh(); }); break; }
    }
  } catch (x) { sheet(`<h2>Something went wrong</h2><p>${esc(x.message)}</p><div class="btns"><button data-act="close">OK</button></div>`); }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, f = Object.fromEntries(new FormData(form));
  try { await { acc: saveAcc, tx: saveTx, adj: saveAdj, cat: saveCat }[form.dataset.form](f); } catch (x) { err('Couldn’t save: ' + x.message); }
});
document.addEventListener('input', e => { const k = e.target.dataset.f; if (k) { S.f[k] = e.target.value; $('#txlist').innerHTML = txList(); } });
document.addEventListener('change', e => { if (e.target.id === 'imp' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; } });

(async () => {
  try { db = await open(); await load(); }
  catch { $('#main').innerHTML = '<section class="panel warn"><h2>Storage unavailable</h2><p>This browser blocked local storage (private browsing?), so nothing would be saved. Open the app in a normal tab.</p></section>'; return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
