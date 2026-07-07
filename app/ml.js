/* AlphaLab ML laboratory: models trained in-browser with walk-forward validation.
   Ridge (closed form), logistic & MLP (SGD), gradient-boosted stumps, k-NN,
   k-means, PCA, permutation importance. */
'use strict';
const ML = window.ML = {};

/* ---------- feature engineering ---------- */
ML.makeFeatures = function (sym, horizon = 5, from = '2005-01-01') {
  const s = AL.getSeries(sym);
  const w = AL.window(s, from);
  const px = w.values, dates = w.dates;
  const r = px.map((v, i) => i ? v / px[i - 1] - 1 : 0);
  const vixS = AL.getSeries('^VIX');
  const vmap = new Map(vixS.dates.map((d, i) => [d, vixS.values[i]]));
  let lv = 20; const vix = dates.map(d => { if (vmap.has(d)) lv = vmap.get(d); return lv; });
  const curveS = AL.getSeries('T10Y2Y');
  let curve = null;
  if (curveS) {
    const cmap = new Map(curveS.dates.map((d, i) => [d, curveS.values[i]]));
    let lc = 0; curve = dates.map(d => { if (cmap.has(d)) lc = cmap.get(d); return lc; });
  }
  const defs = [
    ['mom21', Q.momentum(px, 21)],
    ['mom63', Q.momentum(px, 63)],
    ['mom126', Q.momentum(px, 126)],
    ['mom252', Q.momentum(px, 252, 21)],
    ['rev5', Q.momentum(px, 5).map(x => -x)],
    ['vol21', Q.rollStd(r, 21).map(x => x * Math.sqrt(252))],
    ['volChg', (() => { const v = Q.rollStd(r, 21); return v.map((x, i) => i >= 21 && v[i - 21] ? x / v[i - 21] - 1 : NaN); })()],
    ['rsi14', Q.rsi(px, 14).map(x => (x - 50) / 50)],
    ['smaDist', (() => { const m = Q.sma(px, 200); return px.map((x, i) => m[i] ? x / m[i] - 1 : NaN); })()],
    ['dd63', px.map((x, i) => i < 63 ? NaN : x / Math.max(...px.slice(i - 63, i + 1)) - 1)],
    ['vixLvl', vix.map(v => (v - 20) / 10)],
    ['vixZ', Q.zscores(vix, 63)],
    ['dow', dates.map(d => (new Date(d + 'T12:00:00Z').getUTCDay() - 3) / 2)],
    ['skew63', (() => { const o = new Array(r.length).fill(NaN); for (let i = 63; i < r.length; i++) o[i] = Q.skew(r.slice(i - 63, i)); return o; })()],
  ];
  if (curve) defs.push(['curve', curve.map(c => c)]);
  const names = defs.map(d => d[0]);
  const n = px.length;
  const X = [], y = [], keptDates = [], keptIdx = [];
  for (let i = 0; i < n - horizon; i++) {
    const row = defs.map(d => d[1][i]);
    if (row.some(v => v == null || !isFinite(v))) continue;
    X.push(row);
    y.push(px[i + horizon] / px[i] - 1);
    keptDates.push(dates[i]); keptIdx.push(i);
  }
  return { X, y, names, dates: keptDates, idx: keptIdx, px, allDates: dates, horizon, sym };
};

/* standardize columns using training stats */
function colStats(X) {
  const k = X[0].length;
  const mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (let j = 0; j < k; j++) {
    const col = X.map(r => r[j]);
    mu[j] = Q.mean(col); sd[j] = Q.std(col) || 1;
  }
  return { mu, sd };
}
function standardize(X, st) { return X.map(r => r.map((v, j) => (v - st.mu[j]) / st.sd[j])); }

/* ---------- models ---------- */
ML.models = {
  ridge: {
    name: 'Ridge Regression',
    fit(X, y, p = {}) {
      const lam = p.lambda ?? 1;
      const k = X[0].length;
      // normal equations (X'X + lam I) b = X'y with intercept
      const A = Array.from({ length: k + 1 }, () => new Array(k + 2).fill(0));
      for (const [ri, row] of X.entries()) {
        const xr = [1, ...row];
        for (let i = 0; i <= k; i++) {
          for (let j = 0; j <= k; j++) A[i][j] += xr[i] * xr[j];
          A[i][k + 1] += xr[i] * y[ri];
        }
      }
      for (let i = 1; i <= k; i++) A[i][i] += lam * X.length / 100;
      const b = gauss(A);
      return { b, predict: Xn => Xn.map(row => b[0] + row.reduce((s, v, j) => s + v * b[j + 1], 0)) };
    },
  },
  logistic: {
    name: 'Logistic Classifier',
    fit(X, y, p = {}) {
      const k = X[0].length;
      const yb = y.map(v => v > 0 ? 1 : 0);
      let w = new Array(k + 1).fill(0);
      const lr = p.lr ?? 0.05, epochs = p.epochs ?? 60, lam = 0.001;
      for (let e = 0; e < epochs; e++) {
        const g = new Array(k + 1).fill(0);
        for (let i = 0; i < X.length; i++) {
          const z = w[0] + X[i].reduce((s, v, j) => s + v * w[j + 1], 0);
          const pr = 1 / (1 + Math.exp(-z));
          const err = pr - yb[i];
          g[0] += err;
          for (let j = 0; j < k; j++) g[j + 1] += err * X[i][j] + lam * w[j + 1];
        }
        for (let j = 0; j <= k; j++) w[j] -= lr * g[j] / X.length;
      }
      return { w, predict: Xn => Xn.map(row => { const z = w[0] + row.reduce((s, v, j) => s + v * w[j + 1], 0); return 2 / (1 + Math.exp(-z)) - 1; }) };
    },
  },
  gbm: {
    name: 'Gradient-Boosted Stumps',
    fit(X, y, p = {}) {
      const rounds = p.rounds ?? 60, lr = p.lr ?? 0.1;
      const k = X[0].length, n = X.length;
      const base = Q.mean(y);
      let pred = new Array(n).fill(base);
      const stumps = [];
      for (let t = 0; t < rounds; t++) {
        const resid = y.map((v, i) => v - pred[i]);
        let best = null;
        for (let j = 0; j < k; j++) {
          // candidate thresholds: quartiles of the feature
          const col = X.map(r => r[j]);
          for (const q of [0.25, 0.5, 0.75]) {
            const thr = Q.quantile(col, q);
            let sL = 0, nL = 0, sR = 0, nR = 0;
            for (let i = 0; i < n; i++) { if (col[i] <= thr) { sL += resid[i]; nL++; } else { sR += resid[i]; nR++; } }
            if (nL < 20 || nR < 20) continue;
            const mL = sL / nL, mR = sR / nR;
            const gain = nL * mL * mL + nR * mR * mR;
            if (!best || gain > best.gain) best = { j, thr, mL, mR, gain };
          }
        }
        if (!best) break;
        stumps.push(best);
        for (let i = 0; i < n; i++) pred[i] += lr * (X[i][best.j] <= best.thr ? best.mL : best.mR);
      }
      const predictOne = row => base + lr * stumps.reduce((s, st) => s + (row[st.j] <= st.thr ? st.mL : st.mR), 0);
      return { stumps, base, predict: Xn => Xn.map(predictOne) };
    },
  },
  knn: {
    name: 'k-NN Pattern Matcher',
    fit(X, y, p = {}) {
      const k = p.k ?? 25;
      return {
        predict: Xn => Xn.map(row => {
          const d = X.map((xr, i) => ({ i, d: xr.reduce((s, v, j) => s + (v - row[j]) ** 2, 0) }));
          d.sort((a, b) => a.d - b.d);
          return Q.mean(d.slice(0, k).map(x => y[x.i]));
        }),
      };
    },
  },
  mlp: {
    name: 'Neural Net (1 hidden layer)',
    fit(X, y, p = {}) {
      const H = p.hidden ?? 12, epochs = p.epochs ?? 40, lr = p.lr ?? 0.01;
      const k = X[0].length;
      const rand = AL.rng(p.seed ?? 7);
      let W1 = Array.from({ length: H }, () => Array.from({ length: k + 1 }, () => (rand() - 0.5) * 0.5));
      let W2 = Array.from({ length: H + 1 }, () => (rand() - 0.5) * 0.5);
      const fwd = row => {
        const h = W1.map(wr => Math.tanh(wr[0] + row.reduce((s, v, j) => s + v * wr[j + 1], 0)));
        return { h, out: W2[0] + h.reduce((s, v, j) => s + v * W2[j + 1], 0) };
      };
      const n = X.length;
      for (let e = 0; e < epochs; e++) {
        for (let step = 0; step < n; step++) {
          const i = Math.floor(rand() * n);
          const { h, out } = fwd(X[i]);
          const err = out - y[i];
          W2[0] -= lr * err;
          for (let j = 0; j < H; j++) {
            const gh = err * W2[j + 1] * (1 - h[j] * h[j]);
            W2[j + 1] -= lr * err * h[j];
            W1[j][0] -= lr * gh;
            for (let f = 0; f < k; f++) W1[j][f + 1] -= lr * gh * X[i][f];
          }
        }
      }
      return { predict: Xn => Xn.map(row => fwd(row).out) };
    },
  },
};
function gauss(A) { // solve augmented [n x n+1]
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
    [A[i], A[mx]] = [A[mx], A[i]];
    const piv = A[i][i] || 1e-10;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / piv;
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[n] / (row[i] || 1e-10));
}

/* ---------- walk-forward engine ---------- */
ML.walkForward = function (feat, modelId, p = {}) {
  const { X, y, dates } = feat;
  const minTrain = p.minTrain ?? 750, refit = p.refit ?? 63;
  const preds = new Array(X.length).fill(NaN);
  let model = null, st = null, fitAt = -minTrain;
  const folds = [];
  for (let i = minTrain; i < X.length; i++) {
    if (i - fitAt >= refit) {
      const Xtr = X.slice(0, i), ytr = y.slice(0, i);
      st = colStats(Xtr);
      const Xs = standardize(Xtr, st);
      if (modelId === 'ensemble') {
        model = ['ridge', 'logistic', 'gbm', 'knn'].map(m => ML.models[m].fit(Xs, ytr, p));
      } else {
        model = ML.models[modelId].fit(Xs, ytr, p);
      }
      fitAt = i;
      folds.push({ at: dates[i], trainN: i });
    }
    const xr = standardize([X[i]], st);
    if (modelId === 'ensemble') {
      const ps = model.map(m => m.predict(xr)[0]);
      const signs = ps.map(Math.sign);
      preds[i] = Q.mean(signs) * Math.min(Math.abs(Q.mean(ps)), 1);
    } else {
      preds[i] = model.predict(xr)[0];
    }
  }
  return { preds, folds, minTrain };
};

/* diagnostics: IC of predictions, hit rate, quantile analysis */
ML.diagnostics = function (feat, preds) {
  const pairs = [];
  for (let i = 0; i < preds.length; i++)
    if (isFinite(preds[i])) pairs.push({ p: preds[i], a: feat.y[i], d: feat.dates[i] });
  if (pairs.length < 100) return null;
  const ic = Q.spearman(pairs.map(x => x.p), pairs.map(x => x.a));
  const hit = pairs.filter(x => Math.sign(x.p) === Math.sign(x.a)).length / pairs.length;
  const ranked = pairs.slice().sort((a, b) => a.p - b.p);
  const q = Math.floor(ranked.length / 5);
  const quintiles = Array.from({ length: 5 }, (_, i) =>
    Q.mean(ranked.slice(i * q, (i + 1) * q).map(x => x.a)));
  return { ic, hit, quintiles, n: pairs.length, pairs };
};

/* permutation importance (on last 30% OOS-ish segment) */
ML.permImportance = function (feat, modelId, p = {}) {
  const { X, y, names } = feat;
  const cut = Math.floor(X.length * 0.7);
  const st = colStats(X.slice(0, cut));
  const model = ML.models[modelId === 'ensemble' ? 'ridge' : modelId].fit(standardize(X.slice(0, cut), st), y.slice(0, cut), p);
  const Xte = standardize(X.slice(cut), st), yte = y.slice(cut);
  const baseIC = Q.spearman(model.predict(Xte), yte);
  const rand = AL.rng(11);
  return names.map((nm, j) => {
    const Xp = Xte.map(r => r.slice());
    // shuffle column j
    for (let i = Xp.length - 1; i > 0; i--) {
      const k2 = Math.floor(rand() * (i + 1));
      [Xp[i][j], Xp[k2][j]] = [Xp[k2][j], Xp[i][j]];
    }
    const ic = Q.spearman(model.predict(Xp), yte);
    return { feature: nm, importance: baseIC - ic };
  }).sort((a, b) => b.importance - a.importance);
};

/* ---------- strategy adapter (used by S.run for kind:'ml') ---------- */
ML._stratCache = new Map();
ML.runStrategy = function (entry, opts = {}) {
  const def = entry.def;
  const key = entry.id + JSON.stringify(opts.params || {}) + (opts.costBps || '');
  if (ML._stratCache.has(key)) return ML._stratCache.get(key);
  const feat = ML.makeFeatures(def.sym, def.horizon, entry.from || '2005-01-01');
  const wf = ML.walkForward(feat, def.model, opts.params || {});
  // map predictions back to full price axis
  const n = feat.px.length;
  const sig = new Array(n).fill(0);
  const scale = Q.std(wf.preds.filter(isFinite)) || 1e-4;
  feat.idx.forEach((pi, i) => {
    if (isFinite(wf.preds[i])) sig[pi] = Math.max(-1, Math.min(1, wf.preds[i] / (2 * scale)));
  });
  const rets = feat.px.map((v, i) => i ? v / feat.px[i - 1] - 1 : 0);
  const lagged = Q.lag(sig, 1);
  const bt = Q.backtest(lagged, rets, { costBps: opts.costBps ?? entry.cost ?? 5 });
  // benchmark
  const benchSym = entry.bench || 'SPY';
  const b = AL.getSeries(benchSym);
  const bmap = new Map(b.dates.map((d, i) => [d, b.values[i]]));
  const bpx = []; let lastB = null;
  for (const d of feat.allDates) { if (bmap.has(d)) lastB = bmap.get(d); bpx.push(lastB); }
  const bench = bpx.map((v, i) => i && bpx[i - 1] ? v / bpx[i - 1] - 1 : 0);
  let start = lagged.findIndex(x => Math.abs(x) > 1e-9);
  if (start < 1) start = 1;
  const out = {
    entry, dates: feat.allDates.slice(start), rets: bt.rets.slice(start), bench: bench.slice(start),
    benchSym, stats: Q.perf(bt.rets.slice(start), { bench: bench.slice(start) }),
    bstats: Q.perf(bench.slice(start)),
    equity: Q.equity(bt.rets.slice(start)), benchEquity: Q.equity(bench.slice(start)),
    exposure: lagged.slice(start), turnover: bt.turnover, costBps: opts.costBps ?? entry.cost ?? 5,
    mlDiag: ML.diagnostics(feat, wf.preds), feat, wf,
  };
  ML._stratCache.set(key, out);
  return out;
};

/* ---------- unsupervised: k-means & PCA ---------- */
ML.kmeans = function (X, k, seed = 3) {
  const rand = AL.rng(seed);
  const n = X.length, d = X[0].length;
  let cents = Array.from({ length: k }, () => X[Math.floor(rand() * n)].slice());
  let assign = new Array(n).fill(0);
  for (let it = 0; it < 50; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let j = 0; j < d; j++) s += (X[i][j] - cents[c][j]) ** 2;
        if (s < bd) { bd = s; bi = c; }
      }
      if (assign[i] !== bi) { assign[i] = bi; changed = true; }
    }
    for (let c = 0; c < k; c++) {
      const mem = X.filter((_, i) => assign[i] === c);
      if (mem.length) cents[c] = Array.from({ length: d }, (_, j) => Q.mean(mem.map(r => r[j])));
    }
    if (!changed) break;
  }
  return { assign, cents };
};
ML.pca = function (X, nComp = 2) {
  const n = X.length, d = X[0].length;
  const mu = Array.from({ length: d }, (_, j) => Q.mean(X.map(r => r[j])));
  const Xc = X.map(r => r.map((v, j) => v - mu[j]));
  const comps = [], evs = [];
  let R = Xc;
  for (let c = 0; c < nComp; c++) {
    let v = Array.from({ length: d }, () => Math.random() - 0.5);
    for (let it = 0; it < 60; it++) {
      // v = R'R v
      const Rv = R.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
      const w = Array.from({ length: d }, (_, j) => R.reduce((s, r, i) => s + r[j] * Rv[i], 0));
      const nm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      v = w.map(x => x / nm);
    }
    const scores = R.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
    evs.push(Q.std(scores) ** 2);
    comps.push(v);
    R = R.map((r, i) => r.map((x, j) => x - scores[i] * v[j]));
  }
  const totVar = Array.from({ length: d }, (_, j) => Q.std(Xc.map(r => r[j])) ** 2).reduce((a, b) => a + b, 0);
  return { comps, evs, explained: evs.map(e => e / totVar), project: (row) => comps.map(v => row.map((x, j) => x - mu[j]).reduce((s, x, j) => s + x * v[j], 0)) };
};
