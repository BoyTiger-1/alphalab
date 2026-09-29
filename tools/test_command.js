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
  'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/mlzoo.js', 'app/registry.js']) {
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
}
// modules_d/g carry the advisor + decision engine the allocator leans on; modules_h is the allocator
for (const m of ['app/modules_d.js', 'app/modules_g.js', 'app/modules_h.js']) new Function(fs.readFileSync(path.join(ROOT, m), 'utf-8'))();
// the quant brain (website only; the bot never loads it) and its prebuilt evidence, when present
if (fs.existsSync(path.join(ROOT, 'data/evidence.js'))) new Function(fs.readFileSync(path.join(ROOT, 'data/evidence.js'), 'utf-8'))();
new Function(fs.readFileSync(path.join(ROOT, 'app/modules_j.js'), 'utf-8'))();

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

// --- risk level reaches inside the equity bucket (website path, no stockShare override) -------
const tp = {};
for (const prof of ['conservative', 'balanced', 'aggressive']) tp[prof] = UI.buildAllocation(100000, prof);
const stocksOf = t => t.holdings.filter(h => h.shares > 0 && /^single/.test(h.role));
const avgVol = t => { const sc2 = UI.scoreStocks(); const v = stocksOf(t).map(h => sc2.bySym[h.sym] && sc2.bySym[h.sym].vol).filter(isFinite); return v.reduce((a, b) => a + b, 0) / (v.length || 1); };
check('profiles hold different stock counts', stocksOf(tp.conservative).length < stocksOf(tp.aggressive).length,
  `cons ${stocksOf(tp.conservative).length} vs aggr ${stocksOf(tp.aggressive).length}`);
check('aggressive holds far more in individual stocks', tp.aggressive.stockPct > tp.balanced.stockPct && tp.balanced.stockPct > tp.conservative.stockPct && tp.aggressive.stockPct > 0.4,
  ['conservative', 'balanced', 'aggressive'].map(k => `${k} ${(tp[k].stockPct * 100).toFixed(0)}%`).join(', '));
check('conservative stocks are calmer than aggressive ones', avgVol(tp.conservative) < avgVol(tp.aggressive),
  `avg vol ${(avgVol(tp.conservative) * 100).toFixed(0)}% vs ${(avgVol(tp.aggressive) * 100).toFixed(0)}%`);
const setOf = t => new Set(stocksOf(t).map(h => h.sym));
const overlap = [...setOf(tp.conservative)].filter(x => setOf(tp.aggressive).has(x)).length;
check('conservative and aggressive pick different stocks', overlap < setOf(tp.conservative).size, `${overlap} shared`);
check('conservative stays inside its vol limit', stocksOf(tp.conservative).every(h => { const r = UI.scoreStocks().bySym[h.sym]; return r && r.vol <= UI.RISK_PROFILES.conservative.maxVol; }));
check('no fund, trust or note in the stock sleeve', ['conservative', 'balanced', 'aggressive'].every(k => stocksOf(tp[k]).every(h => UI.isOperatingCo(UI.scoreStocks().bySym[h.sym]))));
check('no stock above the profile cap', ['conservative', 'balanced', 'aggressive'].every(k => stocksOf(tp[k]).every(h => h.dollars / 100000 <= UI.RISK_PROFILES[k].maxName + 0.005)));

// --- "can't buy" removes a ticker and the next candidate fills the slot ------------------------
const base = UI.buildAllocation(100000, 'balanced');
const gone = stocksOf(base)[0].sym;
UI.excludeSym(gone); UI.excludeSym('SPY');
const repl = UI.buildAllocation(100000, 'balanced');
check('excluded stock is replaced, count kept', !repl.holdings.some(h => h.sym === gone) && stocksOf(repl).length === stocksOf(base).length,
  `${gone} out, now ${stocksOf(repl).map(h => h.sym).join(',')}`);
check('excluded fund falls back to its alternative', !repl.holdings.some(h => h.sym === 'SPY') && repl.holdings.some(h => h.sym === 'VTI' || h.sym === 'DIA'));
check('plan records the exclusions', repl.excluded.includes(gone) && repl.excluded.includes('SPY'));
UI.restoreSym(gone); UI.restoreSym('SPY');
check('restore brings the list back to empty', UI.excludedList().length === 0);
// the bot's fixed recipe (explicit stockShare) is unchanged by the profile-driven picker
const botT = UI.buildAllocation(100000, 'balanced', 10, { stockShare: 0.55 });
check('bot path keeps its own stock count', stocksOf(botT).length <= 10 && !botT.tuned, `${stocksOf(botT).length} stocks`);

// --- quant brain: every tool feeds the plan, weighted by its evidence ---------------------------
const bt = UI.factorBacktest();
check('factor backtest runs point-in-time on the S&P 500', bt && bt.periods >= 80 && bt.avgNames > 300, bt && `${bt.periods} periods, ${Math.round(bt.avgNames)} names, ${bt.from} to ${bt.to}`);
check('calibrated factor weights are never negative and never exceed the prior total', bt && Object.values(bt.weights).every(w => w >= 0)
  && UI.PRICE_FACTORS.reduce((s, k) => s + bt.weights[k], 0) <= UI.PRICE_FACTORS.reduce((s, k) => s + bt.prior[k], 0) + 1e-9);
check('factor vote is silenced when the out-of-sample composite has no edge', bt && (bt.composite.calibrated.t >= 1 || bt.compositeMult === 0), bt && `composite t=${bt.composite.calibrated.t.toFixed(2)}`);
check('aligned beta is sane for a mega-cap', (() => { const b = UI.alignedBeta('AAPL'); return b > 0.5 && b < 2; })(), `AAPL beta ${(UI.alignedBeta('AAPL') || 0).toFixed(2)}`);
UI._picksCache = {};
const plans = Object.fromEntries(['conservative', 'balanced', 'aggressive'].map(k => [k, UI.buildAllocation(100000, k)]));
for (const k of Object.keys(plans)) {
  const t = plans[k], P = UI.RISK_PROFILES[k], b = t.brain;
  check(`${k}: plan carries the brain's record`, b && b.sleeve && b.risk);
  const st = stocksOf(t).map(h => h.sym);
  let worstC = 0;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) { const c = UI.pairCorr(st[i], st[j]); if (c != null) worstC = Math.max(worstC, c); }
  check(`${k}: no two stocks move together beyond the limit (unless needed to fill the count)`, worstC <= P.maxCorr + 1e-9 || b.sleeve.skipped.length > 0, `max pair corr ${worstC.toFixed(2)} vs ${P.maxCorr}`);
  check(`${k}: plan volatility inside the budget`, b.risk.vol <= P.budget.vol * 1.01 + 1e-9, `${(b.risk.vol * 100).toFixed(1)}% vs ${(P.budget.vol * 100).toFixed(1)}%`);
  check(`${k}: measured crisis replay inside the budget`, !b.risk.worst || b.risk.worst.ret >= P.budget.stress * 1.01, b.risk.worst ? `${b.risk.worst.name} ${(b.risk.worst.ret * 100).toFixed(0)}%` : 'replays indicative only');
  check(`${k}: dollars reconcile after the budget`, Math.abs(t.holdings.reduce((s, h) => s + h.dollars, 0) + t.cashDollars - 100000) < 1);
  const ev = UI.strategyEvidence();
  check(`${k}: only VALIDATED strategies time a fund`, b.timing.every(x => x.ids.every(id => Object.values(ev.bySym).flat().some(e => e.id === id && e.verdict === 'VALIDATED'))),
    b.timing.map(x => `${x.sym} ${x.n} strat, long ${(x.s * 100).toFixed(0)}%`).join('; ') || 'no validated strategy on these funds');
}
const sz = UI.sizeSleeve(stocksOf(plans.balanced).map(h => ({ ...UI.scoreStocks().bySym[h.sym], conv: 0.3, agreeFrac: 0.6 })), 'balanced', 0.15);
check('sleeve optimizer respects the cap and sums to at most 1', sz.w.every(w => w <= 0.15 + 1e-9) && Q.sum(sz.w) <= 1 + 1e-9, sz.w.map(w => w.toFixed(3)).join(' '));
const bcSym = ['AAPL', 'MSFT', 'JPM'].find(x => UI.scoreStocks().bySym[x]);
const bc = bcSym && UI.brainConviction(bcSym, UI.scoreStocks());
const mlv = bc && bc.votes.find(v => v.engine === 'ML forecast');
check('ML votes only with a significant walk-forward record', !mlv || (mlv.w > 0) === ((UI.mlEvidence(bc.sym) || { t: 0 }).t >= 1), mlv ? `${bcSym} ${mlv.why}` : 'no ML vote');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
