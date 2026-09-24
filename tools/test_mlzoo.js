/* ML Zoo test: gradient-checks the autograd engine, then trains every ported open-source model
   walk-forward on the real bundled data and checks each produces sane, finite, out-of-sample output.
   Also covers HMM, Kalman, GARCH, OLMAR, fractional differencing, triple barrier and the
   meta-labeling twin. Run: node tools/test_mlzoo.js [--quick] */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null };
global.performance = { now: () => Date.now() };
for (const f of ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/mlzoo.js', 'app/registry.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
AL.boot();
const quick = process.argv.includes('--quick');
let fails = 0;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  | ' + info : '')); if (!cond) fails++; };
const Z = ML.zoo, op = Z.op;
const f3 = x => (x == null || !isFinite(x)) ? String(x) : x.toFixed(3);

/* 1. autograd gradient check on every net (finite differences) */
for (const net of ['lstm', 'gru', 'alstm', 'transformer']) {
  const rand = AL.rng(4), d = 3, Tn = 4, H = net === 'transformer' ? 4 : 3;
  const P = Z.NETS[net].init(d, H, rand);
  const X = Array.from({ length: 5 }, () => Array.from({ length: d * Tn }, () => rand() - 0.5));
  const Y = Float64Array.from({ length: 5 }, () => rand() - 0.5);
  const lossOf = () => {
    const xs = []; for (let t = 0; t < Tn; t++) { const m = new Z.T(5, d); for (let b = 0; b < 5; b++) for (let f = 0; f < d; f++) m.d[b * d + f] = X[b][f * Tn + t]; xs.push(m); }
    return op.mse(Z.NETS[net].forward(P, xs, H).out, Y);
  };
  const L = lossOf(); Z.backward(L);
  let worst = 0;
  for (const t of Object.values(P)) {
    const g = t.g ? Float64Array.from(t.g) : new Float64Array(t.d.length);
    for (let i = 0; i < Math.min(t.d.length, 6); i++) {
      const o = t.d[i]; t.d[i] = o + 1e-5; const a = lossOf().d[0]; t.d[i] = o - 1e-5; const b = lossOf().d[0]; t.d[i] = o;
      const num = (a - b) / 2e-5; worst = Math.max(worst, Math.abs(num - g[i]) / Math.max(1e-6, Math.abs(num) + Math.abs(g[i])));
    }
    t.g = null;
  }
  check('autograd grad-check ' + net, worst < 1e-4, 'max rel err ' + worst.toExponential(2));
}

/* 2. every ported model walk-forward on real data */
const runs = quick ? ['S119', 'S123', 'S125', 'S130', 'S134'] : S.registry.filter(e => e.cat === 'Open-Source ML').map(e => e.id);
for (const id of runs) {
  const e = S.byId[id]; if (!e) { check('registry ' + id, false, 'missing'); continue; }
  const t0 = Date.now();
  let r = null, err = '';
  try { r = S.run(e, {}); } catch (x) { err = x.stack.split('\n').slice(0, 3).join(' '); }
  const ms = Date.now() - t0;
  const ok = r && r.rets && r.rets.length > 500 && r.rets.every(isFinite) && r.stats && isFinite(r.stats.sharpe) && Math.abs(r.stats.cagr) < 2;
  check(`${id} ${e.name}`, ok, err || (r ? `Sharpe ${f3(r.stats.sharpe)} CAGR ${f3(r.stats.cagr)} MaxDD ${f3(r.stats.maxDD)} vs bench Sharpe ${f3(r.bstats.sharpe)}, ${r.rets.length} days, ${ms}ms` : 'null run'));
  if (r && r.mlDiag) console.log(`      IC ${f3(r.mlDiag.ic)} hit ${f3(r.mlDiag.hit)} n ${r.mlDiag.n}`);
  if (r && r.meta) console.log(`      meta AUC ${f3(r.meta.auc)} acc ${f3(r.meta.accuracy)} prec ${f3(r.meta.precision)} base-rate ${f3(r.meta.baseRate)} base Sharpe ${f3(r.meta.baseStats.sharpe)} -> ${f3(r.meta.stats.sharpe)}`);
}

/* 3. no look-ahead: a prediction for day i must not change when future data is removed */
{
  const feat = ML.makeFeatures('SPY', 5);
  const cut = feat.X.length - 300;
  const trunc = { ...feat, X: feat.X.slice(0, cut), y: feat.y.slice(0, cut), dates: feat.dates.slice(0, cut), idx: feat.idx.slice(0, cut) };
  const a = ML.walkForward(feat, 'rf', { refit: 252 }), b = ML.walkForward(trunc, 'rf', { refit: 252 });
  let same = true; for (let i = 0; i < cut; i++) if (isFinite(b.preds[i]) && Math.abs(a.preds[i] - b.preds[i]) > 1e-12) { same = false; break; }
  check('walk-forward is causal (RF preds unchanged when future rows removed)', same, `purge ${a.purge} rows`);
}

/* 4. time-series models */
{
  const r = AL.returns('SPY').values || AL.returns('SPY');
  const rets = Array.isArray(r) ? r : r.values;
  const g = Z.garch(rets.slice(-2500));
  check('GARCH(1,1) MLE', g.alpha > 0 && g.beta > 0.7 && g.persistence < 1 && g.longRunVol > 0.08 && g.longRunVol < 0.4,
    `omega ${g.omega.toFixed(4)} alpha ${f3(g.alpha)} beta ${f3(g.beta)} LR vol ${f3(g.longRunVol)} half-life ${g.halfLife.toFixed(1)}d`);
  const h = Z.hmmCausal(rets, 3);
  const last = h.probs[h.probs.length - 1];
  check('Gaussian HMM (causal)', last && Math.abs(last.reduce((a, b) => a + b, 0) - 1) < 1e-6 && h.model.va[0][1] <= h.model.va[2][1],
    'P(calm, mid, stress) today = ' + last.map(f3).join(', '));
  const xom = AL.getSeries('XOM').values, cvx = AL.getSeries('CVX').values, m = Math.min(xom.length, cvx.length);
  const k = Z.kalmanHedge(cvx.slice(-m).map(Math.log), xom.slice(-m).map(Math.log));
  check('Kalman hedge', k.beta.every(isFinite) && Math.abs(k.beta[k.beta.length - 1]) < 5, `beta today ${f3(k.beta[k.beta.length - 1])}`);
  const px = AL.getSeries('SPY').values.map(Math.log);
  const mf = Z.minFFD(px.slice(-3000));
  check('Fractional differencing (min d for stationarity)', mf.d > 0 && mf.d <= 1, `d* = ${mf.d}, corr with log price ${f3(mf.table.find(t => t.d === mf.d).corr)}`);
  const tb = Z.tripleBarrier([0, 0.01, 0.02, 0.03], 0, 3, 0.025, 0.025);
  check('Triple barrier', tb.label === 1 && tb.barrier === 'upper' && tb.t === 2);
  check('Simplex projection', Math.abs(Z.simplex([0.5, 0.9, -0.2]).reduce((a, b) => a + b, 0) - 1) < 1e-9);
}

/* 5. meta-labeling twin on a classic strategy with a fast and a deep model */
for (const [sid, mid] of quick ? [['S001', 'logistic']] : [['S001', 'logistic'], ['S013', 'rf'], ['S006', 'gru']]) {
  const t0 = Date.now();
  const base = S.run(S.byId[sid], {});
  const tw = Z.metaOverlay(base, mid);
  check(`ML twin ${sid} (${mid})`, tw.ok && tw.rets.every(isFinite) && isFinite(tw.auc),
    tw.ok ? `base Sharpe ${f3(tw.baseStats.sharpe)} -> twin ${f3(tw.stats.sharpe)}, AUC ${f3(tw.auc)}, ${tw.nOOS} OOS labels, ${tw.nFits} fits, ${Date.now() - t0}ms` : tw.reason);
}
check('every category maps to a twin model', S.categories.every(c => !S.registry.some(e => e.cat === c && e.status === 'ok') || ML.models[Z.CATEGORY_MODEL[c]]),
  S.categories.filter(c => !Z.CATEGORY_MODEL[c]).join(',') || 'all mapped');
check('sources documented', ML.SOURCES.length >= 15 && ML.SOURCES.every(s => s.repo && s.license));

console.log(fails ? `\n${fails} FAILED` : '\nALL ML ZOO TESTS PASSED');
process.exit(fails ? 1 : 0);
