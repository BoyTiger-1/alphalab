'use strict';
// Runs the real AlphaLab engines inside Node and hands back a target book: which symbols to hold and
// at what weight. This is the same code path the website uses, loaded the same way the test harness
// loads it, so the bot trades on the actual six-engine conviction (decision, ML, advisor, peer value,
// sentiment, seasonality) and the regime-tilted asset mix, not a watered-down copy.
//
// Nothing here touches the network or your broker. It only reads the committed data bundles and
// computes a target. The bot orchestrator (run.js) is what turns this target into orders.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let booted = false;

function boot() {
  if (booted) return;

  // The app modules were written for a browser, so we stand up the few globals they expect. This
  // mirrors tools/test_command.js exactly, which is how we know this load order works.
  global.window = global;
  global.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] != null ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
  };
  global.document = {
    createElement: () => ({ innerHTML: '', style: {}, content: {} }),
    body: {}, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], addEventListener: () => {},
  };
  global.performance = { now: () => Date.now() };
  global.UI = { def: () => {}, MODULES: {}, altSignals: null };

  // Data first (altdata carries the sentiment bundle so that engine actually votes), then the core
  // libraries, then the module files that define the allocator and the conviction fusion.
  const files = [
    'data/bundle.js', 'data/altdata.js', 'data/sp500.js', 'data/market.js',
    'data/fundamentals.js', 'data/newsfeed.js',
    'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/registry.js',
    'app/modules_d.js', 'app/modules_g.js', 'app/modules_h.js',
  ];
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;   // optional bundles may be absent in a minimal checkout
    new Function(fs.readFileSync(full, 'utf-8'))();
  }
  AL.boot();
  booted = true;
}

// Push live prices into the loaded market data so everything downstream, the regime read, the
// momentum and volatility math, the six-engine conviction, and the sizing, recomputes on the current
// market instead of yesterday's close. getSeries hands back a cached, shared series object and
// AL.returns rebuilds from .values on every call, so overwriting the last bar is all it takes. We only
// accept a live price within a sane band of the last close, so a single bad quote can never corrupt a
// series, and nothing is persisted: this is a fresh process each run.
function applyLivePrices(livePrices) {
  if (!livePrices) return 0;
  let n = 0;
  for (const sym in livePrices) {
    const px = livePrices[sym];
    if (!(px > 0)) continue;
    const s = AL.getSeries(sym);
    if (!s || !s.values || !s.values.length) continue;
    const last = s.values[s.values.length - 1];
    if (!(last > 0) || px < last * 0.6 || px > last * 1.4) continue;   // reject an obviously broken quote
    s.values[s.values.length - 1] = px;   // treat the live tick as today's evolving close
    AL.live.px[sym] = px;                 // and let any livePx-based path see it too
    n++;
  }
  return n;
}

// Build the target book for a given amount of capital. Returns a flat list of intended holdings with
// their target weight (fraction of the book), plus how much the plan leaves in cash. Crypto rows are
// tagged so the orchestrator can skip them while this version stays equities-only. Pass livePrices
// (a map sym -> current price) to recompute the whole book on live data.
function getTarget(capital, profile, nStocks, livePrices, opts) {
  boot();
  const injected = applyLivePrices(livePrices);
  const t = UI.buildAllocation(capital, profile, nStocks, opts);
  t._liveInjected = injected;
  const holdings = (t.holdings || [])
    .filter(h => h.weight > 0 && h.price > 0)
    .map(h => ({
      sym: h.sym, name: h.name, cls: h.cls, bucket: h.bucket, role: h.role,
      weight: h.weight, price: h.price, call: h.call || null,
    }));
  return {
    holdings,
    cashWeight: capital > 0 ? (t.cashDollars || 0) / capital : 0,
    expVol: t.expVol != null ? t.expVol : null,
    regimeLabel: t.regimeLabel || null,
    liveInjected: injected,
  };
}

module.exports = { boot, getTarget, applyLivePrices };

// Direct run: print the target book for the configured starting balance. This is a full dry run of
// the brain with no broker and no keys, so you can see exactly what the bot intends before it ever
// places a trade. Usage: node bot/engine.js
if (require.main === module) {
  const cfg = require('./config');
  const t = getTarget(cfg.STARTING_BALANCE, cfg.RISK_PROFILE, cfg.N_STOCKS, null, { stockShare: cfg.SINGLE_STOCK_SHARE });
  const money = n => '$' + n.toFixed(2);
  console.log(`\nAlphaLab target book for ${money(cfg.STARTING_BALANCE)}  (${cfg.RISK_PROFILE}, ${cfg.N_STOCKS} stocks)`);
  if (t.regimeLabel) console.log(`regime: ${t.regimeLabel}    expected vol: ${t.expVol != null ? (t.expVol * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log('-'.repeat(74));
  let deployed = 0;
  for (const h of t.holdings) {
    const dollars = h.weight * cfg.STARTING_BALANCE;
    if (!(h.cls === 'Crypto' && !cfg.ENABLE_CRYPTO)) deployed += dollars;
    const skip = (h.cls === 'Crypto' && !cfg.ENABLE_CRYPTO) ? '  (crypto, skipped this version)' : '';
    console.log(
      `${h.sym.padEnd(8)} ${(h.weight * 100).toFixed(1).padStart(5)}%  ${money(dollars).padStart(9)}  ` +
      `${(h.call || '-').padEnd(5)} ${h.role}${skip}`
    );
  }
  console.log('-'.repeat(74));
  console.log(`deployed ${money(deployed)}   cash ${money(cfg.STARTING_BALANCE - deployed)}   (${t.holdings.length} lines)\n`);
}
