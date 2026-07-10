/* AlphaLab modules B: AI Research Desk, Strategy Lab, Ensemble, Alpha Factory, ML Lab. */
'use strict';

/* =========================================================
   MODULE: AI Researcher desk
   ========================================================= */
UI.def('researcher', 'AI Researcher', '☍', 'Autonomous Research', function (el, state, tab) {
  const db = RS.db();
  const exps = db.experiments.slice().reverse();
  const counts = { VALIDATED: 0, MARGINAL: 0, REJECTED: 0, REDUNDANT: 0 };
  exps.forEach(e => { if (counts[e.verdict] != null) counts[e.verdict]++; });
  const cur = RS.state.current;
  el.innerHTML = `
    <div class="section-title">Autonomous Research Desk
      <span class="badge ${RS.state.running ? 'ok' : 'dim'}">${RS.state.running ? 'LOOP ACTIVE' : 'PAUSED'}</span>
      <span style="flex:1"></span>
      <button class="btn primary" id="res-toggle">${RS.state.running ? '⏸ Pause loop' : '▶ Start autonomous loop'}</button>
      <button class="btn" id="res-once">Run single experiment</button>
    </div>
    <div class="info-box" style="margin-bottom:12px">The researcher generates hypotheses (strategy evaluations, alpha-factor candidates, cointegration scans, ensemble blends), executes them on real historical data, pushes each through a 5-stage validation gauntlet (out-of-sample split · probabilistic Sharpe · 3× cost stress · parameter perturbation · sub-period consistency), files every result in the research database, and never re-tests a specification the knowledge base has already rejected.</div>
    ${cur ? UI.panel(`Current experiment, ${cur.id}`, `
      <div style="font-weight:600;margin-bottom:2px">${AL.fmt.esc(cur.title)}</div>
      <div class="note" style="margin-bottom:6px">${AL.fmt.esc(cur.hypothesis)}</div>
      <div class="stages">${RS.STAGES.map((s, i) => `<div class="stage ${i < cur.stage ? 'done' : i === cur.stage ? 'now' : ''}">${s}</div>`).join('')}</div>`) : ''}
    <div class="grid g23" style="margin-top:12px">
      ${UI.panel(`Experiment database <span class="badge dim">${exps.length} filed</span>
        <span class="badge VALIDATED">${counts.VALIDATED} validated</span><span class="badge MARGINAL">${counts.MARGINAL} marginal</span><span class="badge REJECTED">${counts.REJECTED} rejected</span>`,
        `<div style="max-height:calc(100vh - 320px);overflow:auto"><table class="tbl"><thead><tr><th>ID</th><th>Type</th><th>Hypothesis subject</th><th class="r">Key metric</th><th class="r">Verdict</th><th class="r">Filed</th></tr></thead><tbody>` +
        (exps.map(e => {
          const m = e.metrics || {};
          const key = e.kind === 'factor' ? (m.avgIC != null ? 'IC ' + m.avgIC.toFixed(3) : '-')
            : m.sharpe != null ? 'SR ' + m.sharpe.toFixed(2) : '-';
          return `<tr data-exp="${e.id}"><td class="sym">${e.id}</td><td class="t">${e.kind}</td><td class="t" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${AL.fmt.esc(e.title)}</td>
            <td class="r">${key}</td><td class="r"><span class="badge ${e.verdict || 'dim'}">${e.verdict || e.status}</span></td><td class="r">${e.ts.slice(5)}</td></tr>`;
        }).join('') || '<tr><td colspan="6"><div class="empty">No experiments yet, start the loop.</div></td></tr>') + '</tbody></table></div>', { nopad: true })}
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        ${UI.panel('Live research log', `<div class="feed" id="res-feed" style="max-height:300px;overflow-y:auto"></div>`)}
        ${UI.panel('Experiment detail', `<div id="exp-detail"><div class="empty">Select an experiment.</div></div>`)}
      </div>
    </div>`;
  UI.renderFeed(document.getElementById('res-feed'));
  AL.bus.on('res:log', () => { const f = document.getElementById('res-feed'); if (f) UI.renderFeed(f); });
  document.getElementById('res-toggle').addEventListener('click', () => { RS.state.running ? RS.stopAuto() : RS.startAuto(); UI.renderActive(); });
  document.getElementById('res-once').addEventListener('click', () => { RS.runExperiment(RS.generateHypothesis(), () => UI.stillActive(tab) && UI.renderActive()); });
  el.querySelectorAll('tr[data-exp]').forEach(r => r.addEventListener('click', () => {
    const e = RS.db().experiments.find(x => x.id === r.dataset.exp);
    if (!e) return;
    const m = e.metrics || {}; const f = AL.fmt;
    const rows = Object.entries(m).filter(([, v]) => v != null && isFinite(v)).map(([k, v]) =>
      `<div class="kv"><span class="k">${k}</span><span class="v">${Math.abs(v) < 1 && Math.abs(v) > 0.0001 ? v.toFixed(3) : f.n(v, 2)}</span></div>`).join('');
    document.getElementById('exp-detail').innerHTML = `
      <div style="font-weight:600">${e.id} · ${f.esc(e.title)} <span class="badge ${e.verdict}">${e.verdict}</span></div>
      <div class="note" style="margin:6px 0">${f.esc(e.hypothesis)}</div>
      <div class="note" style="margin-bottom:6px"><b>Data:</b> ${f.esc(e.dataNote || '-')}</div>
      <div class="note" style="margin-bottom:6px"><b>Regime at test:</b> ${e.regime || '-'} · <b>Finding:</b> ${f.esc(e.summary || '-')}</div>
      ${rows}
      ${e.kind === 'strategy' && S.byId[e.subject] ? `<button class="btn small primary" style="margin-top:8px" onclick="UI.openTab('stratDetail',{sid:'${e.subject}',forceNew:true},'${f.esc(S.byId[e.subject].name)}')">Open full research module →</button>` : ''}`;
  }));
});

/* =========================================================
   MODULE: Strategy Lab (registry browser)
   ========================================================= */
UI.def('strategies', 'Strategy Lab', '⚘', 'Autonomous Research', function (el, state) {
  const cat = state.cat || 'All';
  const cats = ['All', ...S.categories];
  const list = S.registry.filter(s => cat === 'All' || s.cat === cat);
  const scores = AL.store.get('strat_scores', {});
  el.innerHTML = `
    <div class="section-title">Strategy Library <span class="badge dim">${S.registry.length} research modules</span>
      <span class="badge ok">${S.registry.filter(s => s.status === 'ok').length} runnable on real data</span>
      <span class="badge data">${S.registry.filter(s => s.status === 'data').length} need external datasets</span></div>
    <div class="controls">${cats.map(c => `<span class="chip ${c === cat ? 'on' : ''}" data-c="${c}">${c}</span>`).join('')}</div>
    <div class="panel"><div class="panel-body nopad" style="max-height:calc(100vh - 230px);overflow:auto">
    <table class="tbl" id="st-tbl"><thead><tr><th>ID</th><th>Strategy</th><th>Category</th><th>Universe</th><th class="r">Sharpe*</th><th class="r">CAGR*</th><th class="r">MaxDD*</th><th class="r">Status</th></tr></thead><tbody>` +
    list.map(s => {
      const sc = scores[s.id];
      const uni = s.def ? (s.def.sym || (s.def.syms || s.def.universe || []).slice(0, 3).join(', ') + ((s.def.universe || []).length > 3 ? '…' : '')) : '-';
      return `<tr data-sid="${s.id}"><td class="sym">${s.id}</td><td class="t" style="font-weight:600">${AL.fmt.esc(s.name)}</td><td class="t">${s.cat}</td><td>${AL.fmt.esc(uni)}</td>
        <td class="r ${sc ? AL.fmt.cls(sc.sharpe) : ''}" data-v="${sc ? sc.sharpe : ''}">${sc ? AL.fmt.n(sc.sharpe) : '·'}</td>
        <td class="r" data-v="${sc ? sc.cagr : ''}">${sc ? AL.fmt.spct(sc.cagr) : '·'}</td>
        <td class="r dn" data-v="${sc ? sc.maxDD : ''}">${sc ? AL.fmt.pct(sc.maxDD, 1) : '·'}</td>
        <td class="r">${s.status === 'ok' ? '<span class="badge ok">READY</span>' : '<span class="badge data">NEEDS DATA</span>'}</td></tr>`;
    }).join('') + `</tbody></table></div></div>
    <div class="note" style="margin-top:8px">* cached from your last run of each module, open a strategy to (re)compute on real data. Click headers to sort.</div>`;
  el.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { state.cat = c.dataset.c; UI.renderActive(); }));
  el.querySelectorAll('tr[data-sid]').forEach(r => r.addEventListener('click', () => {
    const s = S.byId[r.dataset.sid];
    UI.openTab('stratDetail', { sid: s.id, forceNew: true }, s.name);
  }));
  UI.sortTable(document.getElementById('st-tbl'));
});

/* =========================================================
   MODULE: Strategy detail / backtest workbench
   ========================================================= */
UI.def('stratDetail', 'Strategy', '⚙', 'Autonomous Research', function (el, state, tab) {
  // accepts registry ids or ad-hoc compositions handed over by the Strategy Composer
  const entry = state.adhoc || S.byId[state.sid];
  if (!entry) { el.innerHTML = '<div class="empty">Unknown strategy.</div>'; return; }
  tab.title = entry.name.length > 26 ? entry.name.slice(0, 24) + '…' : entry.name;
  if (entry.status === 'data') {
    el.innerHTML = `<div class="section-title">${AL.fmt.esc(entry.name)} <span class="badge data">EXTERNAL DATASET REQUIRED</span></div>
      <div class="grid g13">${UI.panel('Methodology', `<p style="color:var(--ink2);line-height:1.6">${AL.fmt.esc(entry.desc)}</p>`)}
      ${UI.panel('Activation path', `<div class="kv"><span class="k">Required feed</span><span class="v" style="font-family:var(--sans)">${AL.fmt.esc(entry.needs)}</span></div>
        <div class="note" style="margin:10px 0">This module is fully documented but intentionally not simulated: fabricating ${AL.fmt.esc(entry.needs)} would produce untrustworthy research. Connect the dataset via the Data Hub CSV uploader (or an API integration) and the module will activate against it.</div>
        <button class="btn primary" onclick="UI.focusModule('datahub')">Open Data Hub →</button>`)}</div>`;
    return;
  }
  const params = state.params || { ...(entry.def.params || {}) };
  const cost = state.cost ?? entry.cost ?? 5;
  el.innerHTML = `
    <div class="section-title">${AL.fmt.esc(entry.name)} <span class="badge dim">${entry.id} · ${entry.cat}</span><span id="sd-verdict"></span></div>
    <p class="note" style="max-width:900px;margin-bottom:10px">${AL.fmt.esc(entry.desc)}</p>
    <div class="controls">
      ${Object.entries(params).filter(([, v]) => typeof v === 'number').map(([k, v]) =>
        `<label class="lbl">${k}</label><input class="inp" style="width:64px" data-p="${k}" value="${v}">`).join('')}
      <label class="lbl">cost bp</label><input class="inp" style="width:56px" id="sd-cost" value="${cost}">
      <button class="btn primary" id="sd-run">Run backtest + gauntlet</button>
      <button class="btn" id="sd-report">Generate research report</button>
      <span class="note" id="sd-status"></span>
    </div>
    <div id="sd-body"><div class="empty">Running on real history…</div></div>`;
  const run = () => {
    document.getElementById('sd-status').textContent = 'computing…';
    setTimeout(() => {
      let val;
      try { val = S.validate(entry, { params, costBps: +document.getElementById('sd-cost').value || cost }); }
      catch (e) { console.error(e); document.getElementById('sd-body').innerHTML = `<div class="empty">Backtest failed: ${AL.fmt.esc(e.message)}</div>`; return; }
      if (!val || !val.full.stats) { document.getElementById('sd-body').innerHTML = '<div class="empty">Not enough data for this configuration.</div>'; return; }
      state._val = val;
      const scores = AL.store.get('strat_scores', {});
      scores[entry.id] = { sharpe: val.full.stats.sharpe, cagr: val.full.stats.cagr, maxDD: val.full.stats.maxDD, ts: AL.asof };
      AL.store.set('strat_scores', scores);
      document.getElementById('sd-status').textContent = '';
      document.getElementById('sd-verdict').innerHTML = `<span class="badge ${val.verdict}">${val.verdict}</span>`;
      renderResult(val);
    }, 30);
  };
  const renderResult = (val) => {
    const r = val.full, f = AL.fmt;
    const body = document.getElementById('sd-body');
    body.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr">
        ${UI.panel(`Equity curve vs ${r.benchSym} <span class="badge dim">net of ${r.costBps}bp costs · 1-day lag</span>`, '<div class="chart h300" id="sd-eq"></div>', { nopad: true })}
        <div class="grid g2">
          ${UI.panel('Performance metrics (full period)', UI.metricsFor(r.stats, { Turnover: f.n(r.turnover, 1) + '×/yr', 'PSR (SR>0)': f.pct(val.psr) }))}
          ${UI.panel('Validation gauntlet', `
            <div class="kv"><span class="k">In-sample Sharpe (70%)</span><span class="v">${f.n(val.is ? val.is.sharpe : NaN)}</span></div>
            <div class="kv"><span class="k">Out-of-sample Sharpe (30%)</span><span class="v ${val.oos && val.oos.sharpe > 0 ? 'up' : 'dn'}">${f.n(val.oos ? val.oos.sharpe : NaN)}</span></div>
            <div class="kv"><span class="k">Probabilistic Sharpe Ratio</span><span class="v">${f.pct(val.psr)}</span></div>
            <div class="kv"><span class="k">Sharpe @ 3× costs</span><span class="v ${val.cost2 && val.cost2.sharpe > 0 ? 'up' : 'dn'}">${f.n(val.cost2 ? val.cost2.sharpe : NaN)}</span></div>
            <div class="kv"><span class="k">Param-perturbation median SR</span><span class="v">${val.perturbed.length ? f.n(Q.quantile(val.perturbed.map(p => p.sharpe), 0.5)) : 'n/a'}</span></div>
            <div class="kv"><span class="k">Positive years</span><span class="v">${f.pct(val.posYears)}</span></div>
            <div class="kv"><span class="k">Benchmark Sharpe (${r.benchSym})</span><span class="v">${f.n(val.full.bstats.sharpe)}</span></div>
            ${r.coint ? `<div class="kv"><span class="k">Engle-Granger ADF</span><span class="v ${r.coint.cointegrated ? 'up' : 'dn'}">${f.n(r.coint.adf)} ${r.coint.cointegrated ? '(cointegrated)' : '(weak)'}</span></div>
            <div class="kv"><span class="k">Spread half-life</span><span class="v">${isFinite(r.coint.halflife) ? f.n(r.coint.halflife, 0) + 'd' : '∞'}</span></div>` : ''}`)}
        </div>
        <div class="grid g3">
          ${UI.panel('Drawdown', '<div class="chart h180" id="sd-dd"></div>')}
          ${UI.panel('Rolling 1y Sharpe', '<div class="chart h180" id="sd-rs"></div>')}
          ${UI.panel('Gross exposure', '<div class="chart h180" id="sd-ex"></div>')}
        </div>
        <div class="grid g2">
          ${UI.panel('Monthly returns (%)', '<div class="chart h260" id="sd-mo"></div>')}
          ${UI.panel('Sharpe by calendar year', '<div class="chart h260" id="sd-yr"></div>')}
        </div>
        ${(r.lastWeights ? UI.panel('Current model weights', '<div class="chart h200" id="sd-w" style="height:200px"></div>') : '')}
        ${ (r.mlDiag ? `<div class="grid g2">${UI.panel('ML: prediction quintile → fwd return', '<div class="chart h200" id="sd-q" style="height:200px"></div>')}${UI.panel('ML diagnostics', `
          <div class="kv"><span class="k">Rank IC (pred vs realized)</span><span class="v">${f.n(r.mlDiag.ic, 3)}</span></div>
          <div class="kv"><span class="k">Directional hit rate</span><span class="v">${f.pct(r.mlDiag.hit)}</span></div>
          <div class="kv"><span class="k">Predictions scored</span><span class="v">${r.mlDiag.n.toLocaleString()}</span></div>
          <div class="kv"><span class="k">Walk-forward refits</span><span class="v">${r.wf.folds.length}</span></div>`)}</div>` : '')}
      </div>`;
    C.line(document.getElementById('sd-eq'), [
      { name: entry.name.slice(0, 22), dates: r.dates, values: r.equity.slice(1), color: C.SERIES[0], width: 2 },
      { name: r.benchSym, dates: r.dates, values: r.benchEquity.slice(1), color: C.MUTED }], { log: true });
    C.line(document.getElementById('sd-dd'), [{ name: 'DD', dates: r.dates, values: r.stats.dd.slice(1), color: C.DN, fill: true }], { pct: true, zeroLine: true });
    const roll = [];
    for (let i = 0; i < r.rets.length; i++) {
      if (i < 252) { roll.push(NaN); continue; }
      const w = r.rets.slice(i - 252, i);
      roll.push(Q.std(w) ? Q.mean(w) / Q.std(w) * Math.sqrt(252) : 0);
    }
    C.line(document.getElementById('sd-rs'), [{ name: 'SR', dates: r.dates, values: roll, color: C.SERIES[4] }], { zeroLine: true });
    if (r.exposure) C.line(document.getElementById('sd-ex'), [{ name: 'exposure', dates: r.dates, values: r.exposure, color: C.SERIES[2], fill: true }], { zeroLine: true });
    C.monthlyHeatmap(document.getElementById('sd-mo'), r.dates, r.rets);
    C.bars(document.getElementById('sd-yr'), val.yearSharpes.map(y => ({ label: y.year.slice(2), value: y.sharpe })), {});
    if (r.lastWeights) {
      const items = Object.entries(r.lastWeights).filter(([, w]) => Math.abs(w) > 0.001).map(([s, w]) => ({ label: s, value: w }));
      if (items.length) C.bars(document.getElementById('sd-w'), items, { horizontal: true, pct: true, sorted: true });
    }
    if (r.mlDiag) C.bars(document.getElementById('sd-q'), r.mlDiag.quintiles.map((q, i) => ({ label: 'Q' + (i + 1), value: q })), { pct: true });
  };
  document.getElementById('sd-run').addEventListener('click', () => {
    el.querySelectorAll('[data-p]').forEach(inp => { const v = parseFloat(inp.value); if (isFinite(v)) params[inp.dataset.p] = v; });
    state.params = params; run();
  });
  document.getElementById('sd-report').addEventListener('click', () => {
    if (!state._val) { run(); setTimeout(() => state._val && openReport(), 1500); } else openReport();
    function openReport() {
      const rep = RS.buildReport(entry, state._val);
      const reports = AL.store.get('reports', []);
      reports.push(rep); AL.store.set('reports', reports);
      UI.openTab('reportView', { idx: reports.length - 1, forceNew: true }, 'Report: ' + entry.id);
    }
  });
  run();
});

/* =========================================================
   MODULE: Ensemble engine / strategy competition
   ========================================================= */
UI.def('ensemble', 'Ensemble Engine', '⛖', 'Autonomous Research', function (el, state, tab) {
  const lb = AL.store.get('leaderboard', null);
  el.innerHTML = `
    <div class="section-title">Ensemble Engine, Strategy Competition
      <span style="flex:1"></span>
      <button class="btn primary" id="lb-run">Run competition (24 modules, ~30s)</button></div>
    <div class="info-box" style="margin-bottom:12px">The allocator runs a representative slate of strategy modules over the recent 3-year window on real data, scores them on out-of-window Sharpe, drawdown, turnover and regime fit (current regime: <b>${Q.marketRegime().label}</b>), then builds an inverse-vol ensemble from the top-ranked, low-correlation sleeves, with expected alpha and confidence estimates for each.</div>
    <div id="lb-body">${lb ? '' : '<div class="empty">No competition results yet, press Run.</div>'}</div>`;
  if (lb) renderLB(lb);
  document.getElementById('lb-run').addEventListener('click', () => {
    const slate = ['S001', 'S006', 'S013', 'S018', 'S019', 'S020', 'S025', 'S026', 'S031', 'S035', 'S041', 'S045', 'S052', 'S053', 'S056', 'S058', 'S062', 'S070', 'S073', 'S078', 'S083', 'S088', 'S099', 'S102'].filter(id => S.byId[id] && S.byId[id].status === 'ok');
    const body = document.getElementById('lb-body');
    body.innerHTML = `<div class="panel"><div class="panel-body"><div class="note" id="lb-prog">Running…</div><div class="progress" style="margin-top:6px"><div id="lb-bar" style="width:0%"></div></div></div></div>`;
    const results = [];
    let i = 0;
    const step = () => {
      if (i >= slate.length) { finish(); return; }
      const entry = S.byId[slate[i]];
      document.getElementById('lb-prog').textContent = `(${i + 1}/${slate.length}) ${entry.name}`;
      document.getElementById('lb-bar').style.width = (i / slate.length * 100) + '%';
      setTimeout(() => {
        try {
          const r = S.run(entry, {});
          if (r && r.stats && r.rets.length > 900) {
            const recent = r.rets.slice(-756), recentB = r.bench.slice(-756);
            const p = Q.perf(recent, { bench: recentB });
            const full = r.stats;
            if (p) {
              // regime fit: sharpe in high-vol vs low-vol halves of recent window
              const vol = Q.rollStd(recentB, 21);
              const med = Q.quantile(vol.filter(isFinite), 0.5);
              const hv = recent.filter((_, k) => vol[k] > med), lv = recent.filter((_, k) => vol[k] <= med && isFinite(vol[k]));
              const shHV = Q.std(hv) ? Q.mean(hv) / Q.std(hv) * Math.sqrt(252) : 0;
              const shLV = Q.std(lv) ? Q.mean(lv) / Q.std(lv) * Math.sqrt(252) : 0;
              const regime = Q.marketRegime();
              const regimeFit = regime.pCalm > 0.5 ? shLV : shHV;
              const conf = Q.psr(recent);
              const score = p.sharpe * 0.45 + full.sharpe * 0.2 + regimeFit * 0.2 - Math.max(r.turnover - 15, 0) * 0.01 + (conf - 0.5);
              results.push({
                id: entry.id, name: entry.name, cat: entry.cat, sharpe3y: p.sharpe, sharpeFull: full.sharpe,
                cagr3y: p.cagr, maxDD3y: p.maxDD, vol3y: p.vol, turnover: r.turnover || 0, regimeFit, conf, score,
                rets: recent.slice(-504),
              });
            }
          }
        } catch (e) { console.error(entry.id, e); }
        i++; step();
      }, 20);
    };
    const finish = () => {
      results.sort((a, b) => b.score - a.score);
      // pick top sleeves with pairwise corr < 0.65
      const chosen = [];
      for (const r of results) {
        if (r.sharpe3y <= 0.15 || chosen.length >= 6) continue;
        const n = Math.min(...chosen.map(c => c.rets.length), r.rets.length, 504);
        if (chosen.every(c => Q.corr(c.rets.slice(-n), r.rets.slice(-n)) < 0.65)) chosen.push(r);
      }
      const iv = chosen.map(c => 1 / (Q.std(c.rets) || 1e-4));
      const tot = Q.sum(iv);
      const weights = iv.map(x => x / tot);
      let comb = null;
      if (chosen.length) {
        const n = Math.min(...chosen.map(c => c.rets.length));
        comb = Array.from({ length: n }, (_, t) => chosen.reduce((s, c, k) => s + weights[k] * c.rets[c.rets.length - n + t], 0));
      }
      const combStats = comb ? Q.perf(comb) : null;
      const lb2 = { ts: AL.asof, regime: Q.marketRegime().label, results: results.map(({ rets, ...r }) => r), chosen: chosen.map((c, k) => ({ id: c.id, name: c.name, w: weights[k], sharpe3y: c.sharpe3y, conf: c.conf })), combStats: combStats ? { sharpe: combStats.sharpe, cagr: combStats.cagr, maxDD: combStats.maxDD, vol: combStats.vol } : null };
      AL.store.set('leaderboard', lb2);
      if (UI.stillActive(tab)) { UI.renderActive(); }
      RS.pushLog(`Ensemble competition complete: ${results.length} modules scored, ${chosen.length} sleeves selected (blend SR ${combStats ? combStats.sharpe.toFixed(2) : '-'}).`, 'good');
    };
    step();
  });
  function renderLB(lb) {
    const f = AL.fmt;
    document.getElementById('lb-body').innerHTML = `
      <div class="grid g23">
        ${UI.panel(`Leaderboard, trailing 3y, real data <span class="badge dim">regime at scoring: ${lb.regime}</span>`,
          `<div style="max-height:440px;overflow:auto"><table class="tbl"><thead><tr><th>#</th><th>Module</th><th>Category</th><th class="r">SR 3y</th><th class="r">SR full</th><th class="r">CAGR 3y</th><th class="r">MaxDD</th><th class="r">Regime fit</th><th class="r">Confidence</th><th class="r">Score</th></tr></thead><tbody>` +
          lb.results.map((r, i) => `<tr data-sid="${r.id}"><td>${i + 1}</td><td class="t" style="font-weight:600">${f.esc(r.name)}</td><td class="t">${r.cat}</td>
            <td class="r ${f.cls(r.sharpe3y)}">${f.n(r.sharpe3y)}</td><td class="r">${f.n(r.sharpeFull)}</td><td class="r ${f.cls(r.cagr3y)}">${f.spct(r.cagr3y)}</td>
            <td class="r dn">${f.pct(r.maxDD3y, 1)}</td><td class="r">${f.n(r.regimeFit)}</td><td class="r">${f.pct(r.conf, 0)}</td><td class="r"><b>${f.n(r.score)}</b></td></tr>`).join('') + '</tbody></table></div>', { nopad: true })}
        <div style="display:flex;flex-direction:column;gap:12px">
          ${UI.panel('Optimized ensemble thesis', (lb.chosen.length ? `
            <div class="note" style="margin-bottom:8px">Top uncorrelated sleeves (pairwise ρ &lt; 0.65), inverse-vol weighted:</div>
            ${lb.chosen.map(c => `<div class="kv"><span class="k">${f.esc(c.name)}</span><span class="v">${f.pct(c.w, 1)} · conf ${f.pct(c.conf, 0)}</span></div>`).join('')}
            ${lb.combStats ? `<div style="margin-top:10px" class="metrics">
              ${UI.metric('Blend Sharpe (3y)', f.n(lb.combStats.sharpe), f.cls(lb.combStats.sharpe))}
              ${UI.metric('Blend CAGR', f.spct(lb.combStats.cagr))}
              ${UI.metric('Blend MaxDD', f.pct(lb.combStats.maxDD, 1), 'dn')}
              ${UI.metric('Blend Vol', f.pct(lb.combStats.vol, 1))}</div>` : ''}
            <div class="note" style="margin-top:8px">Research insight, not investment advice: expected edges are historical estimates with confidence given by the probabilistic Sharpe ratio. Execution remains a user decision.</div>` : '<div class="empty">No sleeve cleared the bar.</div>'))}
        </div>
      </div>`;
    document.querySelectorAll('#lb-body tr[data-sid]').forEach(r => r.addEventListener('click', () => UI.openTab('stratDetail', { sid: r.dataset.sid, forceNew: true }, S.byId[r.dataset.sid].name)));
  }
});

/* =========================================================
   MODULE: Alpha Factory (factor discovery)
   ========================================================= */
UI.def('alpha', 'Alpha Factory', '∿', 'Autonomous Research', function (el, state, tab) {
  const lib = F.library();
  el.innerHTML = `
    <div class="section-title">Alpha Discovery Engine
      <span style="flex:1"></span>
      <label class="lbl">candidates</label><select class="inp" id="af-n"><option>10</option><option selected>25</option><option>50</option></select>
      <button class="btn primary" id="af-scan">⚡ Generate & test factors</button></div>
    <div class="info-box" style="margin-bottom:12px">The engine composes candidate signals from a transformation grammar (${F.transforms.length} operators × ${F.windows.length} windows × ${F.postOps.length} post-ops ≈ ${(F.transforms.length * F.windows.length * F.postOps.length).toLocaleString()} unique specs), then tests each on a ${RS.factorUniverse.length}-asset universe of real history: rank IC vs 5-day forward returns, in/out-of-sample sign stability, yearly IC t-stat, decay profile, quantile spread, and multicollinearity vs the existing library. Only survivors are admitted.</div>
    <div class="grid g23">
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        ${UI.panel('Scan results', '<div id="af-out"><div class="empty">Run a scan to generate candidates.</div></div>', { nopad: false })}
        ${UI.panel(`Factor library <span class="badge dim">${lib.length} admitted</span>`, `<div style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th>Factor</th><th class="r">IC</th><th class="r">OOS IC</th><th class="r">Consistency</th><th class="r">Max ρ lib</th><th class="r">Added</th></tr></thead><tbody>` +
          (lib.map(fc => `<tr data-fkey="${fc.key}"><td class="t">${AL.fmt.esc(fc.name)}</td><td class="r ${AL.fmt.cls(fc.avgIC)}">${fc.avgIC.toFixed(3)}</td><td class="r">${fc.avgOOS.toFixed(3)}</td><td class="r">${AL.fmt.pct(fc.consistency, 0)}</td><td class="r">${fc.maxCorr != null ? AL.fmt.pct(fc.maxCorr, 0) : '-'}</td><td class="r">${fc.added.slice(5, 10)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Library empty.</div></td></tr>') + '</tbody></table></div>', { nopad: true })}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        ${UI.panel('Factor inspector', '<div id="af-inspect"><div class="empty">Click a factor to inspect IC decay & per-asset ICs.</div></div>')}
      </div>
    </div>`;
  const runScan = () => {
    const N = +document.getElementById('af-n').value;
    const out = document.getElementById('af-out');
    out.innerHTML = `<div class="note" id="af-prog">scanning…</div><div class="progress" style="margin:6px 0"><div id="af-bar" style="width:0"></div></div><div id="af-rows"></div>`;
    const rand = AL.rng(Date.now() % 1e6);
    const seen = new Set();
    const found = [];
    let i = 0;
    const step = () => {
      if (i >= N) { done(); return; }
      let spec;
      for (let t = 0; t < 40; t++) { spec = F.randomSpec(rand); if (!seen.has(F.key(spec))) break; }
      seen.add(F.key(spec));
      document.getElementById('af-prog').textContent = `(${i + 1}/${N}) ${F.name(spec)}`;
      document.getElementById('af-bar').style.width = (i / N * 100) + '%';
      setTimeout(() => {
        const ev = F.evaluate(spec, RS.factorUniverse, 5);
        if (ev) {
          let red = null;
          if (ev.verdict !== 'REJECTED') {
            red = F.redundancy(spec, F.library().map(x => x.spec));
            if (red.maxCorr > 0.85) ev.verdict = 'REDUNDANT';
            else if (ev.verdict === 'ADMITTED') F.addToLibrary(ev, red);
          }
          found.push({ ev, red });
          renderRows();
        }
        i++; step();
      }, 15);
    };
    const renderRows = () => {
      const rows = found.slice().sort((a, b) => Math.abs(b.ev.avgIC) - Math.abs(a.ev.avgIC));
      document.getElementById('af-rows').innerHTML = `<table class="tbl"><thead><tr><th>Candidate factor</th><th class="r">IC</th><th class="r">OOS</th><th class="r">Consist.</th><th class="r">Verdict</th></tr></thead><tbody>` +
        rows.map((r, k) => `<tr data-i="${found.indexOf(r)}"><td class="t">${AL.fmt.esc(r.ev.name)}</td><td class="r ${AL.fmt.cls(r.ev.avgIC)}">${r.ev.avgIC.toFixed(3)}</td><td class="r">${r.ev.avgOOS.toFixed(3)}</td><td class="r">${AL.fmt.pct(r.ev.consistency, 0)}</td><td class="r"><span class="badge ${r.ev.verdict === 'ADMITTED' ? 'VALIDATED' : r.ev.verdict}">${r.ev.verdict}</span></td></tr>`).join('') + '</tbody></table>';
      document.querySelectorAll('#af-rows tr[data-i]').forEach(tr => tr.addEventListener('click', () => inspect(found[+tr.dataset.i].ev)));
    };
    const done = () => {
      document.getElementById('af-prog').textContent = `Scan complete: ${found.filter(x => x.ev.verdict === 'ADMITTED').length} admitted, ${found.filter(x => x.ev.verdict === 'WATCHLIST').length} watchlist, ${found.filter(x => x.ev.verdict === 'REDUNDANT').length} redundant of ${N}.`;
      document.getElementById('af-bar').style.width = '100%';
      RS.pushLog(`Alpha Factory scan: ${N} candidates → ${found.filter(x => x.ev.verdict === 'ADMITTED').length} admitted to library.`, 'sys');
    };
    step();
  };
  const inspect = (ev) => {
    const box = document.getElementById('af-inspect');
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">${AL.fmt.esc(ev.name)} <span class="badge ${ev.verdict === 'ADMITTED' ? 'VALIDATED' : ev.verdict}">${ev.verdict}</span></div>
      <div class="note">Spec <span class="num">${AL.fmt.esc(JSON.stringify(ev.spec))}</span> · horizon ${ev.horizon}d · ${ev.per.length} assets</div>
      <h3 class="sub">IC decay (avg across assets)</h3><div class="chart" style="height:150px" id="af-decay"></div>
      <h3 class="sub">Per-asset IC</h3><div class="chart" style="height:${Math.max(150, ev.per.length * 20)}px" id="af-per"></div>
      <h3 class="sub">Top-vs-bottom quintile forward spread</h3><div class="chart" style="height:${Math.max(150, ev.per.length * 20)}px" id="af-spread"></div>`;
    const hs = [1, 5, 10, 21];
    const avgDecay = hs.map((h, i) => ({ label: h + 'd', value: Q.mean(ev.per.map(p => p.decay[i].ic).filter(isFinite)) }));
    C.bars(document.getElementById('af-decay'), avgDecay, {});
    C.bars(document.getElementById('af-per'), ev.per.map(p => ({ label: p.sym, value: p.ic })), { horizontal: true });
    C.bars(document.getElementById('af-spread'), ev.per.map(p => ({ label: p.sym, value: p.spread })), { horizontal: true, pct: true });
  };
  document.getElementById('af-scan').addEventListener('click', runScan);
  document.querySelectorAll('tr[data-fkey]').forEach(tr => tr.addEventListener('click', () => {
    const fc = F.library().find(x => x.key === tr.dataset.fkey);
    if (fc) { const ev = F.evaluate(fc.spec, RS.factorUniverse, fc.horizon || 5); if (ev) inspect(ev); }
  }));
  if (state.autoscan) { state.autoscan = false; setTimeout(runScan, 250); }
});

/* =========================================================
   MODULE: ML Lab
   ========================================================= */
UI.def('mllab', 'ML Lab', 'Ψ', 'Autonomous Research', function (el, state, tab) {
  const sym = state.sym || 'SPY';
  const model = state.model || 'ridge';
  const horizon = state.horizon || 5;
  const syms = ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'EEM', 'XLE', 'AAPL', 'NVDA', 'BTC-USD'];
  el.innerHTML = `
    <div class="section-title">Machine Learning Laboratory</div>
    <div class="controls">
      <label class="lbl">target</label><select class="inp" id="ml-sym">${syms.map(s => `<option ${s === sym ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label class="lbl">model</label><select class="inp" id="ml-model">${Object.entries(ML.models).map(([id, m]) => `<option value="${id}" ${id === model ? 'selected' : ''}>${m.name}</option>`).join('')}<option value="ensemble" ${model === 'ensemble' ? 'selected' : ''}>Ensemble vote (4 models)</option></select>
      <label class="lbl">horizon</label><select class="inp" id="ml-h">${[5, 10, 21].map(h => `<option ${h === horizon ? 'selected' : ''}>${h}</option>`).join('')}</select>
      <button class="btn primary" id="ml-run">Train walk-forward</button>
      <span class="note" id="ml-status"></span></div>
    <div class="info-box" style="margin-bottom:12px">Models train entirely in-browser on 14–15 engineered features (momentum stack, reversal, vol & vol-of-vol, RSI, trend distance, drawdown state, VIX level & z-score, yield curve, seasonality) with expanding-window walk-forward refits every quarter, predictions are always out-of-sample. Deep-learning references (LSTM/Transformer/TCN/GNN) are honestly represented here by the MLP baseline: on daily bars with a few thousand observations, properly validated shallow models are the institutional norm.</div>
    <div id="ml-body"><div class="empty">Configure and train.</div></div>`;
  const run = () => {
    document.getElementById('ml-status').textContent = 'training (walk-forward)…';
    setTimeout(() => {
      const t0 = performance.now();
      const feat = ML.makeFeatures(document.getElementById('ml-sym').value, +document.getElementById('ml-h').value);
      const mid = document.getElementById('ml-model').value;
      const wf = ML.walkForward(feat, mid, {});
      const diag = ML.diagnostics(feat, wf.preds);
      const imp = ML.permImportance(feat, mid, {});
      const ms = Math.round(performance.now() - t0);
      document.getElementById('ml-status').textContent = `trained in ${ms}ms · ${wf.folds.length} refits`;
      if (!diag) { document.getElementById('ml-body').innerHTML = '<div class="empty">Insufficient data.</div>'; return; }
      const f = AL.fmt;
      document.getElementById('ml-body').innerHTML = `
        <div class="grid g3" style="margin-bottom:12px">
          ${UI.panel('Out-of-sample skill', `
            <div class="kv"><span class="k">Rank IC (pred vs realized)</span><span class="v ${f.cls(diag.ic)}">${f.n(diag.ic, 3)}</span></div>
            <div class="kv"><span class="k">Directional hit rate</span><span class="v">${f.pct(diag.hit)}</span></div>
            <div class="kv"><span class="k">OOS predictions</span><span class="v">${diag.n.toLocaleString()}</span></div>
            <div class="kv"><span class="k">Features</span><span class="v">${feat.names.length}</span></div>
            <div class="kv"><span class="k">Refit cadence</span><span class="v">63 days</span></div>
            <div class="note" style="margin-top:8px">IC of 0.03–0.08 on daily horizons is realistic institutional skill; anything above ~0.15 here would itself be evidence of leakage.</div>`)}
          ${UI.panel('Prediction quintile → realized fwd return', '<div class="chart h220" id="ml-q"></div>')}
          ${UI.panel('Permutation feature importance (ΔIC)', '<div class="chart h220" id="ml-imp"></div>')}
        </div>
        ${UI.panel('Predicted vs realized forward returns (last 500 OOS points)', '<div class="chart h260" id="ml-sc"></div>')}`;
      C.bars(document.getElementById('ml-q'), diag.quintiles.map((q, i) => ({ label: 'Q' + (i + 1), value: q })), { pct: true });
      C.bars(document.getElementById('ml-imp'), imp.slice(0, 12).map(x => ({ label: x.feature, value: x.importance })), { horizontal: true });
      const pts = diag.pairs.slice(-500).map(p => ({ x: p.p, y: p.a, color: C.SERIES[0] + '99' }));
      C.scatter(document.getElementById('ml-sc'), pts, { pctY: true, pctX: Math.abs(pts[0].x) < 1 });
    }, 30);
  };
  document.getElementById('ml-run').addEventListener('click', () => {
    state.sym = document.getElementById('ml-sym').value;
    state.model = document.getElementById('ml-model').value;
    state.horizon = +document.getElementById('ml-h').value;
    run();
  });
  run();
});
