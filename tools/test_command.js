/* headless test of the Command Center allocator + daily briefing on the real bundles */
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
// modules_d/g carry the advisor + decision engine the allocator leans on; modules_h is the allocator
for (const m of ['app/modules_d.js', 'app/modules_g.js', 'app/modules_h.js']) new Function(fs.readFileSync(path.join(ROOT, m), 'utf-8'))();

AL.boot();
let fails = 0;
const check = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  | ' + i : '')); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- allocation invariants across every risk profile -------------------------------------
const vols = {};
for (const prof of ['conservative', 'balanced', 'aggressive']) {
  const t = UI.buildAllocation(100000, prof, 5);
  const inv = t.holdings.filter(h => h.shares > 0);
  const deployed = inv.reduce((s, h) => s + h.dollars, 0);
  vols[prof] = t.expVol;
  check(`${prof}: builds a real multi-asset book`, inv.length >= 8 && new Set(inv.map(h => h.bucket)).size >= 4,
    `${inv.length} positions across ${new Set(inv.map(h => h.bucket)).size} buckets`);
  check(`${prof}: dollars reconcile to capital`, near(deployed + t.cashDollars, 100000, 1) && t.cashDollars >= -1,
    `deployed ${deployed.toFixed(0)} + cash ${t.cashDollars.toFixed(0)}`);
  check(`${prof}: every position has whole/again-buyable shares & a price`, inv.every(h => h.shares > 0 && isFinite(h.price) && h.price > 0 && (h.cls === 'Crypto' || Number.isInteger(h.shares))),
    `e.g. ${inv[0].sym} x${inv[0].shares} @ ${inv[0].price.toFixed(2)}`);
  check(`${prof}: expected vol is sane (0-60%)`, t.expVol != null && t.expVol > 0.01 && t.expVol < 0.6, `${(t.expVol * 100).toFixed(1)}%`);
  check(`${prof}: monte carlo produced a loss probability`, t.mc && t.mc.pLoss >= 0 && t.mc.pLoss <= 1 && isFinite(t.mc.median),
    t.mc ? `median ${(t.mc.median * 100).toFixed(1)}%, P(loss) ${(t.mc.pLoss * 100).toFixed(0)}%` : 'no mc');
}
// risk ordering: an aggressive book should carry more volatility than a conservative one
check('risk ordering conservative < aggressive', vols.aggressive > vols.conservative,
  `cons ${(vols.conservative * 100).toFixed(1)}% vs aggr ${(vols.aggressive * 100).toFixed(1)}%`);

// --- stock picks are large-cap, buy-rated, sector-diversified -----------------------------
const picks = UI.topStockPicks(5);
check('stock picks are large-cap & not SELL', picks.length >= 1 && picks.every(p => UI.isLargeCap(p) && UI.decision(p.sym).call !== 'SELL'),
  picks.map(p => p.sym).join(', ') || 'none');
// diversification is checked on the canonical sector so GICS/NASDAQ synonyms (e.g. Technology vs
// Information Technology) can't sneak two names from the same real sector into the sleeve
const canon = picks.map(p => UI.canonSector(p.sector)).filter(Boolean);
check('stock picks diversify sectors (synonym-folded)', new Set(canon).size === canon.length,
  picks.map(p => `${p.sym}:${UI.canonSector(p.sector) || p.sector}`).join(' '));

// --- daily briefing turns an all-cash book into a full buy list ---------------------------
const target = UI.buildAllocation(100000, 'balanced', 5);
AL.store.set('command_target', target);
AL.store.set('holdings', []);          // fresh competition book: all cash, nothing held
AL.store.set('cash', 100000);
const brief = UI.dailyBriefing(target);
const buys = brief.orders.filter(o => o.side === 'BUY');
check('empty book -> all-buy briefing', brief.orders.length >= 8 && buys.length === brief.orders.length,
  `${brief.orders.length} orders, all BUY`);
check('briefing order value ~ deployable capital', near(buys.reduce((s, o) => s + o.dollars, 0), 100000 - target.cashDollars, 100000 * 0.05),
  `${buys.reduce((s, o) => s + o.dollars, 0).toFixed(0)} vs ${(100000 - target.cashDollars).toFixed(0)}`);

// --- a book already equal to the target should need no trades -----------------------------
const asBook = target.holdings.filter(h => h.shares > 0).map(h => ({ sym: h.sym, qty: h.shares, costBasis: h.price }));
AL.store.set('holdings', asBook);
AL.store.set('cash', target.cashDollars);
const brief2 = UI.dailyBriefing(target);
check('on-target book -> few/no trades', brief2.orders.length <= 1 && brief2.maxDrift < 0.03,
  `${brief2.orders.length} orders, max drift ${(brief2.maxDrift * 100).toFixed(2)}%`);

// --- multi-engine synthesis: the briefing fuses decision + advisor + sentiment ------------
check('briefing exposes protect / opportunities / risks arrays', Array.isArray(brief2.protect) && Array.isArray(brief2.opportunities) && Array.isArray(brief2.risks),
  `protect ${brief2.protect.length}, opportunities ${brief2.opportunities.length}, risks ${brief2.risks.length}`);
check('rebalance orders are annotated with a decision call slot', brief2.orders.every(o => 'call' in o && 'conviction' in o),
  brief2.orders.map(o => `${o.sym}:${o.call || '-'}`).join(' ') || 'no orders');
// per-name fusion: a covered single stock gets a bounded conviction + human reasons...
const pk = picks[0] ? picks[0].sym : 'AAPL';
const sc = UI.symConviction(pk, UI.scoreStocks());
check('symConviction fuses engines for a real stock', sc && sc.nEngines >= 1 && Math.abs(sc.conviction) <= 1.0001 && sc.why.length >= 1,
  sc ? `${pk}: conv ${sc.conviction.toFixed(2)} across ${sc.nEngines} engine(s)` : `${pk}: null`);
check('symConviction agree count never exceeds engines that voted', !sc || (sc.agree >= 0 && sc.agree <= sc.nEngines),
  sc ? `${sc.agree}/${sc.nEngines}` : 'n/a');
// ...but a structural ETF sleeve (bonds/gold) no engine covers returns null, so it is never flagged
const structural = ['IEF', 'TLT', 'GLD', 'TIP'].filter(s => AL.getSeries(s));
const nulled = structural.filter(s => UI.symConviction(s, UI.scoreStocks()) == null);
check('structural ETFs are not stock-scored (null conviction)', structural.length === 0 || nulled.length >= Math.ceil(structural.length / 2),
  `${nulled.length}/${structural.length} of ${structural.join(',')} null`);
// opportunities, when present, are un-owned large-caps the decision engine does not reject
const heldNow = new Set(asBook.map(h => h.sym));
check('opportunities are un-owned & not SELL-rated', brief2.opportunities.every(o => !heldNow.has(o.sym) && o.conviction > 0.30 && o.why.length >= 1),
  brief2.opportunities.map(o => `${o.sym}:${o.conviction.toFixed(2)}`).join(' ') || 'none surfaced');

// --- concentration overlay: an over-weighted single position gets flagged -----------------
const bigSym = AL.getSeries('SPY') ? 'SPY' : (asBook[0] && asBook[0].sym);
AL.store.set('holdings', [{ sym: bigSym, qty: 400, costBasis: AL.getSeries(bigSym).values.slice(-1)[0] }]);
AL.store.set('cash', 0);
const brief3 = UI.dailyBriefing(target);
check('concentration risk flags a lone oversized position', brief3.risks.some(r => r.sym === bigSym && r.weight > 0.25),
  brief3.risks.map(r => `${r.sym} ${(r.weight * 100).toFixed(0)}%`).join(', ') || 'none');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
