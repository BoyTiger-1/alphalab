/* AlphaLab Alpha Discovery Engine: generates candidate quantitative factors from
   a transformation grammar, then runs each through an IC/robustness gauntlet
   before admission to the factor library. All on real data. */
'use strict';
const F = window.F = {};

/* ---------- feature grammar ---------- */
F.transforms = [
  { id: 'mom', name: n => `${n}d momentum`, needs: 'px', fn: (px, r, n) => Q.momentum(px, n) },
  { id: 'momskip', name: n => `${n}d momentum (1w skip)`, needs: 'px', fn: (px, r, n) => Q.momentum(px, n, 5) },
  { id: 'rev', name: n => `−${n}d return (reversal)`, needs: 'px', fn: (px, r, n) => Q.momentum(px, n).map(x => -x) },
  { id: 'zpx', name: n => `${n}d price z-score`, needs: 'px', fn: (px, r, n) => Q.zscores(px, n) },
  { id: 'vol', name: n => `${n}d realized vol`, needs: 'r', fn: (px, r, n) => Q.rollStd(r, n) },
  { id: 'volchg', name: n => `${n}d vol change`, needs: 'r', fn: (px, r, n) => {
    const v = Q.rollStd(r, n); return v.map((x, i) => i >= n && v[i - n] ? x / v[i - n] - 1 : NaN); } },
  { id: 'rsi', name: n => `RSI(${n})`, needs: 'px', fn: (px, r, n) => Q.rsi(px, n).map(x => (x - 50) / 50) },
  { id: 'smadist', name: n => `distance from ${n}d SMA`, needs: 'px', fn: (px, r, n) => {
    const s = Q.sma(px, n); return px.map((x, i) => s[i] ? x / s[i] - 1 : NaN); } },
  { id: 'dd', name: n => `drawdown from ${n}d high`, needs: 'px', fn: (px, r, n) => px.map((x, i) => {
    if (i < n) return NaN; return x / Math.max(...px.slice(i - n, i + 1)) - 1; }) },
  { id: 'skew', name: n => `${n}d return skew`, needs: 'r', fn: (px, r, n) => {
    const out = new Array(r.length).fill(NaN);
    for (let i = n; i < r.length; i++) out[i] = Q.skew(r.slice(i - n, i));
    return out; } },
  { id: 'sharpe', name: n => `${n}d rolling Sharpe`, needs: 'r', fn: (px, r, n) => {
    const out = new Array(r.length).fill(NaN);
    for (let i = n; i < r.length; i++) { const w = r.slice(i - n, i); const s = Q.std(w); out[i] = s ? Q.mean(w) / s : 0; }
    return out; } },
  { id: 'corrtlt', name: n => `${n}d corr to bonds`, needs: 'aux', aux: 'TLT', fn: (px, r, n, aux) => Q.rollCorr(r, aux, n) },
  { id: 'corrgld', name: n => `${n}d corr to gold`, needs: 'aux', aux: 'GLD', fn: (px, r, n, aux) => Q.rollCorr(r, aux, n) },
  { id: 'betaspy', name: n => `${n}d beta to market`, needs: 'aux', aux: 'SPY', fn: (px, r, n, aux) => Q.rollBeta(r, aux, n) },
  { id: 'vixz', name: n => `VIX ${n}d z-score`, needs: 'vix', fn: (px, r, n, aux) => Q.zscores(aux, n) },
  { id: 'vixlvl', name: () => 'VIX level (scaled)', needs: 'vix', fn: (px, r, n, aux) => aux.map(v => v ? (v - 20) / 10 : NaN) },
];
F.windows = [5, 10, 21, 42, 63, 126, 252];
F.postOps = [
  { id: 'raw', name: '', fn: a => a },
  { id: 'z63', name: ' → 63d z-score', fn: a => Q.zscores(a.map(x => isFinite(x) ? x : 0), 63) },
  { id: 'sign', name: ' → sign', fn: a => a.map(x => isFinite(x) ? Math.sign(x) : NaN) },
  { id: 'sq', name: ' → signed square', fn: a => a.map(x => isFinite(x) ? Math.sign(x) * x * x : NaN) },
];

/* build one factor series for a symbol */
F.compute = function (spec, sym) {
  const s = AL.getSeries(sym);
  const w = AL.window(s, '2004-01-01');
  const px = w.values, dates = w.dates;
  const rets = px.map((v, i) => i ? v / px[i - 1] - 1 : 0);
  const tr = F.transforms.find(t => t.id === spec.t);
  let aux = null;
  if (tr.needs === 'aux') {
    const a = AL.getSeries(tr.aux);
    const m = new Map(a.dates.map((d, i) => [d, a.values[i]]));
    let lastPx = null, prevPx = null;
    aux = dates.map(d => { if (m.has(d)) { prevPx = lastPx; lastPx = m.get(d); } return prevPx && lastPx ? lastPx / prevPx - 1 : 0; });
  } else if (tr.needs === 'vix') {
    const a = AL.getSeries('^VIX');
    const m = new Map(a.dates.map((d, i) => [d, a.values[i]]));
    let last = null;
    aux = dates.map(d => { if (m.has(d)) last = m.get(d); return last; });
  }
  let vals = tr.fn(px, rets, spec.n, aux);
  const post = F.postOps.find(p => p.id === spec.post);
  vals = post.fn(vals);
  return { dates, values: vals, px, rets };
};

F.name = spec => {
  const tr = F.transforms.find(t => t.id === spec.t);
  const post = F.postOps.find(p => p.id === spec.post);
  return tr.name(spec.n) + post.name;
};
F.key = spec => `${spec.t}_${spec.n}_${spec.post}`;

/* random factor spec */
F.randomSpec = function (rand) {
  const tr = F.transforms[Math.floor(rand() * F.transforms.length)];
  const n = F.windows[Math.floor(rand() * F.windows.length)];
  const post = F.postOps[Math.floor(rand() * F.postOps.length)];
  return { t: tr.id, n, post: post.id };
};

/* ---------- evaluation gauntlet ----------
   Time-series IC: spearman(factor_t, forward h-day return) on one symbol.
   Cross-symbol robustness: same factor evaluated on several symbols. */
F.evaluate = function (spec, syms, horizon = 5) {
  const per = [];
  for (const sym of syms) {
    try {
      const f = F.compute(spec, sym);
      const n = f.values.length;
      const fwd = new Array(n).fill(NaN);
      for (let i = 0; i < n - horizon; i++) fwd[i] = f.px[i + horizon] / f.px[i] - 1;
      // usable points
      const xs = [], ys = [], idx = [];
      for (let i = 0; i < n - horizon; i++)
        if (isFinite(f.values[i]) && isFinite(fwd[i])) { xs.push(f.values[i]); ys.push(fwd[i]); idx.push(i); }
      if (xs.length < 300) continue;
      const cut = Math.floor(xs.length * 0.7);
      const ic = Q.spearman(xs, ys);
      const icIS = Q.spearman(xs.slice(0, cut), ys.slice(0, cut));
      const icOOS = Q.spearman(xs.slice(cut), ys.slice(cut));
      // IC t-stat via yearly sub-samples
      const chunks = [];
      for (let c = 0; c + 252 < xs.length; c += 252) chunks.push(Q.spearman(xs.slice(c, c + 252), ys.slice(c, c + 252)));
      const icT = chunks.length > 2 ? Q.tstat(chunks.filter(isFinite)) : NaN;
      // decay profile
      const decay = [1, 5, 10, 21].map(h => {
        const yy = [];
        const xx = [];
        for (let i = 0; i < n - h; i++)
          if (isFinite(f.values[i])) { xx.push(f.values[i]); yy.push(f.px[i + h] / f.px[i] - 1); }
        return { h, ic: Q.spearman(xx, yy) };
      });
      // quantile spread: top-quintile minus bottom-quintile forward return
      const ranked = idx.map((i, k) => ({ x: xs[k], y: ys[k] })).sort((a, b) => a.x - b.x);
      const q = Math.floor(ranked.length / 5);
      const spread = Q.mean(ranked.slice(-q).map(r => r.y)) - Q.mean(ranked.slice(0, q).map(r => r.y));
      per.push({ sym, ic, icIS, icOOS, icT, decay, spread, nObs: xs.length });
    } catch (e) { /* symbol lacks data for this factor */ }
  }
  if (!per.length) return null;
  const avgIC = Q.mean(per.map(p => p.ic));
  const consistency = per.filter(p => Math.sign(p.ic) === Math.sign(avgIC)).length / per.length;
  const avgOOS = Q.mean(per.map(p => p.icOOS).filter(isFinite));
  const verdict =
    Math.abs(avgIC) > 0.03 && consistency >= 0.7 && Math.sign(avgOOS) === Math.sign(avgIC) && Math.abs(avgOOS) > 0.015
      ? 'ADMITTED' : Math.abs(avgIC) > 0.02 && Math.sign(avgOOS) === Math.sign(avgIC) ? 'WATCHLIST' : 'REJECTED';
  return { spec, name: F.name(spec), key: F.key(spec), horizon, per, avgIC, avgOOS, consistency, verdict };
};

/* correlation of a new factor with library factors (multicollinearity filter) */
F.redundancy = function (spec, librarySpecs, sym = 'SPY') {
  const f = F.compute(spec, sym);
  let maxCorr = 0, against = null;
  for (const ls of librarySpecs) {
    if (F.key(ls) === F.key(spec)) return { maxCorr: 1, against: F.name(ls) };
    try {
      const g = F.compute(ls, sym);
      const n = Math.min(f.values.length, g.values.length);
      const xs = [], ys = [];
      for (let i = 0; i < n; i++)
        if (isFinite(f.values[i]) && isFinite(g.values[i])) { xs.push(f.values[i]); ys.push(g.values[i]); }
      const c = Math.abs(Q.corr(xs, ys));
      if (c > maxCorr) { maxCorr = c; against = F.name(ls); }
    } catch (e) {}
  }
  return { maxCorr, against };
};

/* library persistence */
F.library = () => AL.store.get('factor_library', []);
F.saveLibrary = lib => AL.store.set('factor_library', lib);
F.addToLibrary = function (evalResult, redundancy) {
  const lib = F.library();
  if (lib.some(f => f.key === evalResult.key)) return false;
  lib.push({
    key: evalResult.key, spec: evalResult.spec, name: evalResult.name,
    avgIC: evalResult.avgIC, avgOOS: evalResult.avgOOS, consistency: evalResult.consistency,
    horizon: evalResult.horizon, verdict: evalResult.verdict,
    maxCorr: redundancy ? redundancy.maxCorr : null,
    added: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });
  F.saveLibrary(lib);
  return true;
};
