/* AlphaLab autonomous researcher: continuously generates hypotheses, runs
   experiments through a validation gauntlet, records everything in a persistent
   research database, and writes institutional-style reports. */
'use strict';
const RS = window.RS = {};

/* ---------- research database ---------- */
RS.db = () => AL.store.get('research_db', { experiments: [], seq: 0 });
RS.saveDb = db => AL.store.set('research_db', db);
RS.kb = () => AL.store.get('knowledge_base', { triedKeys: {}, notes: [], regimeHistory: [] });
RS.saveKb = kb => AL.store.set('knowledge_base', kb);

RS.log = [];
RS.pushLog = function (msg, kind = 'info') {
  RS.log.push({ t: new Date().toTimeString().slice(0, 8), msg, kind });
  if (RS.log.length > 400) RS.log.shift();
  AL.bus.emit('res:log');
};

/* ---------- hypothesis generation ---------- */
const HYPO_TEMPLATES = {
  strategy: e => `H: The methodology “${e.name}” (${e.cat}) captures a persistent, cost-surviving inefficiency. Null: risk-adjusted returns are indistinguishable from zero after transaction costs.`,
  factor: name => `H: The engineered signal “${name}” carries predictive information for forward returns (|IC| > 0.03, stable out-of-sample). Null: rank correlation with forward returns is zero.`,
  pair: (a, b) => `H: ${a} and ${b} share a common stochastic trend (cointegration) and spread dislocations mean-revert tradeably. Null: the spread is non-stationary.`,
  ensemble: names => `H: Combining validated sleeves [${names.join(', ')}] at inverse-vol weights improves the risk-adjusted profile beyond the best single sleeve (diversification of alpha).`,
};

RS.candidatePairs = [
  ['V', 'MA'], ['JPM', 'BAC'], ['XOM', 'CVX'], ['GLD', 'SLV'], ['HD', 'WMT'], ['KO', 'PG'],
  ['SPY', 'DIA'], ['QQQ', 'XLK'], ['TLT', 'IEF'], ['EFA', 'EEM'], ['VTV', 'VUG'], ['HYG', 'LQD'],
  ['AAPL', 'MSFT'], ['USO', 'XLE'], ['GC=F', 'SI=F'], ['XLP', 'XLY'], ['VNQ', 'TLT'], ['NVDA', 'AMD'],
];

RS.rand = AL.rng(Date.now() % 100000);

RS.generateHypothesis = function () {
  const kb = RS.kb();
  const roll = RS.rand();
  // 45% strategy, 30% factor, 15% pair, 10% ensemble
  if (roll < 0.45) {
    const pool = S.registry.filter(e => e.status === 'ok' && !kb.triedKeys['strat:' + e.id]);
    if (pool.length) {
      const e = pool[Math.floor(RS.rand() * pool.length)];
      return { kind: 'strategy', key: 'strat:' + e.id, entry: e, title: e.name, hypothesis: HYPO_TEMPLATES.strategy(e) };
    }
  }
  if (roll < 0.75) {
    for (let tries = 0; tries < 30; tries++) {
      const spec = F.randomSpec(RS.rand);
      const key = 'factor:' + F.key(spec);
      if (!RS.kb().triedKeys[key]) {
        return { kind: 'factor', key, spec, title: 'Factor: ' + F.name(spec), hypothesis: HYPO_TEMPLATES.factor(F.name(spec)) };
      }
    }
  }
  if (roll < 0.9) {
    const untried = RS.candidatePairs.filter(p => !kb.triedKeys['pair:' + p.join('-')]);
    if (untried.length) {
      const p = untried[Math.floor(RS.rand() * untried.length)];
      return { kind: 'pair', key: 'pair:' + p.join('-'), syms: p, title: `Cointegration: ${p[0]} / ${p[1]}`, hypothesis: HYPO_TEMPLATES.pair(p[0], p[1]) };
    }
  }
  // ensemble of validated findings
  const db = RS.db();
  const validated = db.experiments.filter(e => e.verdict === 'VALIDATED' && e.kind === 'strategy').slice(-12);
  if (validated.length >= 2) {
    const k = 2 + Math.floor(RS.rand() * Math.min(3, validated.length - 1));
    const pick = validated.sort(() => RS.rand() - 0.5).slice(0, k);
    const key = 'ens:' + pick.map(p => p.subject).sort().join('+');
    if (!kb.triedKeys[key]) {
      return { kind: 'ensemble', key, ids: pick.map(p => p.subject), title: 'Ensemble: ' + pick.map(p => S.byId[p.subject]?.name || p.subject).join(' + '), hypothesis: HYPO_TEMPLATES.ensemble(pick.map(p => S.byId[p.subject]?.name || p.subject)) };
    }
  }
  // fallback: retest a random strategy with perturbed params
  const pool = S.registry.filter(e => e.status === 'ok');
  const e = pool[Math.floor(RS.rand() * pool.length)];
  return { kind: 'strategy', key: 'strat:' + e.id + ':' + Math.floor(RS.rand() * 1e6), entry: e, title: e.name + ' (revisit)', hypothesis: HYPO_TEMPLATES.strategy(e) };
};

/* ---------- experiment pipeline ---------- */
RS.state = { running: false, current: null, stage: null, count: 0 };

RS.STAGES = ['Design', 'Data audit', 'Execution', 'Validation gauntlet', 'Verdict & filing'];

RS.startAuto = function () {
  if (RS.state.running) return;
  RS.state.running = true;
  RS.pushLog('Autonomous research loop engaged, generating hypotheses from live market structure.', 'sys');
  AL.bus.emit('res:update');
  RS._next();
};
RS.stopAuto = function () {
  RS.state.running = false;
  RS.pushLog('Research loop paused by operator.', 'sys');
  AL.bus.emit('res:update');
};
RS._next = function () {
  if (!RS.state.running) return;
  setTimeout(() => { try { RS.runExperiment(RS.generateHypothesis(), () => setTimeout(() => RS._next(), 2500)); } catch (e) { console.error(e); RS.pushLog('Experiment crashed: ' + e.message, 'bad'); setTimeout(() => RS._next(), 2500); } }, 400);
};

RS.runExperiment = function (hypo, done) {
  const db = RS.db();
  const id = 'EXP-' + String(++db.seq).padStart(4, '0');
  const exp = {
    id, ts: new Date().toISOString().slice(0, 16).replace('T', ' '), kind: hypo.kind,
    title: hypo.title, hypothesis: hypo.hypothesis, subject: hypo.entry ? hypo.entry.id : (hypo.key || ''),
    status: 'running', stage: 0, verdict: null, metrics: {}, key: hypo.key,
    regime: Q.marketRegime().label,
  };
  db.experiments.push(exp);
  RS.saveDb(db);
  RS.state.current = exp;
  RS.pushLog(`${id} · NEW HYPOTHESIS, ${hypo.title}`, 'hypo');
  AL.bus.emit('res:update');

  const advance = (stage, fn, delay = 350) => setTimeout(() => {
    exp.stage = stage;
    RS.pushLog(`${id} · ${RS.STAGES[stage]}…`);
    AL.bus.emit('res:update');
    try { fn(); } catch (e) {
      console.error(e);
      exp.status = 'error'; exp.verdict = 'ERROR'; exp.error = e.message;
      RS._file(exp); done && done();
    }
  }, delay);

  advance(1, () => { // data audit
    exp.dataNote = RS._dataAudit(hypo);
    advance(2, () => { // execution
      const res = RS._execute(hypo, exp);
      advance(3, () => { // validation
        RS._validate(hypo, exp, res);
        advance(4, () => { // verdict & filing
          RS._file(exp);
          RS.pushLog(`${id} · VERDICT: ${exp.verdict}, ${exp.summary || ''}`, exp.verdict === 'VALIDATED' ? 'good' : exp.verdict === 'REJECTED' ? 'bad' : 'warn');
          done && done();
        }, 300);
      }, 400);
    }, 400);
  });
};

RS._dataAudit = function (hypo) {
  if (hypo.kind === 'strategy') {
    const def = hypo.entry.def;
    const syms = def.kind === 'single' ? [def.sym] : def.kind === 'pair' ? def.syms : def.kind === 'ml' ? [def.sym] : def.universe;
    const spans = syms.map(s => { const ser = AL.getSeries(s); return `${s}: ${ser.dates[0]}→${ser.dates[ser.dates.length - 1]} (${ser.values.length} obs)`; });
    return spans.join('; ');
  }
  if (hypo.kind === 'pair') return hypo.syms.map(s => { const ser = AL.getSeries(s); return `${s}: ${ser.values.length} obs`; }).join('; ');
  if (hypo.kind === 'factor') return 'Evaluation universe: ' + RS.factorUniverse.join(', ');
  return 'Constituent sleeves previously validated on bundled real data.';
};

RS.factorUniverse = ['SPY', 'QQQ', 'IWM', 'EFA', 'TLT', 'GLD', 'XLE', 'XLF', 'XLK', 'AAPL', 'MSFT', 'JPM'];

RS._execute = function (hypo, exp) {
  if (hypo.kind === 'strategy') {
    const val = S.validate(hypo.entry);
    exp.metrics = RS._metricsFromVal(val);
    return val;
  }
  if (hypo.kind === 'factor') {
    const ev = F.evaluate(hypo.spec, RS.factorUniverse, 5);
    if (ev) {
      exp.metrics = { avgIC: ev.avgIC, oosIC: ev.avgOOS, consistency: ev.consistency, universeN: ev.per.length };
    }
    return ev;
  }
  if (hypo.kind === 'pair') {
    const entry = {
      id: 'ADHOC', cat: 'Stat Arb / Pairs', name: hypo.title, cost: 6, bench: 'SPY', status: 'ok',
      def: { kind: 'pair', syms: hypo.syms, engine: 'pairsZ', params: { win: 126, entry: 2, exit: 0.5 } },
    };
    const val = S.validate(entry);
    exp.metrics = RS._metricsFromVal(val);
    if (val && val.full.coint) {
      exp.metrics.adf = val.full.coint.adf;
      exp.metrics.halflife = val.full.coint.halflife;
      exp.metrics.hedge = val.full.coint.hedge;
    }
    exp.adhocEntry = entry;
    return val;
  }
  if (hypo.kind === 'ensemble') {
    const runs = hypo.ids.map(sid => S.run(S.byId[sid])).filter(r => r && r.stats);
    if (runs.length < 2) return null;
    // align on common dates, inverse-vol weights
    const common = runs.reduce((acc, r) => { const set = new Set(r.dates); return acc ? acc.filter(d => set.has(d)) : r.dates.slice(); }, null);
    const dmaps = runs.map(r => new Map(r.dates.map((d, i) => [d, r.rets[i]])));
    const cols = runs.map(m => common.map(d => dmaps[runs.indexOf(runs.find((_, i) => dmaps[i] === m))]));
    const sleeves = runs.map((r, i) => common.map(d => dmaps[i].get(d) ?? 0));
    const vols = sleeves.map(a => Q.std(a) || 1e-4);
    const iv = vols.map(v => 1 / v); const tot = Q.sum(iv);
    const w = iv.map(x => x / tot);
    const comb = common.map((_, t) => sleeves.reduce((s, a, i) => s + w[i] * a[t], 0));
    const bench = runs[0].bench.slice(-common.length);
    const stats = Q.perf(comb, { bench });
    const bestSingle = Math.max(...runs.map(r => r.stats.sharpe));
    exp.metrics = { sharpe: stats.sharpe, maxDD: stats.maxDD, cagr: stats.cagr, bestSingleSharpe: bestSingle, sleeves: runs.length };
    // pairwise sleeve correlation
    let maxC = -1;
    for (let i = 0; i < sleeves.length; i++)
      for (let j = i + 1; j < sleeves.length; j++) maxC = Math.max(maxC, Q.corr(sleeves[i], sleeves[j]));
    exp.metrics.maxSleeveCorr = maxC;
    return { stats, bestSingle, weights: w, ids: hypo.ids };
  }
  return null;
};
RS._metricsFromVal = function (val) {
  if (!val || !val.full || !val.full.stats) return {};
  const s = val.full.stats;
  return {
    sharpe: s.sharpe, cagr: s.cagr, maxDD: s.maxDD, sortino: s.sortino, vol: s.vol,
    oosSharpe: val.oos ? val.oos.sharpe : null, isSharpe: val.is ? val.is.sharpe : null,
    psr: val.psr, turnover: val.full.turnover, posYears: val.posYears,
    alpha: s.alpha, beta: s.beta, ir: s.ir,
  };
};

RS._validate = function (hypo, exp, res) {
  if (hypo.kind === 'strategy' || hypo.kind === 'pair') {
    exp.verdict = res ? res.verdict : 'ERROR';
    exp.gauntlet = res ? {
      oosConsistent: res.oos && Math.sign(res.oos.sharpe) === Math.sign(res.full.stats.sharpe),
      psr: res.psr, costStressSharpe: res.cost2 ? res.cost2.sharpe : null,
      paramStability: res.perturbed.length ? Q.quantile(res.perturbed.map(p => p.sharpe), 0.5) : null,
      positiveYearShare: res.posYears,
    } : null;
    exp.summary = res && res.full.stats ? `SR ${res.full.stats.sharpe.toFixed(2)} (OOS ${res.oos ? res.oos.sharpe.toFixed(2) : '-'}), PSR ${(res.psr * 100).toFixed(0)}%, maxDD ${(res.full.stats.maxDD * 100).toFixed(0)}%` : 'no result';
  } else if (hypo.kind === 'factor') {
    if (!res) { exp.verdict = 'ERROR'; return; }
    const red = F.redundancy(hypo.spec, F.library().map(f => f.spec));
    exp.metrics.maxCorrLib = red.maxCorr;
    if (res.verdict === 'ADMITTED' && red.maxCorr > 0.85) {
      exp.verdict = 'REDUNDANT';
      exp.summary = `IC ${res.avgIC.toFixed(3)} but ${(red.maxCorr * 100).toFixed(0)}% correlated with “${red.against}”, not added.`;
    } else {
      exp.verdict = res.verdict === 'ADMITTED' ? 'VALIDATED' : res.verdict === 'WATCHLIST' ? 'MARGINAL' : 'REJECTED';
      exp.summary = `IC ${res.avgIC.toFixed(3)} (OOS ${res.avgOOS.toFixed(3)}), sign-consistent on ${(res.consistency * 100).toFixed(0)}% of universe.`;
      if (res.verdict !== 'REJECTED') F.addToLibrary(res, red);
    }
  } else if (hypo.kind === 'ensemble') {
    if (!res) { exp.verdict = 'ERROR'; return; }
    exp.verdict = res.stats.sharpe > res.bestSingle * 1.05 ? 'VALIDATED' : res.stats.sharpe > res.bestSingle * 0.9 ? 'MARGINAL' : 'REJECTED';
    exp.summary = `Blend SR ${res.stats.sharpe.toFixed(2)} vs best sleeve ${res.bestSingle.toFixed(2)}; max sleeve corr ${exp.metrics.maxSleeveCorr.toFixed(2)}.`;
  }
};

RS._file = function (exp) {
  exp.status = 'done';
  const db = RS.db();
  const i = db.experiments.findIndex(e => e.id === exp.id);
  if (i >= 0) db.experiments[i] = exp; else db.experiments.push(exp);
  RS.saveDb(db);
  const kb = RS.kb();
  if (exp.key) kb.triedKeys[exp.key] = { verdict: exp.verdict, ts: exp.ts };
  // knowledge notes for failures, avoid repeating unsuccessful paths
  if (exp.verdict === 'REJECTED') kb.notes.push({ ts: exp.ts, note: `Rejected: ${exp.title}, ${exp.summary || 'failed gauntlet'} (regime: ${exp.regime})` });
  if (exp.verdict === 'VALIDATED') kb.notes.push({ ts: exp.ts, note: `Validated: ${exp.title}, ${exp.summary} (regime: ${exp.regime})` });
  if (kb.notes.length > 300) kb.notes.splice(0, kb.notes.length - 300);
  RS.saveKb(kb);
  RS.state.count++;
  RS.state.current = null;
  AL.bus.emit('res:update');
};

/* ---------- report builder ---------- */
RS.buildReport = function (entry, val) {
  const s = val.full.stats, b = val.full.bstats;
  const f = AL.fmt;
  const def = entry.def || {};
  const secs = [];
  secs.push(['Abstract',
    `This report documents a complete quantitative evaluation of the “${entry.name}” methodology (${entry.cat}). ` +
    `The strategy was backtested on real ${describeUniverse(entry)} data from ${val.full.from || val.full.dates[0]} through ${val.full.dates[val.full.dates.length - 1]}, ` +
    `with ${val.full.costBps}bp one-way transaction costs, one-day signal lag, and a 70/30 in-sample / out-of-sample split. ` +
    `Full-period Sharpe ratio: ${f.n(s.sharpe)} (benchmark ${val.full.benchSym}: ${f.n(b.sharpe)}). Verdict: ${val.verdict}.`]);
  secs.push(['Hypothesis & economic rationale', entry.desc + ' The null hypothesis is that net-of-cost risk-adjusted returns are zero; rejection requires positive out-of-sample Sharpe, a probabilistic Sharpe ratio above 85%, survival under 3× costs, and parameter stability.']);
  secs.push(['Data & methodology',
    `Universe: ${describeUniverse(entry)}. Signals are computed on adjusted daily closes and lagged one day before execution (no look-ahead). ` +
    `Position accounting is fully vectorized with per-unit turnover charged at ${val.full.costBps}bp. ` +
    (def.params ? `Parameters: ${JSON.stringify(def.params)}. ` : '') +
    `Sources: Yahoo Finance (equities/ETF/futures/FX adjusted closes), FRED (macro & rates), Coinbase (crypto).`]);
  secs.push(['Results', [
    `Full period (${val.full.dates.length} trading days): CAGR ${f.pct(s.cagr)}, vol ${f.pct(s.vol)}, Sharpe ${f.n(s.sharpe)}, Sortino ${f.n(s.sortino)}, Calmar ${f.n(s.calmar)}, Omega ${f.n(s.omega)}.`,
    `Drawdown & tails: max drawdown ${f.pct(s.maxDD)}, daily VaR(95) ${f.pct(s.var95)}, CVaR(95) ${f.pct(s.cvar95)}, skew ${f.n(s.skew)}, excess kurtosis ${f.n(s.kurt)}.`,
    `Versus ${val.full.benchSym}: beta ${f.n(s.beta)}, Jensen's alpha ${f.pct(s.alpha)}, information ratio ${f.n(s.ir)}, up/down capture ${f.n(s.upCapture)}/${f.n(s.downCapture)}.`,
    `Implementation: annualized turnover ${f.n(val.full.turnover, 1)}×, average gross exposure ${f.pct(val.full.avgExposure ?? 1)}.`,
  ].join('\n')]);
  secs.push(['Validation gauntlet', [
    `In-sample Sharpe ${f.n(val.is ? val.is.sharpe : NaN)} vs out-of-sample ${f.n(val.oos ? val.oos.sharpe : NaN)}, ${val.oos && val.oos.sharpe > 0 ? 'sign preserved out-of-sample' : 'OOS deterioration detected'}.`,
    `Probabilistic Sharpe Ratio (skew/kurtosis-adjusted probability that true SR > 0): ${f.pct(val.psr)}.`,
    `Cost stress (3× assumed costs): Sharpe ${f.n(val.cost2 ? val.cost2.sharpe : NaN)}.`,
    `Parameter perturbation (±20% on each window): median Sharpe ${val.perturbed.length ? f.n(Q.quantile(val.perturbed.map(p => p.sharpe), 0.5)) : 'n/a'} across ${val.perturbed.length} variants.`,
    `Sub-period consistency: positive Sharpe in ${f.pct(val.posYears)} of calendar years.`,
  ].join('\n')]);
  if (val.full.coint) {
    const c = val.full.coint;
    secs.push(['Cointegration diagnostics', `Engle-Granger ADF statistic ${f.n(c.adf)} (5% critical ≈ −3.34) → spread ${c.cointegrated ? 'stationary' : 'NOT stationary'}; hedge ratio ${f.n(c.hedge)}; half-life of mean reversion ${isFinite(c.halflife) ? f.n(c.halflife, 0) + ' days' : 'undefined'}.`]);
  }
  secs.push(['Limitations & assumptions',
    'Backtests use daily closes; intraday slippage beyond the linear cost model is not simulated. Adjusted prices embed dividend reinvestment. ' +
    'Survivorship effects are limited (universe is current large-liquid instruments, a mild positive bias for long strategies). ' +
    'Parameter choices, while stress-tested, were selected with knowledge of history; live performance should be expected to degrade toward the OOS estimate. Past performance does not guarantee future results.']);
  secs.push(['Conclusion',
    val.verdict === 'VALIDATED'
      ? `The strategy passes all five gauntlet checks. The evidence is consistent with a real, cost-surviving inefficiency. Recommended next steps: paper-trade tracking, capacity analysis at target AUM, and inclusion in ensemble optimization.`
      : val.verdict === 'MARGINAL'
        ? `The strategy shows a positive but fragile edge, it fails at least one robustness check. Retain on the watchlist; do not allocate. Re-evaluate when regime shifts.`
        : `The null hypothesis cannot be rejected: the apparent edge does not survive validation. Filed in the knowledge base to prevent re-testing equivalent specifications.`]);
  return { title: `${entry.name}, Quantitative Research Report`, entryId: entry.id, date: new Date().toISOString().slice(0, 10), sections: secs.map(([h, body]) => ({ h, body })), verdict: val.verdict };
};
function describeUniverse(entry) {
  const def = entry.def || {};
  if (def.kind === 'single' || def.kind === 'ml') return AL.getSeries(def.sym) ? `${def.sym} (${AL.getSeries(def.sym).name})` : def.sym;
  if (def.kind === 'pair') return def.syms.join(' / ');
  if (def.kind === 'xs') return def.universe.length + ' instruments (' + def.universe.slice(0, 6).join(', ') + (def.universe.length > 6 ? ', …' : '') + ')';
  return 'bundled market data';
}
