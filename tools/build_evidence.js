/* Prebuilds the quant brain's evidence into data/evidence.js so the Competition Center and Stock
   Advisor can weight every engine by its track record without making the browser run it:
     strategies: the strategy library's own validator on every single-instrument strategy, plus each
                 one's signal today (only VALIDATED strategies are allowed to vote)
     ml:         walk-forward ridge forecast record (IC, t-stat, hit rate) for every daily equity
   It runs the exact app code (app/modules_j.js), so the numbers match what the browser would compute.
   Run after build_bundle.py and before assemble.py:  node tools/build_evidence.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
global.performance = { now: () => Date.now() };
global.UI = { def: () => {}, MODULES: {}, altSignals: null };
for (const f of ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/registry.js', 'app/modules_j.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
AL.boot();
const t0 = Date.now();

const strategies = UI.buildStrategyEvidence();
const nVal = Object.values(strategies.bySym).flat().filter(x => x.verdict === 'VALIDATED').length;
console.log(`strategy library: ${strategies.tested} tested, ${nVal} validated  ${Date.now() - t0}ms`);

const t1 = Date.now(), ml = {};
for (const sym of Object.keys(AL.D.series)) {
  if (AL.D.series[sym].cls !== 'Equity') continue;
  const ev = UI.computeMlEvidence(sym);
  if (ev) ml[sym] = ev;
}
const sig = Object.values(ml).filter(x => x.t >= 1).length;
console.log(`ML evidence: ${Object.keys(ml).length} names, ${sig} with t >= 1  ${Date.now() - t1}ms`);

const out = { asof: AL.asof, built: new Date().toISOString(), strategies, ml };
fs.writeFileSync(path.join(ROOT, 'data', 'evidence.js'), 'window.ALPHALAB_EVIDENCE=' + JSON.stringify(out) + ';\n');
console.log(`wrote data/evidence.js  ${Date.now() - t0}ms total`);
