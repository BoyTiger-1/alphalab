/* end-to-end firm simulator test: found a fund, allocate, run all 156 weeks */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null };
global.performance = { now: () => Date.now() };
global.UI = { def: () => {}, MODULES: {} };   // module registration is a no-op headlessly

for (const f of ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/registry.js', 'app/researcher.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
// modules_f needs UI stubbed but defines FIRM at global scope
const src = fs.readFileSync(path.join(ROOT, 'app/modules_f.js'), 'utf-8');
new Function(src)();

AL.boot();
let fails = 0;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  | ' + info : '')); if (!cond) fails++; };

const f = FIRM.newFund('Test Capital', 25e6);
check('fund created', f && f.aum === 25e6 && f.sleeves.length === 1, `start window idx ${f.startIdx} (${AL.cal[f.startIdx]})`);

// allocate: 30% golden cross, 20% managed futures, 15% SPY, 10% GLD, rest cash
f.sleeves = [
  { kind: 'strategy', id: 'S001', w: 0.30 },
  { kind: 'strategy', id: 'S006', w: 0.20 },
  { kind: 'stock', sym: 'SPY', w: 0.15 },
  { kind: 'stock', sym: 'GLD', w: 0.10 },
  { kind: 'cash', w: 0.25 },
];
FIRM.norm(f);
check('weights normalized', Math.abs(Q.sum(f.sleeves.map(s => s.w)) - 1) < 1e-9);

const votes = FIRM.debate(f, f.sleeves);
check('committee votes', votes.length === 3 && votes.every(v => typeof v.ok === 'boolean'), votes.map(v => (v.ok ? 'Y' : 'N')).join(''));

const t0 = Date.now();
FIRM.advance(f, 156);
check('sim completes', f.done === true, `${Date.now() - t0}ms for 156 weeks`);
check('nav sane', f.nav > 0.3 && f.nav < 4, `final NAV ${f.nav.toFixed(3)} vs SPY ${f.navHist[f.navHist.length - 1].spy.toFixed(3)}`);
check('events fired', f.events.length > 0, `${f.events.length} events`);
check('analysts spoke', f.chat.filter(c => c.who.startsWith('Priya')).length >= 3, `${f.chat.length} messages`);
check('graded', ['A', 'B', 'C', 'D', 'F'].includes(f.grade), `grade ${f.grade}, window ${f.reveal}, fees ${AL.fmt.usd(f.feesEarned)}, flows ${AL.fmt.usd(f.netFlows)}`);
check('window is real dates', /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(f.reveal), f.reveal);

// weekly universes loaded?
for (const [name2, file, key] of [['sp500 bundle', 'data/sp500.js', 'ALPHALAB_SP500'], ['market bundle', 'data/market.js', 'ALPHALAB_MKT']]) {
  new Function(fs.readFileSync(path.join(ROOT, file), 'utf-8'))();
  check(name2, !!global[key] && Object.keys(global[key].cols).length > 400, `${Object.keys(global[key].cols).length} tickers`);
}
// getSeries across tiers
AL._cache.clear();
const nvda = AL.getSeries('NVDA');       // daily tier
const someSp = AL.getSeries(Object.keys(global.ALPHALAB_SP500.cols).find(s => !window.ALPHALAB_DATA.series[s]));
const someMkt = AL.getSeries(Object.keys(global.ALPHALAB_MKT.cols)[10]);
check('tiered getSeries', nvda && !nvda.weekly && someSp && someSp.weekly && someMkt && someMkt.weekly,
  `${someSp.sym} (${someSp.sector}), ${someMkt.sym} (${someMkt.sector})`);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
