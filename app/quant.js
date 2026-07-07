/* AlphaLab quant engine: statistics, performance analytics, backtesting,
   regime detection, portfolio optimization. All computations run on real data. */
'use strict';
const Q = window.Q = {};
const ANN = 252;

/* ---------- basic statistics ---------- */
Q.mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
Q.sum = a => a.reduce((s, x) => s + x, 0);
Q.std = function (a) {
  if (a.length < 2) return NaN;
  const m = Q.mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
Q.skew = function (a) {
  const m = Q.mean(a), s = Q.std(a), n = a.length;
  if (!s || n < 3) return NaN;
  return a.reduce((t, x) => t + Math.pow((x - m) / s, 3), 0) * n / ((n - 1) * (n - 2));
};
Q.kurt = function (a) {
  const m = Q.mean(a), s = Q.std(a), n = a.length;
  if (!s || n < 4) return NaN;
  return a.reduce((t, x) => t + Math.pow((x - m) / s, 4), 0) / n - 3;
};
Q.quantile = function (a, q) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
};
Q.cov = function (a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const ma = Q.mean(a.slice(-n)), mb = Q.mean(b.slice(-n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[a.length - n + i] - ma) * (b[b.length - n + i] - mb);
  return s / (n - 1);
};
Q.corr = function (a, b) {
  const c = Q.cov(a, b), sa = Q.std(a), sb = Q.std(b);
  return sa && sb ? c / (sa * sb) : NaN;
};
Q.rank = function (a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  idx.forEach(([, i], k) => r[i] = k);
  return r;
};
Q.spearman = function (a, b) {
  const pairs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (isFinite(a[i]) && isFinite(b[i])) pairs.push([a[i], b[i]]);
  if (pairs.length < 5) return NaN;
  return Q.corr(Q.rank(pairs.map(p => p[0])), Q.rank(pairs.map(p => p[1])));
};
Q.zscores = function (a, n) { // rolling z-score
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) {
    const w = a.slice(i - n + 1, i + 1);
    const m = Q.mean(w), s = Q.std(w);
    out[i] = s ? (a[i] - m) / s : 0;
  }
  return out;
};
Q.linreg = function (x, y) { // y = a + b x, with t-stat on b
  const n = Math.min(x.length, y.length);
  const mx = Q.mean(x.slice(0, n)), my = Q.mean(y.slice(0, n));
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = y[i] - a - b * x[i]; sse += e * e; }
  const se = sxx ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  const r2 = 1 - sse / y.slice(0, n).reduce((s, v) => s + (v - my) ** 2, 0);
  return { a, b, t: se ? b / se : 0, r2, resid: (i) => y[i] - a - b * x[i], n };
};
Q.tstat = function (a) { // t-stat of the mean
  const s = Q.std(a);
  return s ? Q.mean(a) / (s / Math.sqrt(a.length)) : NaN;
};
/* Augmented Dickey-Fuller (no lags, constant): regress Δy on y_{t-1} */
Q.adf = function (y) {
  const dy = [], ylag = [];
  for (let i = 1; i < y.length; i++) { dy.push(y[i] - y[i - 1]); ylag.push(y[i - 1]); }
  const r = Q.linreg(ylag, dy);
  // 5% critical value for ADF with constant ≈ -2.86
  return { t: r.t, stationary: r.t < -2.86, halflife: r.b < 0 ? -Math.log(2) / Math.log(1 + r.b) : Infinity };
};
/* Engle-Granger cointegration test */
Q.coint = function (x, y) {
  const r = Q.linreg(x, y);
  const resid = [];
  for (let i = 0; i < r.n; i++) resid.push(y[i] - r.a - r.b * x[i]);
  const adf = Q.adf(resid);
  return { hedge: r.b, intercept: r.a, adf: adf.t, cointegrated: adf.t < -3.34, halflife: adf.halflife, resid };
};

/* ---------- rolling helpers ---------- */
Q.sma = function (a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
};
Q.ema = function (a, n) {
  const out = new Array(a.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = a[0];
  for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; out[i] = e; }
  return out;
};
Q.rollStd = function (a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) out[i] = Q.std(a.slice(i - n + 1, i + 1));
  return out;
};
Q.rollCorr = function (a, b, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) out[i] = Q.corr(a.slice(i - n + 1, i + 1), b.slice(i - n + 1, i + 1));
  return out;
};
Q.rollBeta = function (ra, rb, n) {
  const out = new Array(ra.length).fill(NaN);
  for (let i = n - 1; i < ra.length; i++) {
    const wa = ra.slice(i - n + 1, i + 1), wb = rb.slice(i - n + 1, i + 1);
    const v = Q.std(wb) ** 2;
    out[i] = v ? Q.cov(wa, wb) / v : NaN;
  }
  return out;
};
Q.momentum = function (px, n, skip = 0) {
  const out = new Array(px.length).fill(NaN);
  for (let i = n + skip; i < px.length; i++) out[i] = px[i - skip] / px[i - n] - 1;
  return out;
};
Q.rsi = function (px, n = 14) {
  const out = new Array(px.length).fill(NaN);
  let up = 0, dn = 0;
  for (let i = 1; i < px.length; i++) {
    const ch = px[i] - px[i - 1];
    const u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i <= n) { up += u / n; dn += d / n; }
    else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + d) / n; }
    if (i >= n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
};
Q.drawdownSeries = function (eq) {
  const out = new Array(eq.length);
  let peak = -Infinity;
  for (let i = 0; i < eq.length; i++) { peak = Math.max(peak, eq[i]); out[i] = eq[i] / peak - 1; }
  return out;
};

/* ---------- performance analytics ---------- */
Q.equity = function (rets, start = 1) {
  const eq = new Array(rets.length + 1); eq[0] = start;
  for (let i = 0; i < rets.length; i++) eq[i + 1] = eq[i] * (1 + rets[i]);
  return eq;
};
Q.perf = function (rets, opts = {}) {
  const rf = (opts.rf ?? 0.02) / ANN;              // annual risk-free, default 2%
  const bench = opts.bench || null;                 // aligned benchmark returns
  const n = rets.length;
  if (n < 20) return null;
  const eq = Q.equity(rets);
  const yrs = n / ANN;
  const cagr = Math.pow(eq[n], 1 / yrs) - 1;
  const vol = Q.std(rets) * Math.sqrt(ANN);
  const ex = rets.map(r => r - rf);
  const sharpe = Q.std(ex) ? Q.mean(ex) / Q.std(ex) * Math.sqrt(ANN) : 0;
  const downs = rets.filter(r => r < rf).map(r => r - rf);
  const dd = Q.drawdownSeries(eq);
  const maxDD = Math.min(...dd);
  const downDev = downs.length > 2 ? Math.sqrt(Q.sum(downs.map(x => x * x)) / n) * Math.sqrt(ANN) : 0;
  const sortino = downDev ? (Q.mean(rets) * ANN - (opts.rf ?? 0.02)) / downDev : 0;
  const calmar = maxDD < 0 ? cagr / -maxDD : 0;
  const var95 = Q.quantile(rets, 0.05);
  const tail = rets.filter(r => r <= var95);
  const cvar95 = tail.length ? Q.mean(tail) : var95;
  const var99 = Q.quantile(rets, 0.01);
  const gains = rets.filter(r => r > 0), losses = rets.filter(r => r < 0);
  const omega = losses.length ? Q.sum(gains) / -Q.sum(losses) : Infinity;
  const hit = gains.length / n;
  const best = Math.max(...rets), worst = Math.min(...rets);
  const out = {
    n, years: yrs, totalRet: eq[n] - 1, cagr, vol, sharpe, sortino, calmar, omega,
    maxDD, var95, cvar95, var99, downDev, hit, best, worst,
    skew: Q.skew(rets), kurt: Q.kurt(rets), tstat: Q.tstat(rets), dd,
  };
  if (bench && bench.length === n) {
    const active = rets.map((r, i) => r - bench[i]);
    const te = Q.std(active) * Math.sqrt(ANN);
    out.ir = te ? Q.mean(active) * ANN / te : 0;
    out.te = te;
    const vb = Q.std(bench) ** 2;
    out.beta = vb ? Q.cov(rets, bench) / vb : NaN;
    out.alpha = Q.mean(rets) * ANN - ((opts.rf ?? 0.02) + out.beta * (Q.mean(bench) * ANN - (opts.rf ?? 0.02))); // Jensen
    out.treynor = out.beta ? (Q.mean(rets) * ANN - (opts.rf ?? 0.02)) / out.beta : NaN;
    out.corrBench = Q.corr(rets, bench);
    out.benchCagr = Math.pow(Q.equity(bench)[n], 1 / yrs) - 1;
    out.upCapture = capture(rets, bench, true);
    out.downCapture = capture(rets, bench, false);
  }
  return out;
};
function capture(r, b, up) {
  let sr = 0, sb = 0, k = 0;
  for (let i = 0; i < r.length; i++) if (up ? b[i] > 0 : b[i] < 0) { sr += r[i]; sb += b[i]; k++; }
  return k && sb ? sr / sb : NaN;
}
/* Deflated Sharpe-style haircut: prob that observed SR beats 0 given skew/kurt (Bailey-López de Prado PSR) */
Q.psr = function (rets, srBench = 0) {
  const p = Q.perf(rets); if (!p) return NaN;
  const sr = p.sharpe / Math.sqrt(ANN);           // per-period SR
  const n = rets.length, g3 = p.skew || 0, g4 = p.kurt || 0;
  const z = (sr - srBench / Math.sqrt(ANN)) * Math.sqrt(n - 1) / Math.sqrt(1 - g3 * sr + (g4) / 4 * sr * sr || 1);
  return Q.normCdf(z);
};
Q.normCdf = function (z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};

/* ---------- backtester ----------
   positions: array (single asset, weight in [-L, L]) or matrix {sym: weights[]}
   aligned with rets. Signals must already be lagged by caller (use yesterday's info). */
Q.backtest = function (positions, rets, opts = {}) {
  const costBps = opts.costBps ?? 5;             // one-way cost per unit turnover
  const n = rets.length;
  const port = new Array(n).fill(0);
  let turnover = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const w = positions[i] || 0;
    const to = Math.abs(w - prev);
    turnover += to;
    port[i] = w * rets[i] - to * costBps / 1e4;
    prev = w;
  }
  return { rets: port, turnover: turnover / (n / ANN), avgExposure: Q.mean(positions.map(Math.abs)) };
};
Q.backtestMulti = function (weights, retCols, opts = {}) {
  // weights: {sym: number[]}, retCols: {sym: number[]}, all aligned length n
  const costBps = opts.costBps ?? 5;
  const syms = Object.keys(weights);
  const n = retCols[syms[0]].length;
  const port = new Array(n).fill(0);
  let turnover = 0;
  const prev = {};
  for (let i = 0; i < n; i++) {
    let to = 0, r = 0;
    for (const s of syms) {
      const w = weights[s][i] || 0;
      to += Math.abs(w - (prev[s] || 0));
      r += w * (retCols[s][i] || 0);
      prev[s] = w;
    }
    turnover += to;
    port[i] = r - to * costBps / 1e4;
  }
  return { rets: port, turnover: turnover / (n / ANN) };
};
/* lag a signal by k days (trade next day) */
Q.lag = function (a, k = 1) {
  const out = new Array(a.length).fill(0);
  for (let i = k; i < a.length; i++) out[i] = isFinite(a[i - k]) ? a[i - k] : 0;
  return out;
};

/* ---------- regime detection ---------- */
/* 2-state Gaussian HMM on daily returns, EM fit (vol regimes) */
Q.hmm2 = function (rets, iters = 30) {
  const n = rets.length;
  let mu = [Q.mean(rets), Q.mean(rets)];
  let sd = [Q.std(rets) * 0.6, Q.std(rets) * 1.8];
  let A = [[0.97, 0.03], [0.03, 0.97]];
  let pi = [0.5, 0.5];
  const dens = (x, k) => Math.exp(-0.5 * ((x - mu[k]) / sd[k]) ** 2) / (sd[k] * 2.5066) + 1e-300;
  let gamma;
  for (let it = 0; it < iters; it++) {
    // forward-backward (scaled)
    const alpha = [], beta = [], c = [];
    let a0 = [pi[0] * dens(rets[0], 0), pi[1] * dens(rets[0], 1)];
    let c0 = a0[0] + a0[1]; c.push(c0); alpha.push([a0[0] / c0, a0[1] / c0]);
    for (let t = 1; t < n; t++) {
      const p = alpha[t - 1];
      const a = [
        (p[0] * A[0][0] + p[1] * A[1][0]) * dens(rets[t], 0),
        (p[0] * A[0][1] + p[1] * A[1][1]) * dens(rets[t], 1)];
      const ct = a[0] + a[1]; c.push(ct);
      alpha.push([a[0] / ct, a[1] / ct]);
    }
    beta[n - 1] = [1, 1];
    for (let t = n - 2; t >= 0; t--) {
      const b = beta[t + 1];
      beta[t] = [
        (A[0][0] * dens(rets[t + 1], 0) * b[0] + A[0][1] * dens(rets[t + 1], 1) * b[1]) / c[t + 1],
        (A[1][0] * dens(rets[t + 1], 0) * b[0] + A[1][1] * dens(rets[t + 1], 1) * b[1]) / c[t + 1]];
    }
    gamma = alpha.map((a, t) => {
      const g = [a[0] * beta[t][0], a[1] * beta[t][1]];
      const s = g[0] + g[1]; return [g[0] / s, g[1] / s];
    });
    // M step
    for (const k of [0, 1]) {
      const w = gamma.map(g => g[k]);
      const sw = Q.sum(w);
      mu[k] = Q.sum(rets.map((r, t) => r * w[t])) / sw;
      sd[k] = Math.sqrt(Q.sum(rets.map((r, t) => w[t] * (r - mu[k]) ** 2)) / sw) || 1e-6;
    }
    // transition update (approximate using xi)
    let x00 = 0, x01 = 0, x10 = 0, x11 = 0;
    for (let t = 0; t < n - 1; t++) {
      const den = c[t + 1];
      const e00 = alpha[t][0] * A[0][0] * dens(rets[t + 1], 0) * beta[t + 1][0] / den;
      const e01 = alpha[t][0] * A[0][1] * dens(rets[t + 1], 1) * beta[t + 1][1] / den;
      const e10 = alpha[t][1] * A[1][0] * dens(rets[t + 1], 0) * beta[t + 1][0] / den;
      const e11 = alpha[t][1] * A[1][1] * dens(rets[t + 1], 1) * beta[t + 1][1] / den;
      x00 += e00; x01 += e01; x10 += e10; x11 += e11;
    }
    A = [[x00 / (x00 + x01), x01 / (x00 + x01)], [x10 / (x10 + x11), x11 / (x10 + x11)]];
    pi = gamma[0];
  }
  const calm = sd[0] < sd[1] ? 0 : 1;
  return {
    probCalm: gamma.map(g => g[calm]),
    states: gamma.map(g => (g[calm] > 0.5 ? 'calm' : 'stress')),
    mu, sd, A, calmIdx: calm,
  };
};
/* Composite market regime from real data: trend + vol + curve + credit */
Q.marketRegime = function () {
  const spy = AL.returns('SPY');
  const px = AL.getSeries('SPY').values;
  const n = px.length;
  const sma200 = Q.sma(px, 200)[n - 1];
  const trend = px[n - 1] > sma200 ? 1 : -1;
  const vol20 = Q.std(spy.values.slice(-20)) * Math.sqrt(ANN);
  const vol252 = Q.std(spy.values.slice(-252)) * Math.sqrt(ANN);
  const vix = AL.getSeries('^VIX'); const vixNow = vix.values[vix.values.length - 1];
  const curve = AL.getSeries('T10Y2Y'); const curveNow = curve ? curve.values[curve.values.length - 1] : null;
  const hy = AL.getSeries('BAMLH0A0HYM2'); const hyNow = hy ? hy.values[hy.values.length - 1] : null;
  const hmm = Q.hmm2(spy.values.slice(-1000));
  const pCalm = hmm.probCalm[hmm.probCalm.length - 1];
  let label, tone;
  if (trend > 0 && pCalm > 0.6) { label = 'RISK-ON / LOW-VOL BULL'; tone = 'good'; }
  else if (trend > 0) { label = 'VOLATILE BULL'; tone = 'warn'; }
  else if (pCalm > 0.6) { label = 'QUIET CORRECTION'; tone = 'warn'; }
  else { label = 'RISK-OFF / HIGH-VOL BEAR'; tone = 'bad'; }
  return { label, tone, trend, vol20, vol252, vix: vixNow, curve: curveNow, hySpread: hyNow, pCalm, hmm };
};

/* ---------- covariance & optimizers ---------- */
Q.covMatrix = function (cols, syms, lookback) {
  const k = syms.length;
  const M = Array.from({ length: k }, () => new Array(k).fill(0));
  const data = syms.map(s => lookback ? cols[s].slice(-lookback) : cols[s]);
  for (let i = 0; i < k; i++)
    for (let j = i; j < k; j++) {
      const c = Q.cov(data[i], data[j]) * ANN;
      M[i][j] = c; M[j][i] = c;
    }
  return M;
};
Q.corrMatrix = function (cols, syms, lookback) {
  const k = syms.length;
  const M = Array.from({ length: k }, () => new Array(k).fill(1));
  const data = syms.map(s => lookback ? cols[s].slice(-lookback) : cols[s]);
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const c = Q.corr(data[i], data[j]);
      M[i][j] = c; M[j][i] = c;
    }
  return M;
};
function matVec(M, v) { return M.map(row => row.reduce((s, x, j) => s + x * v[j], 0)); }
function dot(a, b) { return a.reduce((s, x, i) => s + x * b[i], 0); }
Q.portVol = (w, C) => Math.sqrt(Math.max(dot(w, matVec(C, w)), 0));
/* long-only projected-gradient minimum variance */
Q.minVar = function (C) {
  const k = C.length;
  let w = new Array(k).fill(1 / k);
  for (let it = 0; it < 500; it++) {
    const g = matVec(C, w);
    w = w.map((x, i) => x - 0.5 / (it + 10) * g[i] / (Math.abs(C[i][i]) + 1e-9));
    w = project(w);
  }
  return w;
};
function project(w) { // onto simplex (long-only, sum 1)
  w = w.map(x => Math.max(x, 0));
  const s = Q.sum(w);
  return s > 0 ? w.map(x => x / s) : w.map(() => 1 / w.length);
}
/* Equal Risk Contribution via cyclical coordinate descent */
Q.erc = function (C) {
  const k = C.length;
  let w = new Array(k).fill(1 / k);
  for (let it = 0; it < 200; it++) {
    const Cw = matVec(C, w);
    const sig = Math.sqrt(Math.max(dot(w, Cw), 1e-12));
    for (let i = 0; i < k; i++) {
      // target: w_i * (Cw)_i = sig^2 / k
      w[i] = (sig * sig / k) / Math.max(Cw[i], 1e-10);
    }
    const s = Q.sum(w); w = w.map(x => x / s);
  }
  return w;
};
/* Hierarchical Risk Parity (López de Prado): corr-distance single-linkage + quasi-diag + recursive bisection */
Q.hrp = function (C, R) {
  const k = C.length;
  // distance matrix
  const D = R.map(row => row.map(c => Math.sqrt(Math.max(0.5 * (1 - c), 0))));
  // single-linkage clustering
  let clusters = Array.from({ length: k }, (_, i) => [i]);
  const dist = (A, B) => Math.min(...A.flatMap(a => B.map(b => D[a][b])));
  const order = [];
  while (clusters.length > 1) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i], clusters[j]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }
  const leafOrder = clusters[0];
  // recursive bisection with inverse-variance allocation
  const w = new Array(k).fill(1);
  const ivp = (items) => {
    const iv = items.map(i => 1 / Math.max(C[i][i], 1e-10));
    const s = Q.sum(iv);
    return items.map((_, j) => iv[j] / s);
  };
  const clusterVar = (items) => {
    const cw = ivp(items);
    let v = 0;
    for (let a = 0; a < items.length; a++)
      for (let b = 0; b < items.length; b++) v += cw[a] * cw[b] * C[items[a]][items[b]];
    return v;
  };
  const bisect = (items) => {
    if (items.length <= 1) return;
    const mid = Math.floor(items.length / 2);
    const L = items.slice(0, mid), Rt = items.slice(mid);
    const vL = clusterVar(L), vR = clusterVar(Rt);
    const aL = 1 - vL / (vL + vR);
    L.forEach(i => w[i] *= aL);
    Rt.forEach(i => w[i] *= 1 - aL);
    bisect(L); bisect(Rt);
  };
  bisect(leafOrder);
  const s = Q.sum(w);
  return w.map(x => x / s);
};
/* Max Sharpe via projected gradient on Sharpe surrogate */
Q.maxSharpe = function (mu, C) {
  const k = mu.length;
  let w = new Array(k).fill(1 / k);
  for (let it = 0; it < 800; it++) {
    const Cw = matVec(C, w);
    const v = Math.max(dot(w, Cw), 1e-10);
    const m = dot(w, mu);
    // grad of m/sqrt(v)
    const g = mu.map((mi, i) => (mi * v - m * Cw[i]) / Math.pow(v, 1.5));
    w = w.map((x, i) => x + 0.02 / Math.sqrt(it + 1) * g[i]);
    w = project(w);
  }
  return w;
};
/* Black-Litterman-lite: blend market-implied returns (from cap-proxy weights) with user views */
Q.blackLitterman = function (C, wMkt, views, tau = 0.05) {
  // implied returns: Pi = delta * C * wMkt   (delta = 2.5)
  const Pi = matVec(C, wMkt).map(x => 2.5 * x);
  const mu = Pi.slice();
  // views: [{idx, ret, conf}] absolute view on asset idx
  for (const v of views) {
    const varI = tau * C[v.idx][v.idx];
    const k = varI / (varI + (1 - v.conf + 0.01) * C[v.idx][v.idx]);
    mu[v.idx] = mu[v.idx] + k * (v.ret - mu[v.idx]);
  }
  return { implied: Pi, blended: mu };
};
Q.kellyFraction = function (rets) {
  const m = Q.mean(rets), v = Q.std(rets) ** 2;
  return v ? m / v : 0; // continuous Kelly for log-wealth
};
/* Efficient frontier sampling */
Q.frontier = function (mu, C, steps = 25) {
  const pts = [];
  for (let t = 0; t <= steps; t++) {
    const lam = t / steps * 40;              // risk-aversion sweep
    const k = mu.length;
    let w = new Array(k).fill(1 / k);
    for (let it = 0; it < 400; it++) {
      const g = mu.map((mi, i) => mi - lam * matVec(C, w)[i]);
      w = w.map((x, i) => x + 0.01 * g[i]);
      w = project(w);
    }
    pts.push({ w, ret: dot(w, mu), vol: Q.portVol(w, C) });
  }
  return pts;
};
/* Monte Carlo: block bootstrap of real return history */
Q.monteCarlo = function (rets, horizon, paths, seed = 42, blockLen = 10) {
  const rand = AL.rng(seed);
  const out = [];
  for (let p = 0; p < paths; p++) {
    const path = new Array(horizon);
    let i = 0;
    while (i < horizon) {
      const start = Math.floor(rand() * (rets.length - blockLen));
      for (let j = 0; j < blockLen && i < horizon; j++, i++) path[i] = rets[start + j];
    }
    out.push(Q.equity(path));
  }
  return out;
};
Q.fanChart = function (paths, quantiles = [0.05, 0.25, 0.5, 0.75, 0.95]) {
  const h = paths[0].length;
  const bands = quantiles.map(() => new Array(h));
  for (let t = 0; t < h; t++) {
    const vals = paths.map(p => p[t]);
    quantiles.forEach((q, i) => bands[i][t] = Q.quantile(vals, q));
  }
  return bands;
};
