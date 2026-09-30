/* AlphaLab quant brain: the evidence layer behind the Competition Center and the Stock Advisor.

   Every engine that votes on a stock, and every rule that sizes the plan, has to show its work here:
   - a point-in-time factor backtest decides how much each price factor counts (earn-your-vote),
   - the ML forecast only votes for a name where its own walk-forward record is significant,
   - the strategy library only times a fund sleeve with strategies its validator rated VALIDATED,
   - stocks are chosen with a correlation limit and sized with HRP / Black-Litterman on real covariance,
   - the finished plan is checked against the risk level's budget (volatility and crisis replays).
   Engines with no point-in-time history (fundamentals, sentiment, peer valuation) cannot be
   backtested honestly, so they keep fixed judgment weights and are labeled that way in the UI.
   Only the website's profile-driven path uses this file; the trading bot keeps its own recipe. */
'use strict';
(function () {
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const tOf = a => { const f = a.filter(isFinite); return f.length > 2 && Q.std(f) ? Q.mean(f) / Q.std(f) * Math.sqrt(f.length) : 0; };
// full weight at the usual t = 2 significance bar, scaled down linearly, nothing below t = 0.5
const evidenceMult = t => (isFinite(t) && t > 0.5 ? Math.min(1.5, t / 2) : 0);
UI.evidenceMult = evidenceMult;

// the price factors inside the advisor score: rebuildable at any past date from prices alone
UI.PRICE_FACTORS = ['z_mom', 'z_trend', 'z_sharpe', 'z_vol', 'z_consistency', 'z_secRel'];
UI.FACTOR_LABEL = { z_mom: '6-month momentum', z_trend: 'trend vs 40-week average', z_sharpe: '1-year Sharpe',
  z_vol: 'low volatility', z_consistency: 'share of positive months', z_secRel: 'momentum vs own sector' };

/* ---------- weekly returns on the shared S&P grid (any symbol, cached) ---------- */
// AL.weeklyValues samples every series at the week's last close (the bundles' convention), so all
// symbols line up on the same grid; cached here because correlations and betas reuse it heavily.
UI._wkv = UI._wkv || {};
UI.weeklyAligned = function (sym) {
  if (sym in UI._wkv) return UI._wkv[sym];
  let out = null;
  try { out = AL.weeklyValues(sym); } catch (e) { }
  return (UI._wkv[sym] = out);
};
UI._wk = UI._wk || {};
UI.weeklyRets = function (sym) {
  if (sym in UI._wk) return UI._wk[sym];
  let out = null;
  try {
    const v = UI.weeklyAligned(sym);
    if (v) out = v.map((x, i) => i && x != null && v[i - 1] != null && v[i - 1] > 0 ? x / v[i - 1] - 1 : null);
  } catch (e) { }
  return (UI._wk[sym] = out);
};
// correlation of two names on their common weeks within the last n (null when too little overlap)
UI.pairCorr = function (a, b, n = 104) {
  const ra = UI.weeklyRets(a), rb = UI.weeklyRets(b);
  if (!ra || !rb) return null;
  const xs = [], ys = [];
  for (let i = Math.max(1, ra.length - n); i < ra.length; i++) if (ra[i] != null && rb[i] != null) { xs.push(ra[i]); ys.push(rb[i]); }
  return xs.length >= 40 ? Q.corr(xs, ys) : null;
};

// beta to the S&P 500 on weekly returns over the last two years (at least 40 common weeks): a
// steadier read than the Stock Advisor's one-year beta, used for risk limits and crisis proxies.
UI._abeta = UI._abeta || {};
UI.alignedBeta = function (sym, n = 104) {
  if (sym in UI._abeta) return UI._abeta[sym];
  let out = null;
  const ra = UI.weeklyRets(sym), rm = UI.weeklyRets('SPY');
  if (ra && rm) {
    const xs = [], ys = [];
    for (let i = Math.max(1, ra.length - n); i < ra.length; i++) if (ra[i] != null && rm[i] != null) { xs.push(rm[i]); ys.push(ra[i]); }
    if (xs.length >= 40) {
      const mx = Q.mean(xs), my = Q.mean(ys);
      let c = 0, v = 0;
      xs.forEach((x, i) => { c += (x - mx) * (ys[i] - my); v += (x - mx) * (x - mx); });
      if (v > 0) out = c / v;
    }
  }
  return (UI._abeta[sym] = out);
};

/* ---------- 1. point-in-time factor backtest ----------
   S&P 500 weekly bars. Every 4 weeks, each price factor is rebuilt from data up to that week only,
   exactly as the Stock Advisor computes it today, and ranked against the next 4 weeks' return
   (Spearman IC). Periods do not overlap, so the t-stat is honest. The calibrated weights are then
   tested out of sample: at each date they use only ICs that had already resolved. */
UI.factorBacktest = function () {
  if (UI._fbt !== undefined) return UI._fbt;
  UI._fbt = null;
  const sp = AL.sp500();
  if (!sp) return null;
  const sc = UI.scoreStocks();
  const prior = {};
  UI.PRICE_FACTORS.forEach(k => prior[k] = sc.weights[k] || 0);
  const nW = sp.wcal.length, H = 4, STEP = 4, WARM = 80;
  const syms = Object.keys(sp.cols);
  const px = syms.map(s => UI.weeklyAligned(s));
  const sec = syms.map(s => UI.canonSector(sp.cols[s].sec) || sp.cols[s].sec || 'Unknown');
  const zs = (vals, invert) => {
    const f = vals.filter(isFinite), m = Q.mean(f), sd = Q.std(f) || 1;
    return vals.map(v => isFinite(v) ? (invert ? -1 : 1) * clamp((v - m) / sd, -3, 3) : 0);
  };
  const ics = {}; UI.PRICE_FACTORS.forEach(k => ics[k] = []);
  const hist = [];   // per date: { t, z: {k: []}, fwd: [] } kept for the out-of-sample composite test
  let names = 0;
  for (let t = WARM; t + H < nW; t += STEP) {
    const F = { mom: [], trend: [], sharpe: [], vol: [], consistency: [] }, fwd = [], secs = [];
    for (let i = 0; i < syms.length; i++) {
      const p = px[i];
      if (!p || p[t - WARM + 1] == null || p[t] == null || p[t + H] == null || p[t] < 2) continue;
      const r = [];
      for (let k = Math.max(1, t - 155); k <= t; k++) if (p[k] != null && p[k - 1] != null) r.push(p[k] / p[k - 1] - 1);
      const r26 = r.slice(-26), r52 = r.slice(-52);
      const vol = Q.std(r26) * Math.sqrt(52);
      if (!isFinite(vol) || vol > 1.5 || p[t - 28] == null || p[t - 2] == null) continue;
      let pos = 0, tot = 0;
      for (let m = 0; m + 4 <= r.length; m += 4) { tot++; if (Q.sum(r.slice(m, m + 4)) > 0) pos++; }
      F.mom.push(p[t - 2] / p[t - 28] - 1);
      F.trend.push(p[t] / Q.mean(p.slice(t - 39, t + 1).filter(x => x != null)) - 1);
      F.sharpe.push(Q.std(r52) ? (Q.mean(r52) * 52 - 0.02) / (Q.std(r52) * Math.sqrt(52)) : 0);
      F.vol.push(vol);
      F.consistency.push(tot ? pos / tot : 0.5);
      fwd.push(p[t + H] / p[t] - 1);
      secs.push(sec[i]);
    }
    if (fwd.length < 50) continue;
    const bySec = {};
    F.mom.forEach((m, j) => (bySec[secs[j]] = bySec[secs[j]] || []).push(m));
    const secRel = F.mom.map((m, j) => m - Q.mean(bySec[secs[j]]));
    const z = { z_mom: zs(F.mom), z_trend: zs(F.trend), z_sharpe: zs(F.sharpe), z_vol: zs(F.vol, true),
      z_consistency: zs(F.consistency), z_secRel: zs(secRel) };
    UI.PRICE_FACTORS.forEach(k => ics[k].push(Q.spearman(z[k], fwd)));
    hist.push({ t, z, fwd });
    names += fwd.length;
  }
  if (hist.length < 24) return null;
  const calib = icMap => {
    const w = {}, stat = {};
    let raw = 0;
    UI.PRICE_FACTORS.forEach(k => { stat[k] = tOf(icMap[k]); w[k] = prior[k] * evidenceMult(stat[k]); raw += w[k]; });
    const priorSum = Q.sum(Object.values(prior));
    UI.PRICE_FACTORS.forEach(k => w[k] = raw > 0 ? w[k] * priorSum / raw : 0);
    return { w, stat };
  };
  // composite ICs: today's prior weights, equal weights, and walk-forward calibrated weights
  const comp = (h, w) => h.fwd.map((_, j) => UI.PRICE_FACTORS.reduce((s, k) => s + (w[k] || 0) * h.z[k][j], 0));
  const eqw = {}; UI.PRICE_FACTORS.forEach(k => eqw[k] = 1);
  const icPrior = [], icEq = [], icCal = [], spread = [];
  hist.forEach((h, d) => {
    icPrior.push(Q.spearman(comp(h, prior), h.fwd));
    icEq.push(Q.spearman(comp(h, eqw), h.fwd));
    if (d < 12) return;
    // only dates whose 4-week forward window closed before this one may inform the weights
    const past = {}; UI.PRICE_FACTORS.forEach(k => past[k] = ics[k].slice(0, d));
    const cw = calib(past).w;
    if (!Q.sum(Object.values(cw))) { icCal.push(0); spread.push(0); return; }
    const c = comp(h, cw);
    icCal.push(Q.spearman(c, h.fwd));
    // top-minus-bottom quintile return for that 4-week period
    const ord = c.map((v, j) => [v, h.fwd[j]]).sort((a, b) => a[0] - b[0]), q = Math.floor(ord.length / 5);
    spread.push(Q.mean(ord.slice(-q).map(x => x[1])) - Q.mean(ord.slice(0, q).map(x => x[1])));
  });
  const now = calib(ics);
  const out = {
    from: sp.wcal[hist[0].t], to: sp.wcal[hist[hist.length - 1].t], periods: hist.length, horizonWeeks: H,
    avgNames: Math.round(names / hist.length), prior, weights: now.w,
    factors: UI.PRICE_FACTORS.map(k => ({ key: k, label: UI.FACTOR_LABEL[k], prior: prior[k], weight: now.w[k],
      ic: Q.mean(ics[k].filter(isFinite)), t: now.stat[k], hit: ics[k].filter(x => x > 0).length / ics[k].length })),
    composite: {
      prior: { ic: Q.mean(icPrior.filter(isFinite)), t: tOf(icPrior) },
      equal: { ic: Q.mean(icEq.filter(isFinite)), t: tOf(icEq) },
      calibrated: { ic: Q.mean(icCal.filter(isFinite)), t: tOf(icCal), n: icCal.length,
        spreadAnn: Q.mean(spread) * (52 / H), spreadT: tOf(spread) },
    },
    caveats: [
      'Universe is today\'s S&P 500 members, so companies that were dropped or went bust are missing (survivorship bias). That flatters every factor a little, momentum most.',
      'One sample of about ten years, mostly a bull market. A factor that failed here is switched off, never flipped to the opposite bet.',
      'Fundamentals, sentiment and peer valuation are snapshots with no history, so they cannot be backtested and keep fixed judgment weights.',
    ],
  };
  out.compositeMult = evidenceMult(out.composite.calibrated.t);
  return (UI._fbt = out);
};

// advisor score with the price-factor weights replaced by the backtest-calibrated ones
UI.calScore = function (r) {
  if (!r) return 0;
  let bt = null;
  try { bt = UI.factorBacktest(); } catch (e) { }
  if (!bt) return r.score || 0;
  let s = r.score || 0;
  for (const k of UI.PRICE_FACTORS) s += ((bt.weights[k] || 0) - (bt.prior[k] || 0)) * (r[k] || 0);
  return s;
};

/* ---------- 1b. short-horizon signals (the Short-term risk level) ----------
   What predicts the next two weeks is not what predicts the next six months. Five price signals
   with a published short-horizon story are rebuilt point in time on the S&P 500 weekly grid and
   ranked against the next 2 weeks' return, on non-overlapping periods. Each one's weight comes only
   from ICs that had already resolved (walk-forward), a signal with no edge gets weight 0 (never
   flipped), and the composite is judged out of sample, net of trading costs on the names it swaps
   every two weeks. Survivorship bias applies as in the main backtest. */
UI.SHORT_H = 2;
UI.SHORT_FACTORS = ['rev1', 'rev4', 'mom12', 'high52', 'beta'];
UI.SHORT_LABEL = { rev1: 'last week\'s losers bounce (1-week reversal)', rev4: 'last month\'s losers bounce (4-week reversal)',
  mom12: '12-week momentum', high52: 'close to its 52-week high', beta: 'high market beta' };
UI.SHORT_COST = 0.001;   // 10 bps each way per name swapped (spread plus slippage on large caps)
// raw short-horizon signals from weekly closes p (index t = the latest close) and the S&P 500's
function shortRaw(p, spy, t) {
  if (t < 52 || p[t] == null || p[t - 1] == null || p[t - 4] == null || p[t - 12] == null || p[t] < 2) return null;
  const r = [], m = [];
  for (let k = t - 51; k <= t; k++) if (p[k] != null && p[k - 1] != null && spy[k] != null && spy[k - 1] != null) { r.push(p[k] / p[k - 1] - 1); m.push(spy[k] / spy[k - 1] - 1); }
  if (r.length < 40) return null;
  const vol = Q.std(r.slice(-26)) * Math.sqrt(52);
  if (!(vol > 0) || vol > 1.5) return null;
  let hi = 0; for (let k = t - 51; k <= t; k++) if (p[k] != null && p[k] > hi) hi = p[k];
  return { rev1: -(p[t] / p[t - 1] - 1), rev4: -(p[t] / p[t - 4] - 1), mom12: p[t - 1] / p[t - 12] - 1,
    high52: p[t] / hi - 1, beta: Q.linreg(m, r).b, vol, wk1: p[t] / p[t - 1] - 1, wk4: p[t] / p[t - 4] - 1 };
}
const zsOf = vals => {
  const f = vals.filter(isFinite), m = Q.mean(f), sd = Q.std(f) || 1;
  return vals.map(v => isFinite(v) ? clamp((v - m) / sd, -3, 3) : 0);
};
UI.shortBacktest = function () {
  if (UI._sbt !== undefined) return UI._sbt;
  UI._sbt = null;
  const sp = AL.sp500(), spy = UI.weeklyAligned('SPY');
  if (!sp || !spy) return null;
  const H = UI.SHORT_H, K = UI.SHORT_FACTORS, nW = sp.wcal.length;
  const syms = Object.keys(sp.cols), px = syms.map(s => UI.weeklyAligned(s));
  const ics = {}; K.forEach(k => ics[k] = []);
  const hist = [];
  for (let t = 60; t + H < nW; t += H) {
    const raw = [], fwd = [], who = [];
    for (let i = 0; i < syms.length; i++) {
      const p = px[i];
      if (!p || p[t + H] == null) continue;
      const x = shortRaw(p, spy, t);
      if (!x) continue;
      raw.push(x); fwd.push(p[t + H] / p[t] - 1); who.push(i);
    }
    if (fwd.length < 50) continue;
    const z = {}; K.forEach(k => { z[k] = zsOf(raw.map(x => x[k])); ics[k].push(Q.spearman(z[k], fwd)); });
    hist.push({ t, z, fwd, who });
  }
  if (hist.length < 60) return null;
  const calib = icMap => { const w = {}, stat = {}; K.forEach(k => { stat[k] = tOf(icMap[k]); w[k] = evidenceMult(stat[k]); }); return { w, stat }; };
  const icCal = [], spread = [], excess = [], net = [];
  let prevTop = null, turnSum = 0, turnN = 0;
  hist.forEach((h, d) => {
    if (d < 26) return;                       // a year of resolved ICs before the first calibrated call
    const past = {}; K.forEach(k => past[k] = ics[k].slice(0, d));
    const cw = calib(past).w, ws = Q.sum(Object.values(cw));
    if (!ws) { icCal.push(0); spread.push(0); excess.push(0); net.push(0); prevTop = null; return; }
    const c = h.fwd.map((_, j) => K.reduce((s, k) => s + cw[k] * h.z[k][j], 0) / ws);
    icCal.push(Q.spearman(c, h.fwd));
    const ord = c.map((v, j) => [v, h.fwd[j], h.who[j]]).sort((a, b) => a[0] - b[0]), q = Math.floor(ord.length / 5);
    const top = ord.slice(-q), avg = Q.mean(h.fwd);
    spread.push(Q.mean(top.map(x => x[1])) - Q.mean(ord.slice(0, q).map(x => x[1])));
    const ex = Q.mean(top.map(x => x[1])) - avg;
    // long-only top quintile vs the average stock, after paying to swap the names that changed
    const topSet = new Set(top.map(x => x[2]));
    const turn = prevTop ? top.filter(x => !prevTop.has(x[2])).length / top.length : 1;
    if (prevTop) { turnSum += turn; turnN++; }
    excess.push(ex); net.push(ex - turn * 2 * UI.SHORT_COST);
    prevTop = topSet;
  });
  const now = calib(ics), per = 52 / H;
  const out = {
    horizonWeeks: H, from: sp.wcal[hist[0].t], to: sp.wcal[hist[hist.length - 1].t], periods: hist.length,
    weights: now.w,
    factors: K.map(k => ({ key: k, label: UI.SHORT_LABEL[k], ic: Q.mean(ics[k].filter(isFinite)), t: now.stat[k], weight: now.w[k],
      hit: ics[k].filter(x => x > 0).length / ics[k].length })),
    composite: { ic: Q.mean(icCal.filter(isFinite)), t: tOf(icCal), n: icCal.length,
      spreadAnn: Q.mean(spread) * per, spreadT: tOf(spread),
      excessAnn: Q.mean(excess) * per, netAnn: Q.mean(net) * per, netT: tOf(net), turnover: turnN ? turnSum / turnN : null,
      hitNet: net.filter(x => x > 0).length / (net.length || 1) },
    caveats: [
      'Today\'s S&P 500 members only (survivorship bias): losers that later went bust are missing, which flatters "buy last week\'s losers" the most.',
      'A two-week hold swaps many names every rebalance; the net figure charges 10 bps each way per swap, and real slippage on a busy day can be worse.',
      'Short-horizon edges are small and noisy: most two-week periods are decided by the market, not by the signal.',
    ],
  };
  // the vote needs an out-of-sample composite that is significant AND still positive after costs
  out.compositeMult = out.composite.netAnn > 0 ? evidenceMult(out.composite.t) : 0;
  return (UI._sbt = out);
};
// today's short-horizon score for every stock the Advisor scored: the calibrated composite, z-scaled
UI.shortScores = function () {
  const sc = UI.scoreStocks();
  if (UI._sss && UI._sss.of === sc) return UI._sss;
  const bt = UI.shortBacktest(), spy = UI.weeklyAligned('SPY'), sp = AL.sp500();
  const out = { of: sc, bySym: {}, bt };
  if (!bt || !spy || !sp) return (UI._sss = out);
  const rows = [], raws = [];
  for (const r of sc.rows) {
    const p = UI.weeklyAligned(r.sym);
    if (!p) continue;
    let t = p.length - 1;
    while (t > 0 && p[t] == null) t--;
    if (t < sp.wcal.length - 3) continue;       // stale series cannot speak for the next two weeks
    const x = shortRaw(p, spy, t);
    if (x) { rows.push(r.sym); raws.push(x); }
  }
  const K = UI.SHORT_FACTORS, ws = Q.sum(K.map(k => bt.weights[k])) || 0;
  const z = {}; K.forEach(k => z[k] = zsOf(raws.map(x => x[k])));
  rows.forEach((sym, j) => {
    const score = ws ? K.reduce((s, k) => s + bt.weights[k] * z[k][j], 0) / ws : 0;
    out.bySym[sym] = { score, raw: raws[j], z: Object.fromEntries(K.map(k => [k, z[k][j]])) };
  });
  return (UI._sss = out);
};

/* ---------- 2. ML forecast evidence, per name and per model ----------
   Every model in the ML lab (linear, trees, kernels, nets, the RL agent and the deep sequence
   models) is run walk-forward on each name: train only on the past with purging, predict the next
   bar, refit on a schedule. Each is scored on non-overlapping forecast windows so the t-stat is not
   inflated. Testing many models on one name raises the odds that one looks good by luck, so the
   bar a model must clear rises with the number tested (Bonferroni on the one-model t >= 1 bar):
   with 15 models a model needs t of about 2.2 to vote. The deep models are too heavy for the
   browser, so the full zoo is prebuilt in CI (data/evidence.js); on demand only ridge runs. */
UI.ML_ZOO = [
  { id: 'ridge', p: { lambda: 3, refit: 126 } },
  { id: 'logistic' }, { id: 'elasticnet' }, { id: 'svm' }, { id: 'nb' }, { id: 'knn' },
  { id: 'rf' }, { id: 'extratrees' }, { id: 'gbdt' }, { id: 'mlp' }, { id: 'dqn' },
  { id: 'lstm', seq: true }, { id: 'gru', seq: true }, { id: 'alstm', seq: true }, { id: 'transformer', seq: true },
];
const SEQ_P = { trainCap: 1500, epochs: 6, warmEpochs: 2 };
// the t a model must clear when k models were tested on the same name (one-sided, family-wise
// false-vote rate held at the single-model t >= 1 level, about 16%)
UI.mlTStar = function (k) {
  if (!(k > 1)) return 1;
  const target = 1 - (1 - Q.normCdf(1)) / k;
  let lo = 1, hi = 6;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (Q.normCdf(mid) < target) lo = mid; else hi = mid; }
  return +((lo + hi) / 2).toFixed(3);
};
UI._mlEv = UI._mlEv || {};
UI.mlEvidence = function (sym) {
  if (sym in UI._mlEv) return UI._mlEv[sym];
  const pre = window.ALPHALAB_EVIDENCE && window.ALPHALAB_EVIDENCE.ml;
  if (pre && sym in pre) return (UI._mlEv[sym] = pre[sym]);
  return (UI._mlEv[sym] = UI.computeMlEvidence(sym));
};
// one model's walk-forward record on one name, plus what it says today
UI.computeModelEvidence = function (sym, spec) {
  try {
    const M = ML.models[spec.id];
    if (!M) return null;
    const F = spec.seq ? ML.featuresFor({ model: spec.id, sym, horizon: 5 }) : ML.makeFeatures(sym, 5);
    if (!F || F.X.length < 400) return null;
    const minTrain = Math.max(200, Math.min(750, Math.floor(F.X.length / 2)));
    const wf = ML.walkForward(F, spec.id, { refit: 252, ...(spec.seq ? SEQ_P : {}), ...(spec.p || {}), minTrain });
    const xs = [], ys = [];
    for (let i = 0; i < wf.preds.length; i += 5) if (isFinite(wf.preds[i]) && isFinite(F.y[i])) { xs.push(wf.preds[i]); ys.push(F.y[i]); }
    if (xs.length < 40) return null;
    const ic = Q.spearman(xs, ys);
    if (!isFinite(ic)) return null;
    const t = ic * Math.sqrt((xs.length - 2) / Math.max(1e-9, 1 - ic * ic));
    const hit = xs.filter((x, i) => Math.sign(x) === Math.sign(ys[i])).length / xs.length;
    // today's call: the newest out-of-sample week, scaled by how big this model's calls usually are
    const all = wf.preds.filter(isFinite), last = wf.preds.slice(-5).filter(isFinite);
    const sd = Q.std(all) || 1e-9;
    const sig = last.length ? clamp((Q.mean(last) - Q.mean(all)) / (2 * sd), -1, 1) : null;
    return { ic: +ic.toFixed(4), t: +t.toFixed(2), n: xs.length, hit: +hit.toFixed(3), sig: sig == null ? null : +sig.toFixed(3) };
  } catch (e) { return null; }
};
// all = true runs the whole zoo (CI); otherwise ridge only, which is fast enough for the browser
UI.computeMlEvidence = function (sym, all) {
  const ser = AL.getSeries(sym);
  if (!ser || ser.cls !== 'Equity' || typeof ML === 'undefined' || !ML.makeFeatures) return null;
  const models = {};
  for (const spec of UI.ML_ZOO) {
    if (!all && spec.id !== 'ridge') continue;
    if (spec.seq && !ML.featuresFor) continue;
    const ev = UI.computeModelEvidence(sym, spec);
    if (ev) models[spec.id] = ev;
  }
  const r = models.ridge;
  if (!r) return null;
  return { ic: r.ic, t: r.t, n: r.n, hit: r.hit, models };
};
// the models that earned a vote on this name after the many-models correction
UI.mlVoters = function (ev) {
  if (!ev) return { k: 0, tStar: 1, pass: [], models: {} };
  const models = ev.models || { ridge: { ic: ev.ic, t: ev.t, n: ev.n, hit: ev.hit, sig: null } };
  const ids = Object.keys(models), k = ids.length, tStar = UI.mlTStar(k);
  const pass = ids.filter(id => models[id].t >= tStar).map(id => ({ id, ...models[id] })).sort((a, b) => b.t - a.t);
  return { k, tStar, pass, models };
};

/* ---------- 3. strategy-library evidence ----------
   Runs the library's own validator (walk-forward split, 3x cost stress, parameter perturbation,
   probabilistic Sharpe) on every single-instrument strategy and records its signal today. Only a
   VALIDATED strategy is allowed to vote. Prebuilt in CI; too heavy to run on every page load. */
function currentSignal(e) {
  const def = e.def, s = AL.getSeries(def.sym);
  if (!s) return null;
  const w = AL.window(s, e.from || '2005-01-01'), px = w.values;
  const rets = px.map((v, i) => i ? v / px[i - 1] - 1 : 0);
  const aux = S.aux(w.dates);
  if (def.macro) aux.macro = S.alignMacro(w.dates, def.macro);
  const sig = S.engines[def.engine](px, rets, { ...def.params }, aux);
  const x = sig[sig.length - 1];
  return isFinite(x) ? +clamp(x, -1, 1).toFixed(3) : null;
}
UI.buildStrategyEvidence = function () {
  const out = { asof: AL.asof, built: new Date().toISOString().slice(0, 16), tested: 0, bySym: {} };
  if (typeof S === 'undefined' || !S.registry) return out;
  for (const e of S.registry) {
    if (e.status !== 'ok' || !e.def || e.def.kind !== 'single' || !AL.getSeries(e.def.sym)) continue;
    try {
      const v = S.validate(e);
      if (!v || !v.full || !v.full.stats) continue;
      out.tested++;
      (out.bySym[e.def.sym] = out.bySym[e.def.sym] || []).push({ id: e.id, name: e.name, verdict: v.verdict,
        sharpe: +v.full.stats.sharpe.toFixed(2), oos: v.oos ? +v.oos.sharpe.toFixed(2) : null, psr: +v.psr.toFixed(3), signal: currentSignal(e) });
    } catch (err) { }
  }
  UI._stEv = out;
  AL.store.set('strategy_evidence', out);
  return out;
};
UI.strategyEvidence = function () {
  if (UI._stEv) return UI._stEv;
  const pre = window.ALPHALAB_EVIDENCE && window.ALPHALAB_EVIDENCE.strategies;
  const local = AL.store.get('strategy_evidence', null);
  const best = [pre, local].filter(Boolean).sort((a, b) => String(b.asof).localeCompare(String(a.asof)))[0];
  return (UI._stEv = best || null);
};
// what the VALIDATED strategies on one instrument say today: s = average long exposure in [0, 1]
UI.timingVote = function (sym) {
  const ev = UI.strategyEvidence();
  const list = ev && ev.bySym[sym] ? ev.bySym[sym].filter(x => x.verdict === 'VALIDATED' && x.signal != null) : [];
  if (!list.length) return null;
  const s = Q.mean(list.map(x => clamp(x.signal, 0, 1)));
  return { sym, n: list.length, s, list, asof: ev.asof };
};

/* ---------- 4. evidence-weighted conviction ----------
   Same engines as the classic six-engine fusion (reused as is, so the bot is untouched), but each
   vote is weighted by its evidence: the ML vote needs a significant walk-forward record for this
   name, the factor vote uses calibrated weights and is scaled by the out-of-sample composite test,
   validated library strategies on the name get a vote, and snapshot engines keep judgment weights. */
// how much each engine counts depends on how long the plan means to hold. For a months-to-years
// plan the fundamental verdict leads; for a days-to-weeks plan the engines that speak to the next
// week or two lead (the ML models forecast five trading days, news and chatter move prices fast, the
// short-horizon signals were tested on two-week holds), and slow valuation gaps count for little.
UI.ENGINE_W = {
  long: { dec: 1.0, ml: 0.8, fac: 0.7, peer: 0.6, sent: 0.5, seas: 0.35, lib: 0.5, short: 0 },
  short: { dec: 0.4, ml: 1.2, fac: 0.3, peer: 0.2, sent: 0.8, seas: 0.35, lib: 0.5, short: 1.0 },
};
UI.isShortTerm = key => !!(UI.RISK_PROFILES && UI.RISK_PROFILES[key] && UI.RISK_PROFILES[key].horizon === 'short');
UI.engineWeights = key => UI.ENGINE_W[UI.isShortTerm(key) ? 'short' : 'long'];
UI.brainConviction = function (sym, scored, key) {
  const base = UI.symConviction(sym, scored);
  if (!base) return null;
  const EW = UI.engineWeights(key);
  const votes = [];
  const push = (engine, v, w, evidence, why) => votes.push({ engine, v: clamp(v, -1, 1), w, evidence, why });
  const f = AL.fmt;
  if (base.dec && base.dec.coverage > 0)
    push('Decision engine', base.dec.overall / 0.4, EW.dec, 'judgment', `Decision engine: ${base.dec.call} (${base.dec.overall >= 0 ? '+' : ''}${base.dec.overall.toFixed(2)})`);
  if (base.ml) {
    // one ML vote, from the models whose own walk-forward record clears the many-models bar on this
    // name, each weighted by its evidence; ridge's live forecast stands in when ridge has no stored call
    const ev = UI.mlEvidence(sym), mv = UI.mlVoters(ev);
    const sigOf = x => x.sig != null ? x.sig : x.id === 'ridge' ? base.ml.z : null;
    const pass = mv.pass.filter(x => sigOf(x) != null);
    const ms = pass.map(x => evidenceMult(x.t)), msum = Q.sum(ms);
    const v = msum ? pass.reduce((a, x, i) => a + ms[i] * sigOf(x), 0) / msum : base.ml.z;
    const m = pass.length ? Math.max(...ms) : 0;
    const best = ev ? Object.entries(mv.models).sort((a, b) => b[1].t - a[1].t)[0] : null;
    push('ML forecast', v, EW.ml * m, ev ? 'backtested' : 'untested',
      `Ridge model projects ${base.ml.pred >= 0 ? '+' : ''}${(base.ml.pred * 100).toFixed(1)}% next period` +
      (!ev ? '; no out-of-sample record, so it does not vote'
        : pass.length ? `; ${pass.length} of ${mv.k} models pass the walk-forward bar (t >= ${f.n(mv.tStar, 1)}): ${pass.map(x => `${x.id} t=${f.n(x.t, 1)}`).join(', ')}.` +
          ` Measured against their usual forecast for this name they lean ${v >= 0 ? 'up' : 'down'} (${v >= 0 ? '+' : ''}${v.toFixed(2)} on a -1 to +1 scale)`
        : `; none of ${mv.k} model${mv.k > 1 ? 's' : ''} clears the walk-forward bar (t >= ${f.n(mv.tStar, 1)}; best ${best[0]} t=${f.n(best[1].t, 1)}), so it does not vote`));
  }
  const row = scored && scored.bySym ? scored.bySym[sym] : null;
  if (row) {
    const bt = UI.factorBacktest(), cs = UI.calScore(row);
    push('Factor score', cs / 0.6, EW.fac * (bt ? bt.compositeMult : 1), bt ? 'backtested' : 'judgment',
      `Calibrated factor score ${cs >= 0 ? '+' : ''}${cs.toFixed(2)}` + (bt ? ` (factor backtest t=${f.n(bt.composite.calibrated.t, 1)})` : ''));
  }
  if (EW.short > 0) {
    const ss = UI.shortScores(), x = ss.bySym[sym], sb = ss.bt;
    if (x && sb) push('Short-term signals', x.score / 1.5, EW.short * sb.compositeMult, 'backtested',
      `Two-week signals ${x.score >= 0 ? '+' : ''}${x.score.toFixed(2)}: ${f.spct(x.raw.wk1)} last week, ${f.spct(x.raw.wk4)} last 4 weeks, beta ${f.n(x.raw.beta, 2)}` +
      ` (walk-forward t=${f.n(sb.composite.t, 1)}${sb.compositeMult ? '' : ', no edge after costs, so it does not vote'})`);
  }
  if (base.peer) push('Peer valuation', base.peer.z, EW.peer, 'judgment', base.peer.why);
  const alt = base.alt;
  if (alt) {
    const parts = [];
    if (alt.bullRatio != null) parts.push((alt.bullRatio - 0.5) * 2);
    if (alt.toneTrend != null) parts.push(clamp(alt.toneTrend, -1, 1));
    if (parts.length) push('Sentiment', Q.mean(parts), EW.sent, 'judgment',
      'Sentiment: ' + [alt.bullRatio != null ? `${Math.round(alt.bullRatio * 100)}% of social chatter bullish` : null,
        alt.toneTrend != null ? (alt.toneTrend > 0.05 ? 'news tone improving' : alt.toneTrend < -0.05 ? 'news tone worsening' : 'news tone flat') : null].filter(Boolean).join(', '));
  }
  if (base.seas) push('Seasonality', base.seas.z, EW.seas, 'significance-gated', base.seas.why);
  const tv = UI.timingVote(sym);
  if (tv) push('Strategy library', tv.s * 2 - 1, EW.lib, 'backtested', `${tv.n} validated strateg${tv.n > 1 ? 'ies' : 'y'} on ${sym}: ${tv.s >= 0.5 ? 'long' : 'out'} today`);
  const live = votes.filter(v => v.w > 0);
  if (!live.length) return null;
  const wsum = Q.sum(live.map(v => v.w));
  const conviction = live.reduce((s, v) => s + v.v * v.w, 0) / wsum;
  const agree = live.filter(v => v.v !== 0 && Math.sign(v.v) === Math.sign(conviction)).length;
  return { sym, conviction, agree, nEngines: live.length, votes, why: live.map(v => v.why),
    dec: base.dec, ml: base.ml, peer: base.peer, seas: base.seas, alt: base.alt };
};

/* ---------- 5. covariance-aware sizing of the stock sleeve ----------
   Pairwise covariance on up to two years of weekly returns, annualized, shrunk 30% toward the
   diagonal so a noisy estimate cannot drive an extreme answer. Hierarchical Risk Parity spreads
   risk across clusters of stocks that move together; Black-Litterman turns each name's conviction
   into an expected-return view around an equal-weight prior, and max-Sharpe sizes on that. The
   risk level sets the blend: pure HRP (conservative) through mostly Black-Litterman (aggressive). */
UI.sleeveCov = function (syms, fallbackVol) {
  const n = 104, k = syms.length;
  const R = syms.map(s => UI.weeklyRets(s));
  const vol = syms.map((s, i) => {
    const r = R[i] ? R[i].slice(-n).filter(x => x != null) : [];
    return r.length >= 26 ? Q.std(r) * Math.sqrt(52) : (fallbackVol && fallbackVol[i]) || 0.3;
  });
  const C = Array.from({ length: k }, () => new Array(k).fill(0));
  const Rho = Array.from({ length: k }, () => new Array(k).fill(1));
  for (let i = 0; i < k; i++) {
    C[i][i] = vol[i] * vol[i];
    for (let j = i + 1; j < k; j++) {
      const c = UI.pairCorr(syms[i], syms[j], n);
      const rho = c == null || !isFinite(c) ? 0.3 : c;       // too little overlap: assume a typical stock correlation
      Rho[i][j] = Rho[j][i] = rho;
      C[i][j] = C[j][i] = 0.7 * rho * vol[i] * vol[j];
    }
  }
  return { C, R: Rho, vol };
};
// water-fill: no weight above cap, the excess goes to the uncapped names; if all are capped the
// remainder is returned unallocated (the caller sends it to the core index)
UI.capWeights = function (w, cap) {
  w = w.slice();
  for (let it = 0; it < 20; it++) {
    const over = w.map((x, i) => x > cap + 1e-12 ? i : -1).filter(i => i >= 0);
    if (!over.length) break;
    let excess = 0;
    over.forEach(i => { excess += w[i] - cap; w[i] = cap; });
    const free = w.map((x, i) => x < cap - 1e-12 ? i : -1).filter(i => i >= 0);
    const fs = Q.sum(free.map(i => w[i]));
    if (!free.length || fs <= 0) break;
    free.forEach(i => w[i] += excess * w[i] / fs);
  }
  return w;
};
UI.sizeSleeve = function (picks, key, cap) {
  const P = UI.RISK_PROFILES[key] || UI.RISK_PROFILES.balanced;
  const k = picks.length;
  if (!k) return { w: [], method: '-', sleeveVol: null, divRatio: null, maxCorr: null };
  const { C, R } = UI.sleeveCov(picks.map(p => p.sym), picks.map(p => p.vol));
  let w = k === 1 ? [1] : Q.hrp(C, R);
  let method = 'Hierarchical Risk Parity';
  const bl = P.blMix || 0;
  if (k > 1 && bl > 0) {
    const eqw = new Array(k).fill(1 / k);
    const Pi = Q.blackLitterman(C, eqw, []).implied;
    const views = picks.map((p, i) => ({ idx: i, ret: Pi[i] + 0.10 * clamp(p.conv || 0, -1, 1),
      conf: clamp(p.agreeFrac != null ? 0.25 + 0.5 * p.agreeFrac : 0.5, 0.25, 0.75) }));
    const mu = Q.blackLitterman(C, eqw, views).blended;
    const ms = Q.maxSharpe(mu, C);
    w = w.map((x, i) => (1 - bl) * x + bl * ms[i]);
    method = `${Math.round((1 - bl) * 100)}% Hierarchical Risk Parity + ${Math.round(bl * 100)}% Black-Litterman max-Sharpe`;
  }
  const s = Q.sum(w) || 1;
  w = UI.capWeights(w.map(x => x / s), cap || 1);
  const ws = Q.sum(w) || 1, wn = w.map(x => x / ws);
  const sleeveVol = Q.portVol(wn, C);
  const avgVol = Q.sum(wn.map((x, i) => x * Math.sqrt(C[i][i])));
  let maxCorr = null;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (maxCorr == null || R[i][j] > maxCorr) maxCorr = R[i][j];
  // the same sleeve equal-weighted, for the "what did the optimizer buy you" comparison
  const eq = new Array(k).fill(1 / k);
  return { w, method, sleeveVol, eqVol: Q.portVol(eq, C), divRatio: sleeveVol ? avgVol / sleeveVol : null, maxCorr };
};

/* ---------- 6. plan-level risk: volatility, monthly VaR / CVaR, drawdown and crisis replays ----------
   Built on the ten-year weekly grid. A holding with no history in a given week (a recent listing,
   crypto before 2014) is stood in for by its beta times the S&P 500 that week, and flagged. */
UI.STRESS = [
  { key: '2008', name: '2008 financial crisis', from: '2007-10-09', to: '2009-03-09' },
  { key: 'COVID', name: 'COVID crash 2020', from: '2020-02-19', to: '2020-03-23' },
  { key: '2022', name: '2022 rate shock', from: '2022-01-03', to: '2022-10-12' },
];
function pxAt(sym, date) {
  const s = AL.getSeries(sym);
  if (!s || !s.dates.length || s.dates[0] > date) return weeklyPxAt(sym, date);
  let lo = 0, hi = s.dates.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s.dates[m] <= date) lo = m; else hi = m - 1; }
  // a series that stopped long before the date (or started after it) cannot speak for that date
  return Math.abs(Date.parse(date) - Date.parse(s.dates[lo])) < 12 * 864e5 ? s.values[lo] : weeklyPxAt(sym, date);
}
// fallback for names that only have weekly bars (S&P 500 from 2016, total market from 2023): the
// close of the last week that ended on or before the date (a bar labeled Monday closes that Friday)
function weeklyPxAt(sym, date) {
  const sp = AL.sp500(), v = UI.weeklyAligned(sym);
  if (!sp || !v) return null;
  const t = Date.parse(date);
  let k = -1;
  for (let i = 0; i < sp.wcal.length; i++) { if (Date.parse(sp.wcal[i]) + 4 * 864e5 <= t) k = i; else break; }
  if (k < 0 || v[k] == null) return null;
  return t - (Date.parse(sp.wcal[k]) + 4 * 864e5) < 12 * 864e5 ? v[k] : null;
}
UI.planRisk = function (wBySym) {
  const syms = Object.keys(wBySym).filter(s => wBySym[s] > 0);
  const spy = UI.weeklyRets('SPY');
  if (!syms.length || !spy) return null;
  const sc = UI._scoreCache;
  const betaOf = s => { const ser = AL.getSeries(s); if (ser && ser.cls === 'Crypto') return 2; const ab = UI.alignedBeta(s); if (ab != null) return clamp(0.67 * ab + 0.33, 0.3, 2); const r = sc && sc.bySym[s]; return r && isFinite(r.beta) ? r.beta : 1; };
  const cols = syms.map(s => UI.weeklyRets(s));
  const blended = [];
  let proxyWeeks = 0;
  for (let t = 1; t < spy.length; t++) {
    if (spy[t] == null) continue;
    let r = 0, px = 0;
    syms.forEach((s, i) => {
      const x = cols[i] && cols[i][t] != null ? cols[i][t] : null;
      if (x == null) px += wBySym[s];
      r += wBySym[s] * (x != null ? x : betaOf(s) * spy[t]);
    });
    if (px > 0.02) proxyWeeks++;
    blended.push(r);
  }
  if (blended.length < 52) return null;
  const vol = Q.std(blended) * Math.sqrt(52);
  const months = [];
  for (let i = 0; i + 4 <= blended.length; i += 4) months.push(blended.slice(i, i + 4).reduce((a, x) => a * (1 + x), 1) - 1);
  const sorted = months.slice().sort((a, b) => a - b), q = Math.max(1, Math.floor(sorted.length * 0.05));
  const eq = Q.equity(blended);
  let peak = eq[0], maxDD = 0;
  eq.forEach(v => { peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); });
  const spyPx = d => pxAt('SPY', d);
  const stress = UI.STRESS.map(sc2 => {
    const mkt = spyPx(sc2.to) / spyPx(sc2.from) - 1;
    const proxied = [];
    let ret = 0;
    syms.forEach(s => {
      const a = pxAt(s, sc2.from), b = pxAt(s, sc2.to);
      if (a > 0 && b > 0) ret += wBySym[s] * (b / a - 1);
      else { proxied.push(s); ret += wBySym[s] * Math.max(-1, betaOf(s) * mkt); }
    });
    return { ...sc2, ret, mkt, proxied, proxiedW: Q.sum(proxied.map(s => wBySym[s])) };
  });
  // a replay where more than half the plan had to be stood in for is indicative only: it is shown but
  // does not drive the risk budget (the volatility limit still applies to every holding)
  stress.forEach(x => { x.indicative = x.proxiedW > 0.5; });
  const byLoss = stress.slice().sort((a, b) => a.ret - b.ret);
  const worst = byLoss.find(x => !x.indicative) || null, worstAny = byLoss[0];
  return { vol, var95m: -Q.quantile(sorted, 0.05), cvar95m: -Q.mean(sorted.slice(0, q)), maxDD, stress, worst, worstAny,
    weeks: blended.length, from: AL.sp500().wcal[1], proxyWeeks };
};

/* ---------- 7. "How this plan was decided": one panel shared by the Competition Center and the
   Stock Advisor, so every number the plan leans on is on screen with its evidence ---------- */
const sgn = (x, d = 2) => (x >= 0 ? '+' : '') + (+x).toFixed(d);
UI.engineAgreeCell = function (v) {
  if (!v || !v.votes) return '<span class="note">-</span>';
  const live = v.votes.filter(x => x.w > 0);
  const agree = live.filter(x => x.v !== 0 && Math.sign(x.v) === Math.sign(v.conv)).length;
  const tip = v.votes.map(x => `${x.engine}: ${sgn(x.v)} x weight ${x.w.toFixed(2)}${x.w > 0 ? '' : ' (no vote)'}. ${x.why}`).join('\n');
  return `<span class="chip ${v.conv >= 0 ? 'on' : ''}" title="${AL.fmt.esc(tip)}">${agree} of ${live.length}</span>`;
};
UI.brainPanel = function (t, opts = {}) {
  const f = AL.fmt, b = t && t.brain;
  if (!b) return UI.panel('How this plan was decided', '<div class="empty">This plan was saved before the quant brain existed. Rebuild the plan to see the full evidence.</div>');
  const bt = UI.factorBacktest(), stEv = UI.strategyEvidence();
  const P = t.profile || UI.RISK_PROFILES[t.profileKey] || {};
  const allSt = stEv ? Object.values(stEv.bySym).flat() : [];
  const nVal = allSt.filter(x => x.verdict === 'VALIDATED').length;
  const mlPre = window.ALPHALAB_EVIDENCE && window.ALPHALAB_EVIDENCE.ml;
  const mlAll = mlPre ? Object.values(mlPre) : [];
  const mlVot = mlAll.map(x => UI.mlVoters(x));
  const mlSig = mlVot.filter(x => x.pass.length).length;
  const mlK = mlVot.length ? Math.max(...mlVot.map(x => x.k)) : 1;
  const mlByModel = {};
  mlVot.forEach(x => x.pass.forEach(p => mlByModel[p.id] = (mlByModel[p.id] || 0) + 1));
  const mlTop = Object.entries(mlByModel).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join(', ');
  const badge = (ok, yes, no) => `<span class="badge ${ok ? 'ok' : 'dim'}">${ok ? yes : no}</span>`;
  const sec = (title, html) => `<div style="margin-top:14px"><div style="font-weight:600;margin-bottom:6px">${title}</div>${html}</div>`;

  // 1. the engines and how much each is trusted
  const short = UI.isShortTerm(t.profileKey), EW = UI.engineWeights(t.profileKey), w2 = x => x.toFixed(2);
  const sbt = short ? UI.shortBacktest() : null;
  const engines = [
    ['Decision engine', 'fundamentals, valuation, quality, momentum and analyst view in one Buy / Sell verdict', w2(EW.dec), 'judgment', true],
    ['ML forecast', `${mlK > 1 ? `${mlK} models (linear, trees, kernels, nets, RL agent, LSTM / GRU / attention / transformer)` : 'ridge model'} on price and volume features, next-week return`, `${w2(EW.ml)} x evidence`,
      mlAll.length ? `walk-forward record on ${mlAll.length} names; ${mlSig} have a model clearing t >= ${f.n(UI.mlTStar(mlK), 1)} after the many-models correction${mlTop ? ` (${mlTop})` : ''}` : 'ridge computed per name on demand', mlSig > 0 || !mlAll.length],
    ['Factor score', 'Stock Advisor score with backtest-calibrated price-factor weights', bt ? `${w2(EW.fac)} x ${bt.compositeMult.toFixed(2)}` : w2(EW.fac), bt ? `out-of-sample composite t = ${f.n(bt.composite.calibrated.t, 2)}` : 'backtest unavailable', !bt || bt.compositeMult > 0],
    ...(short ? [['Short-term signals', 'reversal of the last 1 and 4 weeks, 12-week momentum, 52-week high, beta; next two weeks', sbt ? `${w2(EW.short)} x ${sbt.compositeMult.toFixed(2)}` : w2(EW.short),
      sbt ? `walk-forward composite t = ${f.n(sbt.composite.t, 2)}, ${f.spct(sbt.composite.netAnn)} a year vs the average stock after costs` : 'backtest unavailable', !!sbt && sbt.compositeMult > 0]] : []),
    ['Peer valuation', 'P/E, P/B, margins vs sector peers', w2(EW.peer), 'judgment (snapshot, no history to test)', true],
    ['Sentiment', 'social chatter and news tone', w2(EW.sent), 'judgment (snapshot, no history to test)', true],
    ['Seasonality', 'calendar tilt, only when statistically significant', w2(EW.seas), 'significance-gated', true],
    ['Strategy library', 'validated rule-based strategies on the same instrument', w2(EW.lib), stEv ? `${nVal} of ${stEv.tested} strategies validated (as of ${stEv.asof})` : 'not run yet', !!stEv && nVal > 0],
  ];
  const engHtml = `<table class="tbl"><thead><tr><th>Engine</th><th>What it reads</th><th class="r">Vote weight</th><th>Evidence</th><th></th></tr></thead><tbody>` +
    engines.map(([n, what, w, ev, on]) => `<tr><td class="t"><b>${n}</b></td><td class="t" style="font-size:11px">${what}</td><td class="r">${w}</td><td class="t" style="font-size:11px">${ev}</td><td>${badge(on, 'voting', 'silenced')}</td></tr>`).join('') +
    `</tbody></table><div class="note" style="margin-top:6px">${short ? 'Weights are set for a days-to-weeks hold: the engines that speak to the next week or two count more, slow fundamental and valuation views count less. ' : ''}Every engine votes on a -1 to +1 scale and conviction is the weighted average. An engine that failed its own out-of-sample test gets weight 0: it is switched off, never flipped to the opposite bet. Hover the "engines agree" count next to any stock for its individual votes.</div>`;

  // 2. factor backtest
  let btHtml = '<div class="empty">Factor backtest unavailable (needs the S&P 500 weekly bundle).</div>';
  if (bt) {
    const c = bt.composite;
    btHtml = `<div class="note" style="margin-bottom:6px">Every ${bt.horizonWeeks} weeks from ${bt.from} to ${bt.to} (${bt.periods} non-overlapping periods, about ${bt.avgNames} S&P 500 names each), each price factor was rebuilt from data up to that week only and ranked against the next ${bt.horizonWeeks} weeks' return. IC is the rank correlation; t above 2 is strong evidence, below 0.5 is noise.</div>
      <table class="tbl"><thead><tr><th>Factor</th><th class="r">Mean IC</th><th class="r">t-stat</th><th class="r">Periods right</th><th class="r">Weight before</th><th class="r">Weight now</th></tr></thead><tbody>` +
      bt.factors.map(x => `<tr><td class="t">${x.label}</td><td class="r ${x.ic >= 0 ? 'up' : 'dn'}">${sgn(x.ic, 3)}</td><td class="r">${f.n(x.t, 2)}</td><td class="r">${f.pct(x.hit, 0)}</td><td class="r">${x.prior.toFixed(2)}</td><td class="r"><b>${x.weight.toFixed(2)}</b></td></tr>`).join('') +
      `</tbody></table>
      <div class="note" style="margin-top:6px">Composite with the old weights: IC ${sgn(c.prior.ic, 3)} (t ${f.n(c.prior.t, 2)}). Equal weights: IC ${sgn(c.equal.ic, 3)} (t ${f.n(c.equal.t, 2)}). Calibrated walk-forward, using only ICs known at the time: IC ${sgn(c.calibrated.ic, 3)} (t ${f.n(c.calibrated.t, 2)}), top-minus-bottom fifth ${f.spct(c.calibrated.spreadAnn)} a year.
      ${bt.compositeMult > 0 ? 'The calibrated factors held up out of sample, so the factor vote counts.' : '<b>Honest result: on this sample the price factors did not predict the next month for S&P 500 stocks, so their vote is switched off.</b> Picks now lean on the engines that did pass (and on judgment engines that cannot be tested), rather than on a score that only looked good in hindsight.'}</div>
      <ul class="note" style="margin:6px 0 0;padding-left:18px">${bt.caveats.map(x => `<li>${f.esc(x)}</li>`).join('')}</ul>`;
  }

  // 2b. short-horizon backtest and the trade plan (Short-term risk level only)
  let shHtml = '';
  if (short) {
    if (!sbt) shHtml = '<div class="empty">Short-horizon backtest unavailable (needs the S&P 500 weekly bundle).</div>';
    else {
      const c = sbt.composite;
      shHtml = `<div class="note" style="margin-bottom:6px">Every ${sbt.horizonWeeks} weeks from ${sbt.from} to ${sbt.to} (${sbt.periods} non-overlapping periods), each signal was rebuilt from data up to that week and ranked against the next ${sbt.horizonWeeks} weeks' return. Weights come only from results already known at the time.</div>
        <table class="tbl"><thead><tr><th>Signal</th><th class="r">Mean IC</th><th class="r">t-stat</th><th class="r">Periods right</th><th class="r">Weight</th></tr></thead><tbody>` +
        sbt.factors.map(x => `<tr><td class="t">${x.label}</td><td class="r ${x.ic >= 0 ? 'up' : 'dn'}">${sgn(x.ic, 3)}</td><td class="r">${f.n(x.t, 2)}</td><td class="r">${f.pct(x.hit, 0)}</td><td class="r"><b>${x.weight.toFixed(2)}</b></td></tr>`).join('') +
        `</tbody></table>
        <div class="note" style="margin-top:6px">Walk-forward composite: IC ${sgn(c.ic, 3)} (t ${f.n(c.t, 2)}). Holding its top fifth beat the average S&P 500 stock by ${f.spct(c.excessAnn)} a year before costs and ${f.spct(c.netAnn)} after, swapping about ${f.pct(c.turnover, 0)} of the names every two weeks; it came out ahead in ${f.pct(c.hitNet, 0)} of two-week periods.
        <b>${sbt.compositeMult > 0 ? 'A real but small edge: it gets a partial vote, and most two-week results will still be decided by the market.' : 'No edge survived costs on this sample, so the short-term vote is switched off.'}</b>
        What did not work over two weeks is as useful: buying recent winners (momentum) and names near their highs lost, so this level buys pullbacks in high-beta names instead.</div>
        <ul class="note" style="margin:6px 0 0;padding-left:18px">${sbt.caveats.map(x => `<li>${f.esc(x)}</li>`).join('')}</ul>`;
      const ss = UI.shortScores(), syms = Object.keys((b.sleeve && b.sleeve.votes) || {});
      const exitOn = new Date(Date.parse(AL.asof) + sbt.horizonWeeks * 7 * 864e5).toISOString().slice(0, 10);
      const rows = syms.map(sym => ({ sym, x: ss.bySym[sym] })).filter(r => r.x);
      if (rows.length) shHtml += `<div style="font-weight:600;margin:10px 0 6px">Trade plan for each stock</div>
        <table class="tbl"><thead><tr><th>Stock</th><th class="r">Last week</th><th class="r">Last 4 weeks</th><th class="r">Beta</th><th class="r">Two-week signal</th><th class="r">Stop</th><th class="r">Review by</th></tr></thead><tbody>` +
        rows.map(({ sym, x }) => {
          const stop = -2 * x.raw.vol * Math.sqrt(sbt.horizonWeeks / 52);
          return `<tr><td class="sym">${sym}</td><td class="r ${x.raw.wk1 >= 0 ? 'up' : 'dn'}">${f.spct(x.raw.wk1)}</td><td class="r ${x.raw.wk4 >= 0 ? 'up' : 'dn'}">${f.spct(x.raw.wk4)}</td><td class="r">${f.n(x.raw.beta, 2)}</td><td class="r">${sgn(x.score, 2)}</td><td class="r dn">${f.spct(stop)}</td><td class="r">${exitOn}</td></tr>`;
        }).join('') +
        `</tbody></table><div class="note" style="margin-top:6px">The stop is a two-standard-deviation two-week move for that stock: a drop that large means the bounce thesis is wrong, not just noise. The review date is when the tested holding window ends; rebuild the plan then and sell what no longer makes the list. This level is built to trade, so expect to turn over about half the stocks every two weeks.</div>`;
    }
  }

  // 3. stock sleeve optimizer
  const s = b.sleeve;
  const slHtml = s ? `<div class="tiles">
      <div class="tile"><div class="t-label">Sizing method</div><div class="t-value" style="font-size:13px">${s.method}</div></div>
      <div class="tile"><div class="t-label">Stock sleeve volatility</div><div class="t-value">${f.pct(s.sleeveVol, 1)}</div><div class="t-delta note">equal-weighted: ${f.pct(s.eqVol, 1)}</div></div>
      <div class="tile"><div class="t-label">Diversification ratio</div><div class="t-value">${f.n(s.divRatio, 2)}</div><div class="t-delta note">1.0 = no diversification</div></div>
      <div class="tile"><div class="t-label">Most correlated pair</div><div class="t-value">${s.maxCorr != null ? f.n(s.maxCorr, 2) : '-'}</div><div class="t-delta note">limit ${f.n(P.maxCorr, 2)}</div></div>
    </div>
    <div class="note" style="margin-top:6px">Sized on two years of weekly returns (covariance shrunk 30% toward independence so noise cannot drive an extreme answer). Hierarchical Risk Parity spreads risk across clusters of stocks that move together; Black-Litterman turns each stock's conviction into an expected-return view and max-Sharpe sizes on it. No stock above ${f.pct(P.maxName, 0)} of the plan.
    ${s.skipped.length ? `Passed over for moving too much like a stock already picked: ${s.skipped.map(x => `<b>${x.sym}</b> (${f.n(x.corr, 2)} with ${x.with})`).join(', ')}.` : 'No candidate had to be passed over for correlation.'}</div>` : '<div class="empty">No individual stocks in this plan.</div>';

  // 4. risk budget
  const r = b.risk;
  const rkHtml = r ? `<div class="tiles">
      <div class="tile"><div class="t-label">Plan volatility</div><div class="t-value">${f.pct(r.vol, 1)}</div><div class="t-delta note">budget ${f.pct(b.budget.vol, 1)}</div></div>
      <div class="tile"><div class="t-label">Monthly VaR 95%</div><div class="t-value dn">${f.pct(r.var95m, 1)}</div><div class="t-delta note">1 month in 20 loses more</div></div>
      <div class="tile"><div class="t-label">Monthly CVaR 95%</div><div class="t-value dn">${f.pct(r.cvar95m, 1)}</div><div class="t-delta note">average of those bad months</div></div>
      <div class="tile"><div class="t-label">Max drawdown</div><div class="t-value dn">${f.pct(-r.maxDD, 1)}</div><div class="t-delta note">since ${r.from}</div></div>
      <div class="tile"><div class="t-label">Invested after budget</div><div class="t-value">${f.pct(b.scaledTo, 0)}</div><div class="t-delta note">${b.scaledTo < 0.998 ? 'rest held as cash' : 'budget not binding'}</div></div>
    </div>
    <table class="tbl" style="margin-top:8px"><thead><tr><th>Crisis replay</th><th>Window</th><th class="r">This plan</th><th class="r">S&P 500</th><th>Data</th></tr></thead><tbody>` +
    r.stress.map(x => `<tr><td class="t">${x.name}</td><td class="t" style="font-size:11px">${x.from} to ${x.to}</td><td class="r ${x.ret >= 0 ? 'up' : 'dn'}"><b>${f.spct(x.ret)}</b></td><td class="r">${f.spct(x.mkt)}</td>
      <td class="t" style="font-size:11px">${x.proxied.length ? `${f.pct(x.proxiedW, 0)} of plan estimated from beta x S&P (${x.proxied.slice(0, 6).join(', ')}${x.proxied.length > 6 ? '...' : ''} had no prices then)${x.indicative ? '; indicative only, not enforced' : ''}` : 'real prices for every holding'}</td></tr>`).join('') +
    `</tbody></table><div class="note" style="margin-top:6px">The whole plan, funds, stocks, bonds, gold and crypto together, replayed on ten years of weekly returns and through three real crises. If volatility tops ${f.pct(b.budget.vol, 1)} or a measured crisis loss tops ${f.pct(-b.budget.stress, 0)}, every position is scaled down together and the difference is held as cash.</div>` : '<div class="empty">Risk replay unavailable.</div>';

  // 5. strategy-library timing
  const tmHtml = b.timing && b.timing.length ? `<table class="tbl"><thead><tr><th>Fund</th><th class="r">Validated strategies</th><th class="r">Long today</th><th class="r">Position kept</th><th>Strategies</th></tr></thead><tbody>` +
    b.timing.map(x => `<tr><td class="sym">${x.sym}</td><td class="r">${x.n}</td><td class="r">${f.pct(x.s, 0)}</td><td class="r"><b>${f.pct(x.factor, 0)}</b></td><td class="t" style="font-size:11px">${x.ids.join(', ')}</td></tr>`).join('') +
    `</tbody></table><div class="note" style="margin-top:6px">Only strategies that passed the library's validator (walk-forward out-of-sample, triple trading costs, parameter perturbation and probabilistic Sharpe) vote. When they are out of a fund, up to a quarter of it moves to cash. Evidence as of ${stEv ? stEv.asof : '-'}.</div>`
    : `<div class="empty">${stEv ? 'No validated strategy covers the funds in this plan.' : 'The strategy library has not been validated on this data yet.'}</div>`;
  const runBtn = `<button class="btn small" id="brain-run-lib" style="margin-top:8px">${stEv ? 'Re-run the strategy library on today\'s data' : 'Run the strategy library now'}</button>`;

  return UI.panel('How this plan was decided', `
    <div class="note">Every quant tool in AlphaLab feeds this plan, and each one is trusted only as far as its own track record goes. Below: which engines vote and why, what the factor backtest found, how the stocks were sized, what the whole plan would have done in real crises, and what the validated strategies say about each fund.</div>
    ${sec('1. Engines and their evidence', engHtml)}
    ${sec('2. Factor backtest (point-in-time, S&P 500)', btHtml)}
    ${short ? sec('2b. Short-term signals and trade plan (two-week holds)', shHtml) : ''}
    ${opts.noSleeve ? '' : sec('3. Stock sizing', slHtml)}
    ${opts.noRisk ? '' : sec('4. Risk budget and crisis replays', rkHtml)}
    ${opts.noTiming ? '' : sec('5. Strategy-library timing', tmHtml + runBtn)}`);
};
// wire the panel's one button; rebuild() is the host screen's re-render
UI.bindBrainPanel = function (root, rebuild) {
  const btn = root.querySelector('#brain-run-lib');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true; btn.textContent = 'Validating every strategy, about 15 seconds...';
    setTimeout(() => {
      try { UI._stEv = null; UI.buildStrategyEvidence(); UI._picksCache = {}; if (UI.toast) UI.toast('Strategy library validated on today\'s data', 'ok'); }
      catch (e) { if (UI.toast) UI.toast('Strategy library run failed: ' + e.message, 'bad'); }
      rebuild();
    }, 30);
  });
};
})();
