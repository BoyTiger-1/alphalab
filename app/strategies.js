/* AlphaLab strategy library: signal engines + registry of institutional strategies.
   Every runnable strategy computes daily weights from real historical data; the
   runner lags signals one day (trade at next close) and charges transaction costs. */
'use strict';
const S = window.S = {};

/* =========================================================
   SIGNAL ENGINES — each returns weights BEFORE lagging.
   Single-asset engines: (px, rets, p, aux) -> weights[]
   ========================================================= */
S.engines = {
  smaCross(px, rets, p) {
    const f = Q.sma(px, p.fast), s = Q.sma(px, p.slow);
    return px.map((_, i) => !isFinite(f[i]) || !isFinite(s[i]) ? 0 : (f[i] > s[i] ? 1 : (p.short ? -1 : 0)));
  },
  emaCross(px, rets, p) {
    const f = Q.ema(px, p.fast), s = Q.ema(px, p.slow);
    return px.map((_, i) => i < p.slow ? 0 : (f[i] > s[i] ? 1 : (p.short ? -1 : 0)));
  },
  donchian(px, rets, p) {
    const w = new Array(px.length).fill(0);
    for (let i = p.n; i < px.length; i++) {
      const win = px.slice(i - p.n, i);
      const hi = Math.max(...win), lo = Math.min(...win);
      w[i] = px[i] >= hi ? 1 : px[i] <= lo ? (p.short ? -1 : 0) : w[i - 1];
    }
    return w;
  },
  tsMom(px, rets, p) {
    const m = Q.momentum(px, p.n, p.skip || 0);
    return m.map(v => !isFinite(v) ? 0 : v > 0 ? 1 : (p.short ? -1 : 0));
  },
  high52w(px, rets, p) {
    const w = new Array(px.length).fill(0);
    for (let i = 252; i < px.length; i++) {
      const hi = Math.max(...px.slice(i - 252, i + 1));
      w[i] = px[i] >= hi * (1 - (p.tol ?? 0.02)) ? 1 : (px[i] < hi * 0.85 ? 0 : w[i - 1]);
    }
    return w;
  },
  meanRevZ(px, rets, p) {
    const z = Q.zscores(px, p.n);
    const w = new Array(px.length).fill(0);
    for (let i = 1; i < px.length; i++) {
      if (!isFinite(z[i])) continue;
      if (z[i] < -p.entry) w[i] = 1;
      else if (z[i] > p.entry) w[i] = p.short ? -1 : 0;
      else if (Math.abs(z[i]) < (p.exit ?? 0.3)) w[i] = 0;
      else w[i] = w[i - 1];
    }
    return w;
  },
  rsiRev(px, rets, p) {
    const r = Q.rsi(px, p.n);
    const w = new Array(px.length).fill(0);
    for (let i = 1; i < px.length; i++) {
      if (!isFinite(r[i])) continue;
      w[i] = r[i] < p.lo ? 1 : r[i] > p.hi ? (p.short ? -1 : 0) : (r[i] > 50 && w[i - 1] === 1 ? 0 : w[i - 1]);
    }
    return w;
  },
  bollinger(px, rets, p) {
    const m = Q.sma(px, p.n), sd = Q.rollStd(px, p.n);
    const w = new Array(px.length).fill(0);
    for (let i = 1; i < px.length; i++) {
      if (!isFinite(m[i]) || !sd[i]) continue;
      const z = (px[i] - m[i]) / sd[i];
      w[i] = z < -p.k ? 1 : z > p.k ? (p.short ? -1 : 0) : (Math.abs(z) < 0.2 ? 0 : w[i - 1]);
    }
    return w;
  },
  weeklyReversal(px, rets, p) {
    const m = Q.momentum(px, p.n || 5);
    return m.map(v => !isFinite(v) ? 0 : v < -(p.thr ?? 0.03) ? 1 : v > (p.thr ?? 0.03) && p.short ? -1 : 0);
  },
  volBreakout(px, rets, p) {
    const sd = Q.rollStd(rets, p.n || 20);
    const w = new Array(px.length).fill(0);
    for (let i = 2; i < px.length; i++) {
      const r1 = px[i] / px[i - 1] - 1;
      if (!sd[i - 2]) continue;
      if (r1 > p.k * sd[i - 2]) w[i] = 1;
      else if (r1 < -p.k * sd[i - 2]) w[i] = p.short ? -1 : 0;
      else w[i] = w[i - 1] * (p.decay ?? 0.95);
    }
    return w;
  },
  volTargetHold(px, rets, p) { // constant-vol long exposure
    const sd = Q.rollStd(rets, p.n || 20);
    return rets.map((_, i) => sd[i] ? Math.min((p.target ?? 0.10) / (sd[i] * Math.sqrt(252)), p.maxLev ?? 1.5) : 0);
  },
  regimeFiltered(px, rets, p, aux) { // long only above SMA and below VIX threshold
    const s = Q.sma(px, p.sma || 200);
    const vix = aux.vix;
    return px.map((_, i) => (isFinite(s[i]) && px[i] > s[i] && (vix ? vix[i] < (p.vixMax ?? 30) : true)) ? 1 : 0);
  },
  hmmSwitch(px, rets, p) {
    // walk-forward: refit every 63d on trailing 750d
    const w = new Array(rets.length).fill(0);
    let probs = null, fitAt = -1;
    for (let i = 750; i < rets.length; i++) {
      if (i - fitAt >= 63) { probs = Q.hmm2(rets.slice(i - 750, i), 15); fitAt = i; }
      const pc = probs.probCalm[probs.probCalm.length - 1];
      w[i] = pc > 0.65 ? 1 : pc < 0.35 ? (p.defensive ?? 0) : 0.5;
    }
    return w;
  },
  vrpHarvest(px, rets, p, aux) {
    // volatility risk premium proxy: hold risk asset scaled by (implied - realized) vol
    const rv = Q.rollStd(rets, 21).map(s => s * Math.sqrt(252) * 100);
    const vix = aux.vix;
    return rets.map((_, i) => {
      if (!vix || !isFinite(vix[i]) || !isFinite(rv[i])) return 0;
      const vrp = vix[i] - rv[i];
      return Math.max(Math.min(vrp / 10, 1.25), -0.25);
    });
  },
  vixRegime(px, rets, p, aux) { // long when VIX below its own SMA (contango proxy)
    const vix = aux.vix;
    if (!vix) return rets.map(() => 0);
    const vs = Q.sma(vix, p.n || 63);
    return rets.map((_, i) => isFinite(vs[i]) ? (vix[i] < vs[i] ? 1 : (p.short ? -0.5 : 0)) : 0);
  },
  vixSpike(px, rets, p, aux) { // buy equity after VIX spike (mean reversion of fear)
    const vix = aux.vix;
    if (!vix) return rets.map(() => 0);
    const z = Q.zscores(vix, p.n || 63);
    const w = new Array(rets.length).fill(0);
    for (let i = 1; i < rets.length; i++)
      w[i] = z[i] > (p.k ?? 2) ? 1 : (w[i - 1] > 0 && z[i] > 0 ? w[i - 1] : 0);
    return w;
  },
  macroSignal(px, rets, p, aux) {
    // aux.macro: aligned macro series values; long when macro momentum favorable
    const m = aux.macro;
    if (!m) return rets.map(() => 0);
    const mom = Q.momentum(m, p.n || 252);
    return rets.map((_, i) => {
      const v = mom[i];
      if (!isFinite(v)) return 0;
      return (p.invert ? -v : v) > (p.thr ?? 0) ? 1 : 0;
    });
  },
  thresholdSignal(px, rets, p, aux) { // long when aux level above/below threshold
    const m = aux.macro;
    if (!m) return rets.map(() => 0);
    return rets.map((_, i) => {
      if (!isFinite(m[i])) return 0;
      return (p.below ? m[i] < p.level : m[i] > p.level) ? 1 : (p.elseW ?? 0);
    });
  },
  seasonal(px, rets, p, aux) {
    const dates = aux.dates;
    return dates.map(d => {
      const dt = new Date(d + 'T12:00:00Z');
      const m = dt.getUTCMonth() + 1, day = dt.getUTCDate();
      if (p.type === 'sellInMay') return (m >= 11 || m <= 4) ? 1 : 0;
      if (p.type === 'turnOfMonth') {
        const eom = new Date(Date.UTC(dt.getUTCFullYear(), m, 0)).getUTCDate();
        return (day >= eom - 3 || day <= 2) ? 1 : 0;
      }
      if (p.type === 'santa') return (m === 12 && day >= 15) || (m === 1 && day <= 5) ? 1 : 0;
      if (p.type === 'months') return p.months.includes(m) ? 1 : 0;
      return 0;
    });
  },
  pairsZ(pxA, pxB, p) { // returns {wA, wB}: trade log-spread z-score with rolling hedge
    const n = pxA.length;
    const wA = new Array(n).fill(0), wB = new Array(n).fill(0);
    const la = pxA.map(Math.log), lb = pxB.map(Math.log);
    const win = p.win || 126;
    let beta = 1, fitAt = -1;
    const spread = new Array(n).fill(NaN);
    for (let i = win; i < n; i++) {
      if (i - fitAt >= 21) {
        const r = Q.linreg(lb.slice(i - win, i), la.slice(i - win, i));
        beta = r.b; fitAt = i;
      }
      spread[i] = la[i] - beta * lb[i];
    }
    const z = Q.zscores(spread.map(v => isFinite(v) ? v : 0), win);
    for (let i = win * 2; i < n; i++) {
      if (!isFinite(z[i])) continue;
      if (z[i] > p.entry) { wA[i] = -0.5; wB[i] = 0.5; }
      else if (z[i] < -p.entry) { wA[i] = 0.5; wB[i] = -0.5; }
      else if (Math.abs(z[i]) < (p.exit ?? 0.5)) { wA[i] = 0; wB[i] = 0; }
      else { wA[i] = wA[i - 1]; wB[i] = wB[i - 1]; }
    }
    return { wA, wB };
  },
  ratioRV(pxA, pxB, p) { // relative value on ratio z-score
    const n = pxA.length;
    const ratio = pxA.map((v, i) => v / pxB[i]);
    const z = Q.zscores(ratio, p.n || 126);
    const wA = new Array(n).fill(0), wB = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      if (!isFinite(z[i])) continue;
      if (p.momentum) { // ratio momentum instead of reversion
        const m = Q.momentum(ratio, p.n || 126)[i];
        if (isFinite(m)) { wA[i] = m > 0 ? 0.5 : -0.5; wB[i] = -wA[i]; }
      } else if (z[i] > (p.entry ?? 1.5)) { wA[i] = -0.5; wB[i] = 0.5; }
      else if (z[i] < -(p.entry ?? 1.5)) { wA[i] = 0.5; wB[i] = -0.5; }
      else if (Math.abs(z[i]) < 0.4) { wA[i] = 0; wB[i] = 0; }
      else { wA[i] = wA[i - 1]; wB[i] = wB[i - 1]; }
    }
    return { wA, wB };
  },
};

/* Cross-sectional engines: operate on aligned universe, monthly rebalance.
   Return {weights:{sym:[]}, dates} */
S.xs = {
  momentum(al, p) {
    return xsGeneric(al, p, (cols, i, syms) => {
      const scores = syms.map(s => {
        const px = cols[s];
        const a = i - (p.skip ?? 21), b = i - p.n;
        return b >= 0 && px[b] ? px[a] / px[b] - 1 : NaN;
      });
      return scores;
    }, p.topN, p.shortBottom);
  },
  reversal(al, p) {
    return xsGeneric(al, p, (cols, i, syms) => syms.map(s => {
      const px = cols[s]; const b = i - (p.n ?? 21);
      return b >= 0 && px[b] ? -(px[i] / px[b] - 1) : NaN;
    }), p.topN, p.shortBottom);
  },
  lowVol(al, p) {
    return xsGeneric(al, p, (cols, i, syms) => syms.map(s => {
      const px = cols[s]; const b = i - (p.n ?? 63);
      if (b < 1) return NaN;
      const rr = [];
      for (let k = b + 1; k <= i; k++) rr.push(px[k] / px[k - 1] - 1);
      return -Q.std(rr);
    }), p.topN, p.shortBottom);
  },
  trendPortfolio(al, p) { // equal-weight all assets in uptrend, vol-weighted
    const { dates, cols, syms } = al;
    const n = dates.length;
    const weights = {};
    const smas = {}, vols = {};
    for (const s of syms) {
      smas[s] = Q.sma(cols[s], p.sma || 126);
      const rr = cols[s].map((v, i) => i ? v / cols[s][i - 1] - 1 : 0);
      vols[s] = Q.rollStd(rr, 63);
      weights[s] = new Array(n).fill(0);
    }
    for (let i = 0; i < n; i++) {
      if (i % (p.reb || 21) !== 0 && i) { for (const s of syms) weights[s][i] = weights[s][i - 1]; continue; }
      const on = syms.filter(s => isFinite(smas[s][i]) && cols[s][i] > smas[s][i] && vols[s][i]);
      const iv = on.map(s => 1 / vols[s][i]);
      const tot = Q.sum(iv);
      syms.forEach(s => weights[s][i] = 0);
      on.forEach((s, k) => weights[s][i] = tot ? iv[k] / tot : 0);
    }
    return { weights, dates };
  },
  riskParity(al, p) {
    const { dates, cols, syms } = al;
    const n = dates.length;
    const weights = {};
    for (const s of syms) weights[s] = new Array(n).fill(0);
    const retCols = {};
    for (const s of syms) retCols[s] = cols[s].map((v, i) => i ? v / cols[s][i - 1] - 1 : 0);
    for (let i = 260; i < n; i++) {
      if ((i - 260) % (p.reb || 21) !== 0) { for (const s of syms) weights[s][i] = weights[s][i - 1]; continue; }
      const look = {};
      for (const s of syms) look[s] = retCols[s].slice(i - 252, i);
      let w;
      if (p.method === 'hrp') {
        const Cm = Q.covMatrix(look, syms), R = Q.corrMatrix(look, syms);
        w = Q.hrp(Cm, R);
      } else if (p.method === 'minvar') {
        w = Q.minVar(Q.covMatrix(look, syms));
      } else {
        w = Q.erc(Q.covMatrix(look, syms));
      }
      syms.forEach((s, k) => weights[s][i] = w[k] * (p.lev ?? 1));
    }
    return { weights, dates };
  },
  fixedMix(al, p) { // e.g. 60/40, permanent portfolio; monthly rebalanced
    const { dates, syms } = al;
    const n = dates.length;
    const weights = {};
    syms.forEach((s, k) => weights[s] = new Array(n).fill(p.mix[k] ?? 0));
    return { weights, dates };
  },
  dualMomentum(al, p) { // GEM: risk asset vs alt vs cash by 12m momentum
    const { dates, cols, syms } = al;   // [risk, alt, safe]
    const n = dates.length;
    const weights = {};
    for (const s of syms) weights[s] = new Array(n).fill(0);
    for (let i = 260; i < n; i++) {
      if ((i - 260) % 21 !== 0) { for (const s of syms) weights[s][i] = weights[s][i - 1]; continue; }
      const mom = syms.map(s => cols[s][i] / cols[s][i - 252] - 1);
      if (mom[0] > 0 || mom[1] > 0) {
        const best = mom[0] >= mom[1] ? 0 : 1;
        syms.forEach((s, k) => weights[s][i] = k === best ? 1 : 0);
      } else {
        syms.forEach((s, k) => weights[s][i] = k === 2 ? 1 : 0);
      }
    }
    return { weights, dates };
  },
};
function xsGeneric(al, p, scoreFn, topN, shortBottom) {
  const { dates, cols, syms } = al;
  const n = dates.length;
  const weights = {};
  for (const s of syms) weights[s] = new Array(n).fill(0);
  const start = (p.n ?? 126) + (p.skip ?? 0) + 2;
  for (let i = start; i < n; i++) {
    if ((i - start) % (p.reb || 21) !== 0) { for (const s of syms) weights[s][i] = weights[s][i - 1]; continue; }
    const scores = scoreFn(cols, i, syms);
    const ranked = syms.map((s, k) => ({ s, sc: scores[k] })).filter(x => isFinite(x.sc)).sort((a, b) => b.sc - a.sc);
    if (ranked.length < topN + 1) continue;
    syms.forEach(s => weights[s][i] = 0);
    ranked.slice(0, topN).forEach(x => weights[x.s][i] = 1 / topN);
    if (shortBottom) ranked.slice(-topN).forEach(x => weights[x.s][i] = -1 / topN);
  }
  return { weights, dates };
}

/* =========================================================
   STRATEGY RUNNER
   ========================================================= */
S.aux = function (dates) { // aligned auxiliary data (VIX, macro) for a date axis
  const vix = AL.getSeries('^VIX');
  const map = new Map(vix.dates.map((d, i) => [d, vix.values[i]]));
  let last = null;
  return { dates, vix: dates.map(d => { if (map.has(d)) last = map.get(d); return last; }) };
};
S.alignMacro = function (dates, fredId) {
  const m = AL.getSeries(fredId);
  if (!m) return null;
  const map = new Map(m.dates.map((d, i) => [d, m.values[i]]));
  let last = null;
  const sorted = m.dates;
  let j = 0;
  return dates.map(d => {
    while (j < sorted.length && sorted[j] <= d) { last = m.values[j]; j++; }
    return last;
  });
};

S.run = function (entry, opts = {}) {
  const costBps = opts.costBps ?? entry.cost ?? 5;
  const from = opts.from || entry.from || '2005-01-01';
  const def = entry.def;
  let dates, portRets, exposure = null, extra = {};
  if (def.kind === 'single') {
    const s = AL.getSeries(def.sym);
    const w = AL.window(s, from);
    const px = w.values, dts = w.dates;
    const rets = px.map((v, i) => i ? v / px[i - 1] - 1 : 0);
    const aux = S.aux(dts);
    if (def.macro) aux.macro = S.alignMacro(dts, def.macro);
    const params = { ...def.params, ...(opts.params || {}) };
    let sig = S.engines[def.engine](px, rets, params, aux);
    if (def.volTarget) {
      const sd = Q.rollStd(rets, 20);
      sig = sig.map((x, i) => sd[i] ? x * Math.min(def.volTarget / (sd[i] * Math.sqrt(252)), 2) : 0);
    }
    const lagged = Q.lag(sig, 1);
    const bt = Q.backtest(lagged, rets, { costBps });
    dates = dts; portRets = bt.rets; exposure = lagged;
    extra.turnover = bt.turnover; extra.avgExposure = bt.avgExposure;
  } else if (def.kind === 'pair') {
    const al = AL.align(def.syms, 'px');
    const w = windowAligned(al, from);
    const params = { ...def.params, ...(opts.params || {}) };
    const { wA, wB } = S.engines[def.engine](w.cols[def.syms[0]], w.cols[def.syms[1]], params);
    const retCols = {};
    for (const s of def.syms) retCols[s] = w.cols[s].map((v, i) => i ? v / w.cols[s][i - 1] - 1 : 0);
    const bt = Q.backtestMulti({ [def.syms[0]]: Q.lag(wA), [def.syms[1]]: Q.lag(wB) }, retCols, { costBps });
    dates = w.dates; portRets = bt.rets;
    exposure = wA.map((a, i) => Math.abs(a) + Math.abs(wB[i]));
    extra.turnover = bt.turnover;
    // cointegration diagnostics on the pair
    extra.coint = Q.coint(w.cols[def.syms[1]].map(Math.log), w.cols[def.syms[0]].map(Math.log));
  } else if (def.kind === 'xs') {
    const al = AL.align(def.universe, 'px');
    const w = windowAligned(al, from);
    const params = { ...def.params, ...(opts.params || {}) };
    const res = S.xs[def.engine]({ dates: w.dates, cols: w.cols, syms: def.universe.filter(s => w.cols[s]) }, params);
    const retCols = {}, lagW = {};
    for (const s of Object.keys(res.weights)) {
      retCols[s] = w.cols[s].map((v, i) => i ? v / w.cols[s][i - 1] - 1 : 0);
      lagW[s] = Q.lag(res.weights[s], 1);
    }
    const bt = Q.backtestMulti(lagW, retCols, { costBps });
    dates = w.dates; portRets = bt.rets;
    exposure = dates.map((_, i) => Q.sum(Object.values(lagW).map(a => Math.abs(a[i] || 0))));
    extra.turnover = bt.turnover;
    extra.lastWeights = Object.fromEntries(Object.entries(res.weights).map(([s, a]) => [s, a[a.length - 1]]));
  } else if (def.kind === 'ml') {
    return ML.runStrategy(entry, opts);
  }
  // benchmark aligned
  const benchSym = entry.bench || 'SPY';
  const b = AL.getSeries(benchSym);
  const bmap = new Map(b.dates.map((d, i) => [d, b.values[i]]));
  const bpx = []; let lastB = null;
  for (const d of dates) { if (bmap.has(d)) lastB = bmap.get(d); bpx.push(lastB); }
  const bench = bpx.map((v, i) => i && bpx[i - 1] ? v / bpx[i - 1] - 1 : 0);
  // trim warmup: start where exposure first non-zero
  let start = exposure ? exposure.findIndex(x => Math.abs(x) > 1e-9) : 0;
  if (start < 0) start = 0;
  start = Math.max(start - 1, 0);
  const rets = portRets.slice(start), bch = bench.slice(start), dts = dates.slice(start);
  const stats = Q.perf(rets, { bench: bch });
  const bstats = Q.perf(bch);
  return {
    entry, dates: dts, rets, bench: bch, benchSym, stats, bstats,
    equity: Q.equity(rets), benchEquity: Q.equity(bch),
    exposure: exposure ? exposure.slice(start) : null, ...extra, costBps, from,
  };
};
function windowAligned(al, from) {
  const a = al.dates.findIndex(d => d >= from);
  const i0 = a < 0 ? 0 : a;
  const cols = {};
  for (const s of Object.keys(al.cols)) cols[s] = al.cols[s].slice(i0);
  return { dates: al.dates.slice(i0), cols };
}

/* Walk-forward validation: split into IS/OOS, plus param-perturbation robustness */
S.validate = function (entry, opts = {}) {
  const full = S.run(entry, opts);
  if (!full || !full.stats) return null;
  const n = full.rets.length;
  const cut = Math.floor(n * 0.7);
  const is = Q.perf(full.rets.slice(0, cut), { bench: full.bench.slice(0, cut) });
  const oos = Q.perf(full.rets.slice(cut), { bench: full.bench.slice(cut) });
  // cost stress
  const cost2 = S.run(entry, { ...opts, costBps: (opts.costBps ?? entry.cost ?? 5) * 3 });
  // parameter perturbation: jiggle each numeric param ±20%
  const perturbed = [];
  const params = entry.def.params || {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'number' || v <= 2) continue;
    for (const m of [0.8, 1.2]) {
      const pp = { ...params, [k]: Math.max(2, Math.round(v * m)) };
      try {
        const r = S.run(entry, { ...opts, params: pp });
        if (r && r.stats) perturbed.push({ param: k, mult: m, sharpe: r.stats.sharpe });
      } catch (e) { /* param combo invalid */ }
    }
  }
  const psr = Q.psr(full.rets);
  const shMed = perturbed.length ? Q.quantile(perturbed.map(p => p.sharpe), 0.5) : full.stats.sharpe;
  // sub-period consistency: sharpe by year
  const byYear = new Map();
  full.dates.forEach((d, i) => {
    const y = d.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(full.rets[i]);
  });
  const yearSharpes = [...byYear.entries()].filter(([, r]) => r.length > 60)
    .map(([y, r]) => ({ year: y, sharpe: Q.std(r) ? Q.mean(r) / Q.std(r) * Math.sqrt(252) : 0 }));
  const posYears = yearSharpes.filter(y => y.sharpe > 0).length / Math.max(yearSharpes.length, 1);
  const verdict =
    (oos && oos.sharpe > 0.3 && full.stats.sharpe > 0.5 && psr > 0.85 && cost2.stats && cost2.stats.sharpe > 0 && shMed > 0.3 * full.stats.sharpe)
      ? 'VALIDATED'
      : (oos && oos.sharpe > 0 && full.stats.sharpe > 0.3) ? 'MARGINAL' : 'REJECTED';
  return { full, is, oos, cost2: cost2.stats, perturbed, psr, yearSharpes, posYears, verdict };
};
