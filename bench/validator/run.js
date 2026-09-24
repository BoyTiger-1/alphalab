/* Validate-the-validator benchmark (see PROTOCOL.md, frozen before the main run).
   Loads the real data bundle and the AlphaLab engines exactly as the smoke test does, then feeds
   deliberately overfit strategies and unselected controls through the UNMODIFIED gauntlet
   (S.validate in app/strategies.js). The harness only adds: a placebo signal engine, a date
   truncation wrapper (so the sealed holdout is invisible to selection and to the gauntlet),
   seeded strategy generators, and raw-output logging.

   usage: node bench/validator/run.js --out <dir>      main run (all arms, all variants)
          node bench/validator/run.js --out <dir> --dry  execution check only: disjoint seed,
                                                         tiny sizes, prints counts and timing only */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
if (!OUT) { console.error('missing --out <dir>'); process.exit(2); }

// ---------- frozen configuration (mirrors PROTOCOL.md section 9) ----------
const CFG = {
  master: 'FQ-VV-2026-09-24',
  assets: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'],
  from: '2006-01-01',
  researchEnd: '2021-12-31',
  holdoutStart: '2022-01-01',
  costBps: 5,
  isFrac: 0.7,                   // the gauntlet's own IS/OOS split, used to place the M1 selection end
  armA: { R: 200, Ks: [1, 20, 200] },
  armB: { R: 5, K: 200 },
  robustR: 100,
  variants: [                    // Arm A robustness variants, K=200 only, both modes
    { id: 'S1a-cost0', costBps: 0 },
    { id: 'S1b-cost10', costBps: 10 },
    { id: 'S2-grid2', grid: 'G2' },
    { id: 'S3-seed2', master: 'FQ-VV-2026-09-24-alt' },
    { id: 'S4-from2010', from: '2010-01-01' },
  ],
};
if (DRY) {
  CFG.master = 'DRY-not-for-analysis';
  CFG.armA = { R: 2, Ks: [1, 5] };
  CFG.armB = { R: 1, K: 5 };
  CFG.robustR = 1;
  CFG.variants = CFG.variants.slice(0, 1);
}

// ---------- load the app headless (same stubs and file list as tools/smoke.js) ----------
global.window = global;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { createElement: () => ({ innerHTML: '', content: { firstChild: null }, style: {} }), body: {}, getElementById: () => null };
global.performance = { now: () => Date.now() };
const LOADED = ['data/bundle.js', 'app/core.js', 'app/quant.js', 'app/factors.js', 'app/ml.js', 'app/strategies.js', 'app/mlzoo.js', 'app/registry.js', 'app/researcher.js'];
for (const f of LOADED) new Function(fs.readFileSync(path.join(ROOT, f), 'utf-8'))();
AL.boot();

// ---------- seeded randomness ----------
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = key => mulberry32(fnv1a(key));
const randInt = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
function gauss(rnd) {
  let u = 0; while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// ---------- placebo engine: an SMA crossover on a seeded random walk, traded long/short ----------
// The walk depends only on p.seed (a string, so the gauntlet's perturbation step leaves it alone)
// and on the bar index, so it is identical under every truncation that shares the start date.
// Its true edge on any asset is zero by construction.
S.engines.vvPlacebo = function (px, rets, p) {
  const rnd = rngFor('walk|' + p.seed);
  const w = new Array(px.length);
  let x = 0;
  for (let i = 0; i < px.length; i++) { x += gauss(rnd); w[i] = x; }
  const f = Q.sma(w, p.fast), s = Q.sma(w, p.slow);
  return w.map((_, i) => !isFinite(f[i]) || !isFinite(s[i]) ? 0 : (f[i] > s[i] ? 1 : -1));
};

// ---------- truncation: everything the engines read is cut at END ----------
let END = null;
const _getSeries = AL.getSeries;
const tcache = new Map();
AL.getSeries = function (sym) {
  const s = _getSeries.call(AL, sym);
  if (!END || !s || !s.dates) return s;
  const key = sym + '|' + END;
  if (tcache.has(key)) return tcache.get(key);
  let k = s.dates.length;
  while (k > 0 && s.dates[k - 1] > END) k--;
  const t = { ...s, dates: s.dates.slice(0, k), values: s.values.slice(0, k) };
  tcache.set(key, t);
  return t;
};
function withEnd(end, fn) { const prev = END; END = end; try { return fn(); } finally { END = prev; } }

// ---------- generators ----------
const GRIDS = {
  // placebo SMA windows
  G1: rnd => { const fast = randInt(rnd, 3, 100); return { fast, slow: randInt(rnd, fast + 5, 400) }; },
  G2: rnd => { const fast = randInt(rnd, 2, 50); return { fast, slow: randInt(rnd, fast + 2, 200) }; },
};
const FAMILIES = {   // Arm B: real rule families, long-only, canonical params from the literature / registry
  smaCross: { canonical: { fast: 50, slow: 200 }, draw: rnd => { const fast = randInt(rnd, 3, 100); return { fast, slow: randInt(rnd, fast + 5, 400) }; } },
  donchian: { canonical: { n: 55 }, draw: rnd => ({ n: randInt(rnd, 5, 250) }) },
  rsiRev:   { canonical: { n: 2, lo: 10, hi: 90 }, draw: rnd => ({ n: randInt(rnd, 2, 30), lo: randInt(rnd, 5, 45), hi: randInt(rnd, 55, 95) }) },
  tsMom:    { canonical: { n: 252, skip: 21 }, draw: rnd => ({ n: randInt(rnd, 20, 300), skip: randInt(rnd, 0, 30) }) },
};
if (DRY) { for (const k of ['donchian', 'rsiRev', 'tsMom']) delete FAMILIES[k]; }

const mkEntry = (id, sym, engine, params, v) => ({ id, name: id, def: { kind: 'single', sym, engine, params }, cost: v.costBps, bench: 'SPY', from: v.from });

function selEndFor(v, mode) {
  if (mode === 'M2') return CFG.researchEnd;
  const d = AL.window(_getSeries.call(AL, 'SPY'), v.from, CFG.researchEnd).dates;
  return d[Math.floor(CFG.isFrac * d.length) - 1];
}

function selSharpe(entry, v, selEnd) {
  return withEnd(selEnd, () => {
    const r = S.run(entry, { from: v.from });
    if (!r || !r.stats) return NaN;
    if (r.dates[r.dates.length - 1] > selEnd) throw new Error('truncation leak in selection');
    return r.stats.sharpe;
  });
}

// run K candidates on the selection window, keep the best by Sharpe (first index wins ties)
function selectBest(cands, v, selEnd) {
  const sh = cands.map(c => selSharpe(c, v, selEnd));
  let b = -1;
  sh.forEach((x, i) => { if (isFinite(x) && (b < 0 || x > sh[b])) b = i; });
  return { best: b < 0 ? 0 : b, trialSharpes: sh };
}

const r6 = x => (typeof x === 'number' && isFinite(x)) ? Math.round(x * 1e6) / 1e6 : null;

function gauntlet(entry, v) {
  return withEnd(CFG.researchEnd, () => {
    const g = S.validate(entry, { from: v.from });
    if (!g) return null;
    if (g.full.dates[g.full.dates.length - 1] > CFG.researchEnd) throw new Error('truncation leak in gauntlet');
    const n = g.full.rets.length, cut = Math.floor(n * 0.7);
    const pert = g.perturbed.map(p => p.sharpe);
    return {
      verdict: g.verdict,
      fullSharpe: r6(g.full.stats.sharpe), isSharpe: r6(g.is && g.is.sharpe), oosSharpe: r6(g.oos && g.oos.sharpe),
      psr: r6(g.psr), cost3Sharpe: r6(g.cost2 && g.cost2.sharpe),
      pertMedian: r6(pert.length ? Q.quantile(pert, 0.5) : g.full.stats.sharpe),
      perturbed: g.perturbed.map(p => ({ param: p.param, mult: p.mult, sharpe: r6(p.sharpe) })),
      posYears: r6(g.posYears), start: g.full.dates[0], oosStart: g.full.dates[cut], end: g.full.dates[n - 1],
      turnover: r6(g.full.turnover),
    };
  });
}

function holdout(entry, v) {
  return withEnd(null, () => {
    const r = S.run(entry, { from: v.from });
    const i0 = r.dates.findIndex(d => d >= CFG.holdoutStart);
    const p = i0 >= 0 ? Q.perf(r.rets.slice(i0)) : null;
    return p ? { sharpe: r6(p.sharpe), cagr: r6(p.cagr), n: p.n, start: r.dates[i0], end: r.dates[r.dates.length - 1] } : null;
  });
}

// ---------- output ----------
fs.mkdirSync(OUT, { recursive: true });
const recPath = path.join(OUT, 'records.jsonl');
fs.writeFileSync(recPath, '');
let nRec = 0;
const emit = rec => { fs.appendFileSync(recPath, JSON.stringify(rec) + '\n'); nRec++; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
let gitSha = null;
try { gitSha = require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch (e) { }
const t0 = Date.now();
const manifest = {
  dry: DRY, cfg: CFG, started: new Date(t0).toISOString(), node: process.version, git: gitSha,
  sha256: Object.fromEntries([...LOADED, 'bench/validator/run.js', 'bench/validator/analyze.js'].map(f => [f, sha(f)])),
  dataAsof: AL.asof,
};

// ---------- Arm A: placebo, known zero edge ----------
function armA(v, Ks, R, modes) {
  for (const K of Ks) {
    const ms = K === 1 ? ['none'] : modes;
    for (const mode of ms) {
      const selEnd = K === 1 ? null : selEndFor(v, mode);
      for (let rep = 0; rep < R; rep++) {
        const key = `${v.master}|A|${v.id}|K${K}|${mode}|r${rep}`;
        const rnd = rngFor(key);
        const asset = CFG.assets[rep % CFG.assets.length];
        const cands = [];
        for (let t = 0; t < K; t++) {
          const p = GRIDS[v.grid](rnd);
          cands.push(mkEntry(`A-${rep}-${t}`, asset, 'vvPlacebo', { ...p, seed: `${key}|t${t}` }, v));
        }
        const sel = K === 1 ? { best: 0, trialSharpes: [] } : selectBest(cands, v, selEnd);
        const e = cands[sel.best];
        emit({
          arm: 'A', variant: v.id, mode, K, rep, key, asset, from: v.from, selEnd, costBps: v.costBps, grid: v.grid,
          params: e.def.params, selSharpe: r6(sel.trialSharpes[sel.best]), trialSharpes: sel.trialSharpes.map(r6),
          gauntlet: gauntlet(e, v), holdout: holdout(e, v),
        });
      }
      process.stderr.write(`A ${v.id} K=${K} ${mode}: ${nRec} records, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
  }
}

// ---------- Arm B: real rule families, unknown edge, sealed holdout as ground truth ----------
function armB(v) {
  for (const [fam, F] of Object.entries(FAMILIES)) {
    for (const asset of (DRY ? ['SPY'] : CFG.assets)) {
      const ce = mkEntry(`B-${fam}-${asset}-canon`, asset, fam, { ...F.canonical }, v);
      emit({ arm: 'B', variant: v.id, mode: 'none', K: 1, rep: 0, family: fam, asset, from: v.from, costBps: v.costBps,
        params: ce.def.params, canonical: true, gauntlet: gauntlet(ce, v), holdout: holdout(ce, v) });
      for (const mode of ['M1', 'M2']) {
        const selEnd = selEndFor(v, mode);
        for (let rep = 0; rep < CFG.armB.R; rep++) {
          const key = `${v.master}|B|${fam}|${asset}|${mode}|r${rep}`;
          const rnd = rngFor(key);
          const cands = [];
          for (let t = 0; t < CFG.armB.K; t++) cands.push(mkEntry(`B-${fam}-${asset}-${t}`, asset, fam, F.draw(rnd), v));
          const sel = selectBest(cands, v, selEnd);
          const e = cands[sel.best];
          emit({ arm: 'B', variant: v.id, mode, K: CFG.armB.K, rep, key, family: fam, asset, from: v.from, selEnd, costBps: v.costBps,
            params: e.def.params, canonical: false, selSharpe: r6(sel.trialSharpes[sel.best]), trialSharpes: sel.trialSharpes.map(r6),
            gauntlet: gauntlet(e, v), holdout: holdout(e, v) });
        }
      }
      process.stderr.write(`B ${fam} ${asset}: ${nRec} records, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
  }
}

const base = { id: 'primary', master: CFG.master, from: CFG.from, costBps: CFG.costBps, grid: 'G1' };
armA(base, CFG.armA.Ks, CFG.armA.R, ['M1', 'M2']);
armB(base);
for (const s of CFG.variants) armA({ ...base, ...s }, [DRY ? 5 : 200], CFG.robustR, ['M1', 'M2']);

manifest.finished = new Date().toISOString();
manifest.seconds = Math.round((Date.now() - t0) / 1000);
manifest.records = nRec;
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
// deliberately prints no verdicts or rates: the analysis lives in analyze.js
console.log(`done: ${nRec} records in ${manifest.seconds}s -> ${OUT}`);
