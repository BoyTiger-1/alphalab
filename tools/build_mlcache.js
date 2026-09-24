/* Prebuilds the ML walk-forward predictions into data/mlcache.js so the browser opens instantly.
   It runs the exact app code (app/ml.js + app/mlzoo.js) on the freshly downloaded bundle, so a
   cached prediction is bit-for-bit what the browser would compute. The browser only resumes the
   newest rows. Also scores an "ML twin" (meta-labeling overlay) for every runnable strategy.
   Run after build_bundle.py and before assemble.py:  node tools/build_mlcache.js [--no-twins] */
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
const t00 = Date.now();
const enc = arr => arr.map(v => isFinite(v) ? +v.toPrecision(5) : '').join(',');
const out = { asof: AL.asof, built: new Date().toISOString(), preds: {}, meta: {}, twins: {} };

// 1. every ML-kind strategy: store walk-forward predictions
for (const e of S.registry.filter(x => x.status === 'ok' && x.def.kind === 'ml')) {
  const t0 = Date.now();
  const r = S.run(e, {});
  const params = { ...(e.def.params || {}) };
  const from = e.from || '2005-01-01';
  const key = ML.cacheKey(e, params, from);
  const pc = ML._predCache.get(key);
  if (!pc) { console.log('skip', e.id); continue; }
  out.preds[key] = { n: pc.feat.X.length, first: pc.feat.dates[0], last: pc.feat.dates[pc.feat.dates.length - 1],
    p: enc(pc.wf.preds), folds: pc.wf.folds.map(f => [f.at, f.trainN]) };
  console.log(`${e.id} ${e.name.padEnd(40)} Sharpe ${r.stats.sharpe.toFixed(2)}  ${Date.now() - t0}ms`);
}

// 2. meta-kind strategies: store twin probabilities
const metaProb = (base, model) => {
  const tw = ML.zoo.metaOverlay(base, model, { noCache: true });
  if (tw.ok) out.meta[ML.zoo.twinCacheKey(base, model)] = { n: base.dates.length, first: base.dates[0], last: base.dates[base.dates.length - 1], p: enc(tw.rawProb) };
  return tw;
};
for (const e of S.registry.filter(x => x.status === 'ok' && x.def.kind === 'meta')) {
  const t0 = Date.now();
  metaProb(S.run(S.byId[e.def.base], {}), e.def.model);
  console.log(`${e.id} ${e.name.padEnd(40)} meta ${Date.now() - t0}ms`);
}

// 3. an ML twin for every runnable strategy, using its category's ported model
if (!process.argv.includes('--no-twins')) {
  for (const e of S.registry.filter(x => x.status === 'ok' && x.def.kind !== 'meta')) {
    const t0 = Date.now();
    try {
      const base = S.run(e, {});
      if (!base || !base.rets || base.rets.length < 900) continue;
      const model = ML.zoo.twinModelFor(e);
      const tw = metaProb(base, model);
      if (!tw.ok) { console.log(`${e.id} twin: ${tw.reason}`); continue; }
      const f = x => isFinite(x) ? +x.toFixed(4) : null;
      out.twins[e.id] = { model, base: f(tw.baseStats.sharpe), twin: f(tw.stats.sharpe), baseDD: f(tw.baseStats.maxDD), twinDD: f(tw.stats.maxDD),
        baseCagr: f(tw.baseStats.cagr), twinCagr: f(tw.stats.cagr), auc: f(tw.auc), acc: f(tw.accuracy), prec: f(tw.precision), rate: f(tw.baseRate), n: tw.nOOS,
        size: f(tw.size[tw.size.length - 1]), top: tw.importance.slice(0, 3).map(x => x.feature) };
      console.log(`${e.id} twin ${model.padEnd(11)} ${tw.baseStats.sharpe.toFixed(2)} -> ${tw.stats.sharpe.toFixed(2)}  AUC ${f(tw.auc)}  ${Date.now() - t0}ms`);
    } catch (err) { console.log(`${e.id} twin error: ${err.message}`); }
  }
}

const js = 'window.ALPHALAB_MLCACHE=' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'mlcache.js'), js);
console.log(`\nwrote data/mlcache.js  ${(js.length / 1e6).toFixed(2)} MB, ${Object.keys(out.preds).length} models, ${Object.keys(out.twins).length} twins, ${((Date.now() - t00) / 1000).toFixed(0)}s`);
