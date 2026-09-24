/* Analysis for the validate-the-validator benchmark. Written and frozen together with PROTOCOL.md,
   before the main run. Reads records.jsonl, computes the preregistered endpoints, applies the
   numerical decision rule, and writes summary.json next to the raw records.

   usage: node bench/validator/analyze.js <results dir> */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
if (!DIR) { console.error('usage: analyze.js <results dir>'); process.exit(2); }
const recs = fs.readFileSync(path.join(DIR, 'records.jsonl'), 'utf-8').split('\n').filter(Boolean).map(JSON.parse);

// ---------- preregistered constants (PROTOCOL.md section 5 and 6) ----------
const FVR_BAR = 0.10;          // tolerated false-validation rate on zero-edge strategies
const MC1_MAX_HOLDOUT = 0.20;  // mean sealed-holdout Sharpe above this means the placebo leaks
const Z = 1.959964;

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const fin = a => a.filter(x => typeof x === 'number' && isFinite(x));
function wilson(x, n) {
  if (!n) return [NaN, NaN];
  const p = x / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d;
  const h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function newcombe(x1, n1, x2, n2) {           // CI for p1 - p2, Newcombe hybrid score (method 10)
  const p1 = x1 / n1, p2 = x2 / n2, [l1, u1] = wilson(x1, n1), [l2, u2] = wilson(x2, n2);
  const d = p1 - p2;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)];
}
function ranks(a) {
  const idx = a.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  const ok = x.map((v, i) => [v, y[i]]).filter(([a, b]) => isFinite(a) && isFinite(b));
  if (ok.length < 3) return NaN;
  const rx = ranks(ok.map(p => p[0])), ry = ranks(ok.map(p => p[1]));
  const mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const isVal = r => r.gauntlet && r.gauntlet.verdict === 'VALIDATED';
const isNotRej = r => r.gauntlet && r.gauntlet.verdict !== 'REJECTED';

function rate(rs, pred) {
  const x = rs.filter(pred).length, n = rs.length;
  return { x, n, p: n ? x / n : NaN, ci95: wilson(x, n) };
}
function decide(r) {                            // PROTOCOL.md section 6
  if (!r.n) return 'NO DATA';
  if (r.ci95[1] <= FVR_BAR) return 'DETECTS';
  if (r.p > FVR_BAR) return 'MISSES';
  return 'INCONCLUSIVE';
}
// which gauntlet checks a record fails (the verdict needs all five for VALIDATED)
function fails(g) {
  return {
    oos: !(g.oosSharpe > 0.3), full: !(g.fullSharpe > 0.5), psr: !(g.psr > 0.85),
    cost3: !(g.cost3Sharpe > 0), perturb: !(g.pertMedian > 0.3 * g.fullSharpe),
  };
}
function checkRates(rs) {
  const out = {};
  for (const k of ['oos', 'full', 'psr', 'cost3', 'perturb']) out[k] = rs.length ? rs.filter(r => r.gauntlet && fails(r.gauntlet)[k]).length / rs.length : NaN;
  return out;
}

const S = { generatedAt: new Date().toISOString(), n: recs.length, missingGauntlet: recs.filter(r => !r.gauntlet).length };

// ---------- Arm A, primary ----------
const A = recs.filter(r => r.arm === 'A' && r.variant === 'primary');
const ctrl = A.filter(r => r.K === 1);
S.armA = { control: { fvr: rate(ctrl, isVal), notRejected: rate(ctrl, isNotRej), failRates: checkRates(ctrl) } };
for (const mode of ['M1', 'M2']) {
  const m = {};
  for (const K of [...new Set(A.filter(r => r.K > 1).map(r => r.K))].sort((a, b) => a - b)) {
    const rs = A.filter(r => r.mode === mode && r.K === K);
    m['K' + K] = {
      fvr: rate(rs, isVal), notRejected: rate(rs, isNotRej), failRates: checkRates(rs),
      meanSelSharpe: mean(fin(rs.map(r => r.selSharpe))),
      meanGauntletFull: mean(fin(rs.map(r => r.gauntlet && r.gauntlet.fullSharpe))),
      meanGauntletOos: mean(fin(rs.map(r => r.gauntlet && r.gauntlet.oosSharpe))),
      meanHoldout: mean(fin(rs.map(r => r.holdout && r.holdout.sharpe))),
    };
  }
  const top = A.filter(r => r.mode === mode && r.K === Math.max(...A.map(q => q.K)));
  const f = rate(top, isVal);
  m.decision = decide(f);
  m.inflationVsControl = { diff: f.p - S.armA.control.fvr.p, ci95: newcombe(f.x, f.n, S.armA.control.fvr.x, S.armA.control.fvr.n) };
  S.armA[mode] = m;
}

// ---------- manipulation checks (PROTOCOL.md section 7) ----------
const topK = Math.max(...A.map(r => r.K));
const topA = A.filter(r => r.K === topK);
S.checks = {
  MC1_placeboHoldoutMean: mean(fin(topA.map(r => r.holdout && r.holdout.sharpe))),
  MC2_m1OosAfterSelection: A.filter(r => r.mode === 'M1').every(r => r.gauntlet && r.gauntlet.oosStart > r.selEnd),
  MC4_selectionInflates: ['M1', 'M2'].every(mode => {
    const a = mean(fin(A.filter(r => r.mode === mode && r.K === topK).map(r => r.gauntlet && r.gauntlet.fullSharpe)));
    const b = mean(fin(ctrl.map(r => r.gauntlet && r.gauntlet.fullSharpe)));
    return a > b;
  }),
};
S.checks.MC1_ok = S.checks.MC1_placeboHoldoutMean <= MC1_MAX_HOLDOUT;
S.valid = S.checks.MC1_ok && S.checks.MC2_m1OosAfterSelection && S.checks.MC4_selectionInflates && S.missingGauntlet === 0;

// ---------- robustness variants ----------
S.robustness = {};
for (const v of [...new Set(recs.filter(r => r.arm === 'A' && r.variant !== 'primary').map(r => r.variant))]) {
  S.robustness[v] = {};
  for (const mode of ['M1', 'M2']) {
    const rs = recs.filter(r => r.arm === 'A' && r.variant === v && r.mode === mode);
    const f = rate(rs, isVal);
    S.robustness[v][mode] = { fvr: f, decision: decide(f), agreesWithPrimary: decide(f) === S.armA[mode].decision };
  }
}
S.stable = Object.values(S.robustness).every(v => v.M1.agreesWithPrimary && v.M2.agreesWithPrimary);

// ---------- headline (PROTOCOL.md section 6) ----------
S.headline = !S.valid ? 'INVALID BENCHMARK (a manipulation check failed; no conclusion drawn)'
  : (S.armA.M1.decision === 'DETECTS' && S.armA.M2.decision === 'DETECTS')
    ? (S.stable ? 'GAUNTLET RELIABLY REJECTS OVERFIT STRATEGIES' : 'GAUNTLET REJECTS OVERFIT STRATEGIES, BUT NOT STABLY ACROSS CHECKS')
    : `GAUNTLET DOES NOT RELIABLY REJECT OVERFIT STRATEGIES (M1: ${S.armA.M1.decision}, M2: ${S.armA.M2.decision})${S.stable ? '' : ', decisions unstable across checks'}`;

// ---------- Arm B, exploratory ----------
const B = recs.filter(r => r.arm === 'B');
S.armB = { canonical: { fvr: rate(B.filter(r => r.canonical), isVal), meanHoldout: mean(fin(B.filter(r => r.canonical).map(r => r.holdout && r.holdout.sharpe))) } };
for (const mode of ['M1', 'M2']) {
  const rs = B.filter(r => r.mode === mode);
  const pool = rs.concat(B.filter(r => r.canonical));
  S.armB[mode] = {
    validated: rate(rs, isVal), failRates: checkRates(rs),
    meanSelSharpe: mean(fin(rs.map(r => r.selSharpe))), meanHoldout: mean(fin(rs.map(r => r.holdout && r.holdout.sharpe))),
    holdoutIfValidated: mean(fin(pool.filter(isVal).map(r => r.holdout && r.holdout.sharpe))),
    holdoutIfNot: mean(fin(pool.filter(r => !isVal(r)).map(r => r.holdout && r.holdout.sharpe))),
    spearmanOosVsHoldout: spearman(pool.map(r => r.gauntlet ? r.gauntlet.oosSharpe : NaN), pool.map(r => r.holdout ? r.holdout.sharpe : NaN)),
  };
}

fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(S, null, 2));

// ---------- report ----------
const pct = x => isFinite(x) ? (100 * x).toFixed(1) + '%' : 'n/a';
const ci = c => `[${pct(c[0])}, ${pct(c[1])}]`;
const f2 = x => isFinite(x) ? x.toFixed(2) : 'n/a';
console.log(`records: ${S.n}   valid benchmark: ${S.valid}   stable: ${S.stable}`);
console.log(`\nARM A (placebo, zero true edge): false-validation rate`);
console.log(`  control K=1     ${pct(S.armA.control.fvr.p)} ${ci(S.armA.control.fvr.ci95)}  n=${S.armA.control.fvr.n}`);
for (const mode of ['M1', 'M2']) for (const [k, v] of Object.entries(S.armA[mode])) if (k[0] === 'K')
  console.log(`  ${mode} ${k.padEnd(5)}      ${pct(v.fvr.p)} ${ci(v.fvr.ci95)}  n=${v.fvr.n}  selSR ${f2(v.meanSelSharpe)}  oosSR ${f2(v.meanGauntletOos)}  holdoutSR ${f2(v.meanHoldout)}`);
for (const mode of ['M1', 'M2']) console.log(`  ${mode} decision: ${S.armA[mode].decision}   inflation vs control ${pct(S.armA[mode].inflationVsControl.diff)} ${ci(S.armA[mode].inflationVsControl.ci95)}`);
console.log(`\nMANIPULATION CHECKS  MC1 placebo holdout mean ${f2(S.checks.MC1_placeboHoldoutMean)} (ok ${S.checks.MC1_ok})  MC2 ${S.checks.MC2_m1OosAfterSelection}  MC4 ${S.checks.MC4_selectionInflates}`);
console.log(`\nROBUSTNESS`);
for (const [v, o] of Object.entries(S.robustness)) console.log(`  ${v.padEnd(12)} M1 ${pct(o.M1.fvr.p)} ${o.M1.decision}   M2 ${pct(o.M2.fvr.p)} ${o.M2.decision}`);
console.log(`\nARM B (real rule families, exploratory)`);
console.log(`  canonical  validated ${pct(S.armB.canonical.fvr.p)} n=${S.armB.canonical.fvr.n}  holdoutSR ${f2(S.armB.canonical.meanHoldout)}`);
for (const mode of ['M1', 'M2']) { const b = S.armB[mode]; console.log(`  ${mode} overfit validated ${pct(b.validated.p)} n=${b.validated.n}  selSR ${f2(b.meanSelSharpe)}  holdoutSR ${f2(b.meanHoldout)}  holdout|VAL ${f2(b.holdoutIfValidated)}  holdout|not ${f2(b.holdoutIfNot)}  rho(oos,holdout) ${f2(b.spearmanOosVsHoldout)}`); }
console.log(`\nHEADLINE: ${S.headline}`);
