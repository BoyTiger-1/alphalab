/* Headless smoke test: loads the real data bundle + engines with browser stubs,
   exercises the data layer, metrics, backtests across all strategy kinds,
   factor evaluation and ML walk-forward. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// --- browser stubs
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null };
global.performance = { now: () => Date.now() };

for (const f of ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/registry.js', 'app/researcher.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}

let fails = 0;
const check = (name, cond, info = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  | ' + info : ''));
  if (!cond) fails++;
};

AL.boot();
check('calendar', AL.cal.length > 6000, `${AL.cal.length} days, asof ${AL.asof}`);
const spy = AL.getSeries('SPY');
check('SPY series', spy && spy.values.length > 6000 && spy.values.every(v => v > 0), `last=${spy.values[spy.values.length - 1]}`);
const btc = AL.getSeries('BTC-USD');
check('BTC series', btc && btc.values.length > 3500, `last=${btc.values[btc.values.length - 1]}`);
const vix = AL.getSeries('^VIX');
check('VIX', vix && vix.values[vix.values.length - 1] > 5 && vix.values[vix.values.length - 1] < 100, `VIX=${vix.values[vix.values.length - 1]}`);
const t10 = AL.getSeries('DGS10');
check('FRED DGS10 aligned', t10 && t10.dates.length === t10.values.length && t10.values[t10.values.length - 1] > 0, `10y=${t10.values[t10.values.length - 1]}%`);
const cpi = AL.getSeries('CPIAUCSL');
check('FRED monthly CPI', cpi && cpi.values.length > 500, `${cpi.values.length} obs`);
const oh = AL.ohlc('SPY');
check('OHLC decode', oh && oh.h.every((h, i) => h >= oh.l[i] - 1e-6), `${oh.dates.length} candles`);
const pre = AL.getSeries('^GSPC').pre;
check('GSPC pre-2000 tail', pre && pre.d[0] < '1971-01-01' && pre.d.some(d => d.startsWith('1987-10')), `from ${pre.d[0]}, ${pre.d.length} rows`);

// Black Monday sanity: Oct 19 1987 daily drop ~ -20%
const i87 = pre.d.findIndex(d => d === '1987-10-19');
if (i87 > 0) check('Black Monday in data', pre.v[i87] / pre.v[i87 - 1] - 1 < -0.15, `${((pre.v[i87] / pre.v[i87 - 1] - 1) * 100).toFixed(1)}%`);

// perf sanity on SPY buy-and-hold
const rets = AL.returns('SPY').values;
const p = Q.perf(rets);
check('SPY perf sane', p.cagr > 0.03 && p.cagr < 0.15 && p.maxDD < -0.4 && p.maxDD > -0.7, `CAGR=${(p.cagr * 100).toFixed(1)}% maxDD=${(p.maxDD * 100).toFixed(0)}% SR=${p.sharpe.toFixed(2)}`);

// regime
const reg = Q.marketRegime();
check('regime', !!reg.label && isFinite(reg.pCalm), `${reg.label} pCalm=${reg.pCalm.toFixed(2)} vix=${reg.vix}`);

// strategies: one of each kind
const kinds = {};
for (const e of S.registry) if (e.status === 'ok') { const k = e.def.kind; if (!kinds[k]) kinds[k] = e; }
for (const [k, e] of Object.entries(kinds)) {
  const t0 = Date.now();
  try {
    const r = S.run(e);
    check(`run ${k} (${e.id} ${e.name})`, r && r.stats && isFinite(r.stats.sharpe) && r.rets.length > 500,
      `SR=${r.stats.sharpe.toFixed(2)} n=${r.rets.length} ${Date.now() - t0}ms`);
  } catch (err) { check(`run ${k} (${e.id})`, false, err.message); }
}
// full validate on one
const val = S.validate(S.byId['S001']);
check('validate S001', val && val.verdict && isFinite(val.psr), `verdict=${val.verdict} psr=${val.psr.toFixed(2)} oosSR=${val.oos.sharpe.toFixed(2)}`);

// every runnable strategy at least constructs & runs (catch data gaps) — quick pass
let ok = 0, bad = [];
for (const e of S.registry.filter(x => x.status === 'ok')) {
  if (e.def.kind === 'ml') continue; // heavy, spot-checked above
  try {
    const r = S.run(e);
    if (r && r.stats && isFinite(r.stats.sharpe)) ok++; else bad.push(e.id + ':empty');
  } catch (err) { bad.push(e.id + ':' + err.message.slice(0, 40)); }
}
check('all non-ML strategies run', bad.length === 0, `${ok} ok${bad.length ? ' | BAD: ' + bad.join(', ') : ''}`);

// factor engine
const ev = F.evaluate({ t: 'mom', n: 126, post: 'raw' }, ['SPY', 'QQQ', 'GLD', 'TLT'], 5);
check('factor eval', ev && isFinite(ev.avgIC), `IC=${ev.avgIC.toFixed(3)} verdict=${ev.verdict}`);

// ML walk-forward (ridge, fast)
const feat = ML.makeFeatures('SPY', 5);
check('features', feat.X.length > 3000 && feat.names.length >= 14, `${feat.X.length}x${feat.names.length}`);
const wf = ML.walkForward(feat, 'ridge', {});
const diag = ML.diagnostics(feat, wf.preds);
check('ML ridge WF', diag && isFinite(diag.ic), `IC=${diag.ic.toFixed(3)} hit=${(diag.hit * 100).toFixed(1)}% folds=${wf.folds.length}`);

// optimizers
const al = AL.align(['SPY', 'TLT', 'GLD', 'EFA', 'VNQ'], 'ret');
const Cm = Q.covMatrix(al.cols, al.syms, 504);
for (const [name, w] of [['minVar', Q.minVar(Cm)], ['erc', Q.erc(Cm)], ['hrp', Q.hrp(Cm, Q.corrMatrix(al.cols, al.syms, 504))]]) {
  check('opt ' + name, Math.abs(Q.sum(w) - 1) < 0.01 && w.every(x => x >= -1e-9), w.map(x => x.toFixed(2)).join(','));
}

// monte carlo
const mc = Q.monteCarlo(rets.slice(-1260), 252, 200);
check('monte carlo', mc.length === 200 && mc[0].length === 253);

// researcher single experiment (sync-ish): generate + execute directly
const hypo = RS.generateHypothesis();
check('hypothesis gen', !!hypo.title, hypo.kind + ': ' + hypo.title);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
