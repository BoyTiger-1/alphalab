/* headless test of the decision/fundamental engine using the real bundles */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', style: {}, content: {} }), body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
global.performance = { now: () => Date.now() };
global.UI = { def: () => {}, MODULES: {}, altSignals: null };

for (const f of ['data/bundle.js', 'data/fundamentals.js', 'data/newsfeed.js', 'data/sp500.js', 'data/market.js',
  'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/registry.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
// pull just the scoring + decision functions out of modules_d/g without the full UI.def machinery
const md = fs.readFileSync(path.join(ROOT, 'app/modules_d.js'), 'utf-8');
const mg = fs.readFileSync(path.join(ROOT, 'app/modules_g.js'), 'utf-8');
// UI.def is a no-op stub, so evaluating the module files just registers the helper functions on UI
new Function(md)();
new Function(mg)();

AL.boot();
let fails = 0;
const check = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  | ' + i : '')); if (!c) fails++; };

check('fundamentals bundle', AL.fundMeta() && Object.keys(AL.fundMeta().tickers).length > 800, `${Object.keys(AL.fundMeta().tickers).length} tickers`);
check('newsfeed bundle', AL.newsMeta() && Object.keys(AL.newsMeta().tickers).length > 40, `${Object.keys(AL.newsMeta().tickers).length} tickers`);

const fdAAPL = AL.fund('AAPL');
check('AAPL fundamentals', fdAAPL && fdAAPL.pe > 0 && fdAAPL.tgtMean > 0 && Array.isArray(fdAAPL.rec),
  `PE ${fdAAPL.pe && fdAAPL.pe.toFixed(1)}, target ${fdAAPL.tgtMean}, rec ${JSON.stringify(fdAAPL.rec)}`);

const fs2 = UI.fundamentalScore('AAPL');
check('fundamental score', fs2 && fs2.pillars && (fs2.bull.length || fs2.bear.length),
  `value ${fs2.pillars.value?.toFixed(2)} quality ${fs2.pillars.quality?.toFixed(2)} growth ${fs2.pillars.growth?.toFixed(2)} analyst ${fs2.pillars.analyst?.toFixed(2)}`);

// decision on several names, all should return a valid call
for (const s of ['AAPL', 'JPM', 'XOM', 'NVDA', 'KO', 'TSLA']) {
  const d = UI.decision(s);
  check(`decision ${s}`, d && ['BUY', 'HOLD', 'SELL'].includes(d.call) && isFinite(d.overall),
    `${d.call} (${d.overall.toFixed(2)}), pillars ${Object.keys(d.pillars).length}`);
}

// scoreStocks now folds in fundamentals; verify it caches and includes fund fields
const t0 = Date.now();
const res = UI.scoreStocks();
const dt = Date.now() - t0;
const res2 = UI.scoreStocks();
check('scoreStocks + cache', res.rows.length > 4000 && res2 === res, `${res.rows.length} stocks in ${dt}ms, cached on 2nd call`);
const withFund = res.rows.filter(r => r.hasFund).length;
check('advisor uses fundamentals', withFund > 700, `${withFund} rows carry fundamental pillars`);

// news/posts present
const nf = AL.newsFor('NVDA');
check('NVDA posts', nf && nf.posts && nf.posts.length > 0, nf && nf.posts ? `${nf.posts.length} posts, first: "${nf.posts[0].b.slice(0, 40)}"` : 'none');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
