/* Prebuilds the quant brain's evidence into data/evidence.js so the Competition Center and Stock
   Advisor can weight every engine by its track record without making the browser run it:
     strategies: the strategy library's own validator on every single-instrument strategy, plus each
                 one's signal today (only VALIDATED strategies are allowed to vote)
     ml:         walk-forward record (IC, t-stat, hit rate) and today's call for every model in the ML
                 lab, including the deep sequence models, on every daily equity
   It runs the exact app code (app/modules_j.js), so the numbers match what the browser would compute.
   The ML zoo is the slow part (about a minute per name), so names are split across CPU cores.
   Run after build_bundle.py and before assemble.py:  node tools/build_evidence.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
global.performance = { now: () => Date.now() };
global.UI = { def: () => {}, MODULES: {}, altSignals: null };
for (const f of ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/mlzoo.js', 'app/strategies.js', 'app/registry.js', 'app/modules_j.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
AL.boot();
const equities = Object.keys(AL.D.series).filter(s => AL.D.series[s].cls === 'Equity');

// worker: node build_evidence.js --shard i/n  prints {sym: evidence} for its slice of names
const shardArg = process.argv.indexOf('--shard');
if (shardArg > 0) {
  const [i, n] = process.argv[shardArg + 1].split('/').map(Number);
  const out = {};
  equities.forEach((sym, k) => {
    if (k % n !== i) return;
    const ev = UI.computeMlEvidence(sym, true);
    if (ev) out[sym] = ev;
  });
  process.stdout.write('@@EVIDENCE@@' + JSON.stringify(out));
  return;
}

function runShard(i, n) {
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [__filename, '--shard', `${i}/${n}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    ch.stdout.on('data', d => buf += d);
    ch.on('close', code => {
      try { resolve(JSON.parse(buf.slice(buf.lastIndexOf('@@EVIDENCE@@') + 12))); } catch (e) { console.log(`shard ${i}/${n} failed (exit ${code})`); resolve({}); }
    });
  });
}

(async () => {
  const t0 = Date.now();
  const n = Math.max(1, Math.min(8, os.cpus().length));
  const pending = Array.from({ length: n }, (_, i) => runShard(i, n));   // ML zoo runs while the library validates

  const strategies = UI.buildStrategyEvidence();
  const nVal = Object.values(strategies.bySym).flat().filter(x => x.verdict === 'VALIDATED').length;
  console.log(`strategy library: ${strategies.tested} tested, ${nVal} validated  ${Date.now() - t0}ms`);

  const parts = await Promise.all(pending), ml = {};
  for (const sym of equities) for (const p of parts) if (p[sym]) ml[sym] = p[sym];
  const vot = Object.values(ml).map(x => UI.mlVoters(x));
  const k = vot.length ? Math.max(...vot.map(x => x.k)) : 0;
  console.log(`ML evidence: ${Object.keys(ml).length} of ${equities.length} names, ${k} models each, bar t >= ${UI.mlTStar(k)}, ` +
    `${vot.filter(x => x.pass.length).length} names with a voting model  ${Date.now() - t0}ms (${n} workers)`);
  for (const [sym, x] of Object.entries(ml)) {
    const v = UI.mlVoters(x);
    if (v.pass.length) console.log(`  ${sym}: ${v.pass.map(p => `${p.id} t=${p.t}`).join(', ')}`);
  }

  const out = { asof: AL.asof, built: new Date().toISOString(), strategies, ml };
  fs.writeFileSync(path.join(ROOT, 'data', 'evidence.js'), 'window.ALPHALAB_EVIDENCE=' + JSON.stringify(out) + ';\n');
  console.log(`wrote data/evidence.js  ${Date.now() - t0}ms total`);
})();
