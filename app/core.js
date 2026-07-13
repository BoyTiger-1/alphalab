/* AlphaLab core runtime: data access layer over the real market-data bundle,
   formatting, persistence, events, CSV ingestion. */
'use strict';
const AL = window.AL = {};

/* ---------- data layer ---------- */
AL.boot = function () {
  const D = window.ALPHALAB_DATA;
  AL.D = D;
  AL.cal = D.cal;
  AL.asof = D.asof;
  AL._di = new Map(D.cal.map((d, i) => [d, i]));
  AL.custom = AL.store.get('custom_series', {});   // user-uploaded datasets
  AL._cache = new Map();
};

AL.di = d => AL._di.get(d);

/* Unified series accessor. Kinds: bundled equity/etf/index/fx/futures (shared
   calendar), crypto (own daily calendar), fred (own calendar), custom. */
const dec = (c, s) => { const k = Math.pow(10, s); return c.map(v => v == null ? null : v / k); };
AL.getSeries = function (sym) {
  if (AL._cache.has(sym)) return AL._cache.get(sym);
  let s = null;
  const D = AL.D;
  if (D.series[sym]) {
    const e = D.series[sym];
    s = { sym, name: e.n, cls: e.cls, dates: AL.cal.slice(e.f), values: dec(e.c, e.s), src: 'Yahoo Finance' };
    if (e.pre) s.pre = { d: e.pre.d, v: dec(e.pre.c, e.pre.s) };
  } else if (D.crypto[sym]) {
    const e = D.crypto[sym];
    const dates = AL.dateRange(e.d0, e.c.length);
    s = { sym, name: e.n, cls: 'Crypto', dates, values: dec(e.c, e.s), src: 'Coinbase' };
  } else if (D.fred[sym]) {
    const e = D.fred[sym];
    s = e.a
      ? { sym, name: e.n, cls: 'Macro', dates: AL.cal.slice(e.f), values: dec(e.c, e.s), src: 'FRED' }
      : { sym, name: e.n, cls: 'Macro', dates: e.d, values: e.v, src: 'FRED' };
  } else if (AL.custom[sym]) {
    const e = AL.custom[sym];
    s = { sym, name: e.name, cls: 'Custom', dates: e.dates, values: e.values, src: 'User upload' };
  } else if (AL.sp500() && AL.sp500().cols[sym]) {
    // extended universe tier 1: weekly bars, 10y, every S&P 500 constituent
    const sp = AL.sp500(), e = sp.cols[sym];
    s = { sym, name: e.n, cls: 'Equity', sector: e.sec, weekly: true,
      dates: sp.wcal.slice(e.f), values: dec(e.c, e.s), src: 'Yahoo Finance (weekly)' };
  } else if (window.ALPHALAB_MKT && window.ALPHALAB_MKT.cols[sym]) {
    // tier 2: the rest of the listed US market, 3y weekly
    const mk = window.ALPHALAB_MKT, e = mk.cols[sym];
    s = { sym, name: e.n, cls: 'Equity', sector: e.sec, weekly: true, mc: e.mc,
      dates: mk.wcal.slice(e.f), values: dec(e.c, e.s), src: 'Yahoo Finance (weekly)' };
  }
  if (s) AL._cache.set(sym, s);
  return s;
};
AL.sp500 = () => window.ALPHALAB_SP500 || null;
// real per-stock fundamentals (Yahoo) and news/social bundles, if shipped
AL.fund = sym => (window.ALPHALAB_FUND && window.ALPHALAB_FUND.tickers[sym]) || null;
AL.fundMeta = () => window.ALPHALAB_FUND || null;
AL.newsFor = sym => (window.ALPHALAB_NEWS && window.ALPHALAB_NEWS.tickers[sym]) || null;
AL.newsMeta = () => window.ALPHALAB_NEWS || null;
// bars per year for a series: weekly universe annualizes at 52, daily at 252
AL.freq = ser => ser && ser.weekly ? 52 : 252;
// any daily series resampled onto the shared weekly grid (for cross-frequency math)
AL.weeklyValues = function (sym) {
  const sp = AL.sp500();
  if (!sp) return null;
  if (sp.cols[sym]) { const e = sp.cols[sym]; const v = dec(e.c, e.s); const out = new Array(sp.wcal.length).fill(null); for (let i = 0; i < v.length; i++) out[e.f + i] = v[i]; return out; }
  const s = AL.getSeries(sym);
  if (!s) return null;
  const m = new Map(s.dates.map((d, i) => [d, s.values[i]]));
  let last = null, j = 0;
  const sorted = s.dates;
  return sp.wcal.map(w => {
    while (j < sorted.length && sorted[j] <= w) { last = s.values[j]; j++; }
    return last;
  });
};

AL.ohlc = function (sym) {
  const D = AL.D;
  if (D.ohlc[sym]) {
    const e = D.ohlc[sym];
    const dates = AL.cal.slice(e.f);
    const c = dec(e.c, e.s);
    const un = (off, i) => +(c[i] * (1 + off / 1e4)).toPrecision(6);
    return { dates, c, o: e.o.map(un), h: e.h.map(un), l: e.l.map(un), v: e.v };
  }
  const e = D.crypto[sym];
  if (e && e.o) {
    const dates = AL.dateRange(e.d0, e.c.length);
    const c = dec(e.c, e.s);
    const un = (off, i) => +(c[i] * (1 + off / 1e4)).toPrecision(6);
    return { dates, c, o: e.o.map(un), h: e.h.map(un), l: e.l.map(un), v: e.v };
  }
  return null;
};

AL.dateRange = function (d0, n) {
  const out = new Array(n); const t0 = Date.parse(d0 + 'T12:00:00Z');
  for (let i = 0; i < n; i++) out[i] = new Date(t0 + i * 864e5).toISOString().slice(0, 10);
  return out;
};

/* Catalog of everything tradeable/plottable */
AL.catalog = function () {
  const out = [];
  for (const [sym, e] of Object.entries(AL.D.series)) out.push({ sym, name: e.n, cls: e.cls, n: e.c.length, from: AL.cal[e.f], src: 'Yahoo Finance' });
  for (const [sym, e] of Object.entries(AL.D.crypto)) out.push({ sym, name: e.n, cls: 'Crypto', n: e.c.length, from: e.d0, src: 'Coinbase' });
  for (const [sym, e] of Object.entries(AL.D.fred)) out.push({ sym, name: e.n, cls: 'Macro', n: e.a ? e.c.length : e.v.length, from: e.a ? AL.cal[e.f] : e.d[0], src: 'FRED' });
  for (const [sym, e] of Object.entries(AL.custom)) out.push({ sym, name: e.name, cls: 'Custom', n: e.values.length, from: e.dates[0], src: 'User upload' });
  const sp = AL.sp500();
  if (sp) {
    // full index universe, minus names the daily bundle already covers in depth
    for (const [sym, e] of Object.entries(sp.cols)) {
      if (AL.D.series[sym]) continue;
      out.push({ sym, name: e.n, cls: 'Equity', sector: e.sec, weekly: true, n: e.c.length, from: sp.wcal[e.f], src: 'Yahoo (weekly)' });
    }
  }
  const mk = window.ALPHALAB_MKT;
  if (mk) {
    for (const [sym, e] of Object.entries(mk.cols)) {
      if (AL.D.series[sym] || (sp && sp.cols[sym])) continue;
      out.push({ sym, name: e.n, cls: 'Equity', sector: e.sec, weekly: true, n: e.c.length, from: mk.wcal[e.f], src: 'Yahoo (weekly)' });
    }
  }
  return out;
};

/* symbols by asset class, tradeable daily universes */
AL.universe = function (cls) {
  return AL.catalog().filter(x => cls === 'All' ? x.cls !== 'Macro' : x.cls === cls).map(x => x.sym);
};
AL.SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB'];
AL.LIQUID = ['SPY', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM', 'TLT', 'IEF', 'LQD', 'HYG', 'GLD', 'SLV', 'USO', 'VNQ',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM', 'UNH', 'V', 'WMT', 'HD', 'KO', 'PG'];

/* Daily simple returns for a series, aligned to its dates from index 1 */
AL.returns = function (sym) {
  const key = 'ret:' + sym;
  if (AL._cache.has(key)) return AL._cache.get(key);
  const s = AL.getSeries(sym);
  if (!s) return null;
  const r = new Array(s.values.length - 1);
  for (let i = 1; i < s.values.length; i++) r[i - 1] = s.values[i] / s.values[i - 1] - 1;
  const out = { sym, dates: s.dates.slice(1), values: r };
  AL._cache.set(key, out);
  return out;
};

/* Align multiple symbols on intersection of dates -> {dates, cols:{sym:values}} */
AL.align = function (syms, field) {
  const sers = syms.map(s => field === 'ret' ? AL.returns(s) : AL.getSeries(s)).filter(Boolean);
  if (!sers.length) return null;
  let common = null;
  for (const s of sers) {
    const set = new Set(s.dates);
    common = common ? common.filter(d => set.has(d)) : s.dates.slice();
  }
  const cols = {};
  for (const s of sers) {
    const m = new Map(s.dates.map((d, i) => [d, s.values[i]]));
    cols[s.sym] = common.map(d => m.get(d));
  }
  return { dates: common, cols, syms: sers.map(s => s.sym) };
};

AL.lastClose = function (sym) {
  const s = AL.getSeries(sym); if (!s) return null;
  const v = s.values, n = v.length;
  return { last: v[n - 1], prev: v[n - 2], chg: v[n - 1] / v[n - 2] - 1, date: s.dates[n - 1] };
};

AL.window = function (series, from, to) {
  const { dates, values } = series;
  let a = 0, b = dates.length;
  if (from) { a = dates.findIndex(d => d >= from); if (a < 0) a = dates.length; }
  if (to) { const j = dates.findIndex(d => d > to); if (j >= 0) b = j; }
  return { dates: dates.slice(a, b), values: values.slice(a, b) };
};

/* ---------- store (localStorage JSON) ---------- */
AL.store = {
  get(k, dflt) { try { const v = localStorage.getItem('alphalab:' + k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem('alphalab:' + k, JSON.stringify(v)); } catch (e) { /* quota */ } },
  del(k) { try { localStorage.removeItem('alphalab:' + k); } catch (e) {} },
};

/* ---------- event bus ---------- */
AL.bus = {
  _h: {},
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
  emit(ev, data) { (this._h[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); },
};

/* ---------- deterministic RNG ---------- */
AL.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
AL.gauss = function (rand) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand(); while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ---------- formatting ---------- */
const fmt = AL.fmt = {
  n(x, d = 2) { return x == null || !isFinite(x) ? '-' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  px(x) {
    if (x == null || !isFinite(x)) return '-';
    const d = Math.abs(x) >= 1000 ? 1 : Math.abs(x) >= 10 ? 2 : 4;
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  pct(x, d = 2) { return x == null || !isFinite(x) ? '-' : (x * 100).toFixed(d) + '%'; },
  spct(x, d = 2) { return x == null || !isFinite(x) ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%'; },
  usd(x) {
    if (x == null || !isFinite(x)) return '-';
    const a = Math.abs(x);
    if (a >= 1e12) return '$' + (x / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + x.toFixed(2);
  },
  date(d) { return d; },
  cls(x) { return x == null ? '' : x >= 0 ? 'up' : 'dn'; },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
};

/* ---------- CSV ingestion ---------- */
AL.parseCSV = function (text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 3) throw new Error('CSV too short');
  const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  const di = head.findIndex(h => /date|time|day/.test(h));
  if (di < 0) throw new Error('No date column found');
  let vi = head.findIndex(h => /adj/.test(h));
  if (vi < 0) vi = head.findIndex(h => /close|price|value|nav/.test(h));
  if (vi < 0) vi = head.length > 1 ? (di === 0 ? 1 : 0) : -1;
  if (vi < 0) throw new Error('No value column found');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const d = new Date(parts[di]);
    const v = parseFloat(parts[vi]);
    if (!isNaN(d.getTime()) && isFinite(v)) rows.push([d.toISOString().slice(0, 10), v]);
  }
  rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
  // dedupe + basic validation
  const dates = [], values = [];
  let bad = 0, prev = null;
  for (const [d, v] of rows) {
    if (d === prev) { bad++; continue; }
    if (values.length && Math.abs(v / values[values.length - 1] - 1) > 3) { bad++; continue; } // >300% jump: reject
    dates.push(d); values.push(v); prev = d;
  }
  if (dates.length < 30) throw new Error('Fewer than 30 valid rows after cleaning');
  return { dates, values, cleaned: bad, valueCol: head[vi], dateCol: head[di] };
};

AL.registerCustom = function (sym, name, parsed) {
  sym = sym.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12) || 'CUSTOM';
  AL.custom[sym] = { name, dates: parsed.dates, values: parsed.values, added: new Date().toISOString().slice(0, 10) };
  AL.store.set('custom_series', AL.custom);
  AL._cache.delete(sym); AL._cache.delete('ret:' + sym);
  AL.bus.emit('data:changed', sym);
  return sym;
};

/* ---------- misc ---------- */
AL.uid = () => Math.random().toString(36).slice(2, 9);
AL.el = function (html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
AL.debounce = function (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
