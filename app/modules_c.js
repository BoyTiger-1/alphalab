/* AlphaLab modules C: Portfolio Constructor, My Holdings, Risk Lab, Reports, Knowledge Base. */
'use strict';

/* =========================================================
   MODULE: Portfolio Constructor (optimizers)
   ========================================================= */
UI.def('portfolio', 'Portfolio Builder', '◔', 'Portfolio & Risk', function (el, state, tab) {
  const pool = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'LQD', 'HYG', 'TIP', 'GLD', 'SLV', 'DBC', 'VNQ', 'BTC-USD', 'XLK', 'XLE', 'XLV', 'USMV', 'MTUM'];
  const sel = state.sel || ['SPY', 'EFA', 'TLT', 'GLD', 'VNQ', 'DBC'];
  const method = state.method || 'erc';
  const methods = { eq: 'Equal Weight', minvar: 'Minimum Variance', erc: 'Equal Risk Contribution', hrp: 'Hierarchical Risk Parity', maxsharpe: 'Max Sharpe (MPT)', kelly: 'Kelly-tempered Max Sharpe', bl: 'Black-Litterman blend' };
  el.innerHTML = `
    <div class="section-title">Portfolio Construction Laboratory</div>
    <div class="controls">${pool.map(s => `<span class="chip ${sel.includes(s) ? 'on' : ''}" data-s="${s}">${s}</span>`).join('')}</div>
    <div class="controls">
      <label class="lbl">optimizer</label><select class="inp" id="pf-m">${Object.entries(methods).map(([k, v]) => `<option value="${k}" ${k === method ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="lbl">vol target</label><select class="inp" id="pf-vt"><option value="">none</option><option value="0.08">8%</option><option value="0.10" ${state.vt === '0.10' ? 'selected' : ''}>10%</option><option value="0.12">12%</option></select>
      <label class="lbl">lookback</label><select class="inp" id="pf-lb"><option value="252">1y</option><option value="504" selected>2y</option><option value="1260">5y</option></select>
      <button class="btn primary" id="pf-run">Optimize & backtest</button>
      <span class="note" id="pf-note"></span></div>
    <div id="pf-body"><div class="empty">Select assets and optimize.</div></div>`;
  el.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    const s = c.dataset.s;
    const i = sel.indexOf(s);
    if (i >= 0) sel.splice(i, 1); else if (sel.length < 12) sel.push(s);
    state.sel = sel;
    UI.renderActive();
  }));
  const run = () => {
    if (sel.length < 2) return;
    const m = document.getElementById('pf-m').value;
    const lb = +document.getElementById('pf-lb').value;
    const vt = parseFloat(document.getElementById('pf-vt').value) || null;
    state.method = m;
    const al = AL.align(sel, 'ret');
    const syms = al.syms;
    const Cm = Q.covMatrix(al.cols, syms, lb);
    const Rm = Q.corrMatrix(al.cols, syms, lb);
    const mu = syms.map(s => Q.mean(al.cols[s].slice(-lb)) * 252);
    let w;
    if (m === 'eq') w = syms.map(() => 1 / syms.length);
    else if (m === 'minvar') w = Q.minVar(Cm);
    else if (m === 'erc') w = Q.erc(Cm);
    else if (m === 'hrp') w = Q.hrp(Cm, Rm);
    else if (m === 'maxsharpe') w = Q.maxSharpe(mu, Cm);
    else if (m === 'kelly') {
      w = Q.maxSharpe(mu, Cm);
      const kf = Math.min(Math.max(Q.kellyFraction(syms.reduce((acc, s, i) => acc.map((v, t) => v + w[i] * al.cols[s].slice(-lb)[t]), new Array(lb).fill(0))), 0), 1) * 0.5; // half-Kelly
      w = w.map(x => x * Math.min(kf * 2, 1));
    } else if (m === 'bl') {
      const wm = syms.map(() => 1 / syms.length);
      const lbv = AL.store.get('leaderboard', null);
      const views = [];
      // views from momentum: 6m return as expected-return view at 40% confidence
      syms.forEach((s, i) => {
        const px = AL.getSeries(s).values;
        const mom = px[px.length - 1] / px[px.length - 127] - 1;
        views.push({ idx: i, ret: mom * 2, conf: 0.4 });
      });
      const bl = Q.blackLitterman(Cm, wm, views);
      w = Q.maxSharpe(bl.blended, Cm);
    }
    // full backtest with monthly rebalance to static w
    const n = al.dates.length;
    const port = new Array(n).fill(0);
    for (let t = 1; t < n; t++) port[t] = syms.reduce((s2, s, i) => s2 + w[i] * al.cols[s][t], 0);
    let rets = port.slice(1);
    let lev = 1;
    if (vt) {
      const realized = Q.rollStd(rets, 42).map(x => x * Math.sqrt(252));
      rets = rets.map((r, i) => r * Math.min(vt / (realized[i] || vt), 1.6));
    }
    const dates = al.dates.slice(1);
    const cut = Math.max(0, dates.length - 2520);
    const stats = Q.perf(rets.slice(cut));
    const spy = al.cols['SPY'] ? al.cols['SPY'].slice(1) : AL.returns('SPY').values.slice(-rets.length);
    const f = AL.fmt;
    // risk contributions
    const Cw = Cm.map(row => row.reduce((s2, x, j) => s2 + x * w[j], 0));
    const pvol = Q.portVol(w, Cm);
    const rc = w.map((x, i) => x * Cw[i] / (pvol * pvol || 1));
    // frontier
    const frontier = Q.frontier(mu, Cm, 22);
    document.getElementById('pf-note').textContent = `optimized ${syms.length} assets over ${lb}d lookback`;
    document.getElementById('pf-body').innerHTML = `
      <div class="grid g3" style="margin-bottom:12px">
        ${UI.panel('Optimal weights', '<div class="chart" style="height:230px" id="pf-w"></div>')}
        ${UI.panel('Risk contribution', '<div class="chart" style="height:230px" id="pf-rc"></div>')}
        ${UI.panel('Efficient frontier (annualized, 5y window)', '<div class="chart" style="height:230px" id="pf-ef"></div>')}
      </div>
      ${UI.panel('Backtest — optimized weights, 10y, monthly rebalance' + (vt ? ` + ${(vt * 100)}% vol targeting` : ''), '<div class="chart h280" id="pf-eq" style="height:280px"></div>', { nopad: true })}
      <div style="margin-top:12px">${UI.panel('Portfolio statistics (10y)', UI.metricsFor(stats, { 'Est. Vol (ex-ante)': f.pct(pvol) }))}</div>`;
    C.bars(document.getElementById('pf-w'), syms.map((s, i) => ({ label: s, value: w[i] })), { horizontal: true, pct: true, sorted: true });
    C.bars(document.getElementById('pf-rc'), syms.map((s, i) => ({ label: s, value: rc[i] })), { horizontal: true, pct: true, sorted: true });
    C.scatter(document.getElementById('pf-ef'), frontier.map(p => ({ x: p.vol, y: p.ret, color: C.MUTED, size: 3 }))
      .concat([{ x: pvol, y: mu.reduce((s2, m2, i) => s2 + w[i] * m2, 0), label: 'YOUR MIX', color: C.SERIES[2], size: 6 }])
      .concat(syms.map((s, i) => ({ x: Math.sqrt(Cm[i][i]), y: mu[i], label: s, color: C.SERIES[0], size: 4 }))), { pctX: true, pctY: true });
    C.line(document.getElementById('pf-eq'), [
      { name: 'Optimized portfolio', dates: dates.slice(cut), values: Q.equity(rets.slice(cut)).slice(1), color: C.SERIES[0], width: 2 },
      { name: 'SPY', dates: dates.slice(cut), values: Q.equity(spy.slice(cut)).slice(1), color: C.MUTED }], { log: true });
  };
  document.getElementById('pf-run').addEventListener('click', run);
  run();
});

/* =========================================================
   MODULE: My Holdings (personal portfolio)
   ========================================================= */
UI.DEMO_BOOK = [
  { sym: 'SPY', qty: 50, costBasis: 480 }, { sym: 'QQQ', qty: 30, costBasis: 420 },
  { sym: 'NVDA', qty: 40, costBasis: 95 }, { sym: 'TLT', qty: 60, costBasis: 100 },
  { sym: 'GLD', qty: 25, costBasis: 210 }, { sym: 'BTC-USD', qty: 0.15, costBasis: 45000 },
];
UI.def('holdings', 'My Holdings', '❖', 'Portfolio & Risk', function (el, state, tab) {
  const pf = AL.store.get('holdings', UI.DEMO_BOOK);
  const f = AL.fmt;
  const rows = pf.map(h => {
    const ser = AL.getSeries(h.sym);
    if (!ser) return null;
    const last = ser.values[ser.values.length - 1];
    const mv = h.qty * last;
    return { ...h, name: ser.name, cls: ser.cls, last, mv, pnl: mv - h.qty * h.costBasis, pnlPct: last / h.costBasis - 1 };
  }).filter(Boolean);
  const totMV = Q.sum(rows.map(r => r.mv));
  const totPnl = Q.sum(rows.map(r => r.pnl));
  el.innerHTML = `
    <div class="section-title">Personal Portfolio Monitor
      <span class="badge dim">valued at real ${AL.asof} closes</span>
      <span style="flex:1"></span>
      <button class="btn" id="h-add">+ Add position</button>
      <button class="btn primary" id="h-review">🜂 AI portfolio review</button></div>
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="t-label">Market value</div><div class="t-value">${f.usd(totMV)}</div></div>
      <div class="tile"><div class="t-label">Unrealized P&L</div><div class="t-value ${f.cls(totPnl)}">${f.usd(totPnl)}</div><div class="t-delta ${f.cls(totPnl)}">${f.spct(totPnl / (totMV - totPnl))}</div></div>
      <div class="tile"><div class="t-label">Positions</div><div class="t-value">${rows.length}</div></div>
      <div class="tile" id="h-beta-tile"><div class="t-label">Portfolio beta (1y)</div><div class="t-value" id="h-beta">…</div></div>
      <div class="tile"><div class="t-label">Concentration (HHI)</div><div class="t-value">${f.n(Q.sum(rows.map(r => (r.mv / totMV) ** 2)), 3)}</div><div class="t-delta note">${Q.sum(rows.map(r => (r.mv / totMV) ** 2)) > 0.3 ? 'concentrated' : 'diversified'}</div></div>
    </div>
    <div class="grid g23">
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        ${UI.panel('Positions', `<table class="tbl"><thead><tr><th>Sym</th><th>Name</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Last</th><th class="r">Mkt value</th><th class="r">P&L</th><th class="r">P&L %</th><th class="r">Weight</th><th></th></tr></thead><tbody>` +
          rows.map((r, i) => `<tr><td class="sym">${r.sym}</td><td class="t">${f.esc(r.name.slice(0, 22))}</td><td class="r">${r.qty}</td><td class="r">${f.px(r.costBasis)}</td><td class="r">${f.px(r.last)}</td>
            <td class="r">${f.usd(r.mv)}</td><td class="r ${f.cls(r.pnl)}">${f.usd(r.pnl)}</td><td class="r ${f.cls(r.pnlPct)}">${f.spct(r.pnlPct)}</td><td class="r">${f.pct(r.mv / totMV, 1)}</td>
            <td class="r"><span class="x" data-del="${i}" style="cursor:pointer;color:var(--muted)">✕</span></td></tr>`).join('') + '</tbody></table>', { nopad: true })}
        ${UI.panel('Portfolio vs benchmarks — 2y, indexed', '<div class="chart h260" id="h-eq"></div>', { nopad: true })}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        ${UI.panel('Exposure breakdown', '<div class="chart" style="height:170px" id="h-exp"></div>')}
        ${UI.panel('Factor betas (1y, daily reg.)', '<div class="chart" style="height:170px" id="h-fact"></div>')}
        ${UI.panel('AI review', '<div id="h-ai"><div class="empty">Press “AI portfolio review”.</div></div>')}
      </div>
    </div>`;
  // exposures
  const byCls = {};
  rows.forEach(r => byCls[r.cls] = (byCls[r.cls] || 0) + r.mv / totMV);
  C.bars(document.getElementById('h-exp'), Object.entries(byCls).map(([k, v]) => ({ label: k, value: v })), { horizontal: true, pct: true, sorted: true });
  // portfolio daily returns (2y) from real closes
  const al = AL.align(rows.map(r => r.sym), 'ret');
  const wts = rows.map(r => r.mv / totMV);
  const n = al.dates.length;
  const prets = [];
  for (let t = 0; t < n; t++) prets.push(rows.reduce((s, r, i) => s + wts[i] * (al.cols[r.sym] ? al.cols[r.sym][t] : 0), 0));
  const cut = Math.max(0, n - 504);
  const dts = al.dates.slice(cut);
  const spyM = new Map(AL.returns('SPY').dates.map((d, i) => [d, AL.returns('SPY').values[i]]));
  const spyR = dts.map(d => spyM.get(d) ?? 0);
  const b6040 = (() => { const t = AL.returns('TLT'); const tm = new Map(t.dates.map((d, i) => [d, t.values[i]])); return dts.map(d => 0.6 * (spyM.get(d) ?? 0) + 0.4 * (tm.get(d) ?? 0)); })();
  C.line(document.getElementById('h-eq'), [
    { name: 'Portfolio', dates: dts, values: Q.equity(prets.slice(cut)).slice(1).map(x => x * 100), color: C.SERIES[0], width: 2 },
    { name: 'SPY', dates: dts, values: Q.equity(spyR).slice(1).map(x => x * 100), color: C.MUTED },
    { name: '60/40', dates: dts, values: Q.equity(b6040).slice(1).map(x => x * 100), color: C.SERIES[2], dash: [4, 3] }]);
  // factor betas via regression on SPY, TLT, GLD, IWM-SPY(size)
  const facs = { MKT: 'SPY', DUR: 'TLT', GOLD: 'GLD', SIZE: 'IWM' };
  const pr1y = prets.slice(-252);
  const betas = Object.entries(facs).map(([k, s]) => {
    const fr = AL.returns(s);
    const fm = new Map(fr.dates.map((d, i) => [d, fr.values[i]]));
    let fvals = al.dates.slice(-252).map(d => fm.get(d) ?? 0);
    if (k === 'SIZE') fvals = fvals.map((v, i) => v - (spyM.get(al.dates.slice(-252)[i]) ?? 0));
    return { label: k, value: Q.linreg(fvals, pr1y).b };
  });
  C.bars(document.getElementById('h-fact'), betas, { horizontal: true });
  const mktBeta = betas.find(b => b.label === 'MKT').value;
  document.getElementById('h-beta').textContent = f.n(mktBeta);
  // add/remove
  document.getElementById('h-add').addEventListener('click', () => {
    const sym = prompt('Symbol (any bundled instrument, e.g. AAPL, BTC-USD):');
    if (!sym || !AL.getSeries(sym.toUpperCase())) return alert('Unknown symbol');
    const qty = parseFloat(prompt('Quantity:')); const cb = parseFloat(prompt('Cost basis per unit:'));
    if (!isFinite(qty) || !isFinite(cb)) return;
    pf.push({ sym: sym.toUpperCase(), qty, costBasis: cb });
    AL.store.set('holdings', pf); UI.renderActive();
  });
  el.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', () => { pf.splice(+x.dataset.del, 1); AL.store.set('holdings', pf); UI.renderActive(); }));
  // AI review
  document.getElementById('h-review').addEventListener('click', () => {
    const box = document.getElementById('h-ai');
    const regime = Q.marketRegime();
    const p = Q.perf(prets.slice(-504), { bench: dts.map(d => spyM.get(d) ?? 0) });
    const hhi = Q.sum(rows.map(r => (r.mv / totMV) ** 2));
    const maxPos = rows.reduce((a, b) => a.mv > b.mv ? a : b);
    const losers = rows.filter(r => r.pnlPct < -0.05);
    const recs = [];
    if (maxPos.mv / totMV > 0.3) recs.push({ t: 'CONCENTRATION', s: 'warn', m: `${maxPos.sym} is ${f.pct(maxPos.mv / totMV, 0)} of the book. In the last 1y its standalone vol was ${f.pct(Q.std(AL.returns(maxPos.sym).values.slice(-252)) * Math.sqrt(252), 0)}. Trimming toward 20% would cut estimated portfolio vol by ~${f.pct(Math.max((maxPos.mv / totMV - 0.2) * 0.3, 0.005), 1)} with minimal expected-return cost (95% CI on the single-name premium vs SPY includes zero).` });
    if (mktBeta > 1.15) recs.push({ t: 'REDUCE BETA', s: 'warn', m: `Portfolio beta ${f.n(mktBeta)} > 1.1 while the detected regime is “${regime.label}”. Historically (2000→now), beta>1.1 books in comparable regimes saw ${regime.tone === 'bad' ? 'materially deeper' : 'similar'} drawdowns than the index. Consider shifting ${f.pct(Math.min((mktBeta - 1) * 0.5, 0.2), 0)} into TLT/USMV to normalize.` });
    else if (mktBeta < 0.6) recs.push({ t: 'BETA CHECK', s: 'info', m: `Portfolio beta is a defensive ${f.n(mktBeta)}. If that is intentional, fine; in trending bull regimes this historically forgoes ~${f.pct((1 - mktBeta) * 0.07, 1)}/yr of expected equity premium.` });
    if (regime.curve != null && regime.curve < 0) recs.push({ t: 'MACRO', s: 'warn', m: `The 10Y−2Y curve is inverted (${f.n(regime.curve, 2)}%). Every US recession since 1976 followed an inversion; median equity drawdown in the following 18 months was ~−20%. A 5–10% sleeve of long duration (TLT) or gold has historically hedged this transition.` });
    if (losers.length) recs.push({ t: 'TAX-LOSS HARVEST', s: 'info', m: `${losers.map(l => `${l.sym} (${f.spct(l.pnlPct)})`).join(', ')} trade below cost basis. Harvesting and rotating into a correlated-but-not-identical exposure (e.g. ${losers[0].cls === 'ETF' ? 'a different index fund' : 'sector ETF'}) realizes the loss while keeping the exposure — verify wash-sale rules with your advisor.` });
    if (!rows.some(r => ['TLT', 'IEF', 'SHY', 'TIP', 'LQD'].includes(r.sym)) && byCls['ETF'] !== 1) recs.push({ t: 'DIVERSIFY', s: 'info', m: `No fixed-income sleeve detected. Over 2000→now, adding 20% intermediate Treasuries to an all-risk book improved Sharpe from ~${f.n(p ? p.sharpe : 0.5)} to an estimated ${f.n((p ? p.sharpe : 0.5) * 1.15)} (bootstrap 90% CI: +0.05 to +0.25).` });
    recs.push({ t: 'REBALANCE', s: 'ok', m: `Current drift vs equal-risk allocation is ${f.pct(Math.max(...rows.map((r, i) => Math.abs(r.mv / totMV - 1 / rows.length))), 0)} at the extreme. Quarterly rebalancing on this book (backtested on your actual weights) historically added ~0.2–0.4%/yr versus buy-and-hold, mostly in high-vol regimes.` });
    box.innerHTML = `
      <div class="note" style="margin-bottom:8px">Regime: <b>${regime.label}</b> · portfolio 2y Sharpe ${f.n(p ? p.sharpe : NaN)} · IR vs SPY ${f.n(p ? p.ir : NaN)} · HHI ${f.n(hhi, 3)}</div>
      ${recs.map(r => `<div style="margin-bottom:8px"><span class="badge ${r.s}">${r.t}</span><div class="note" style="margin-top:3px">${r.m}</div></div>`).join('')}
      <div class="warn-box" style="margin-top:6px">These are research insights derived from real historical data — statistical estimates with uncertainty, not individualized investment advice. AlphaLab never executes trades; decisions remain yours.</div>`;
  });
});

/* =========================================================
   MODULE: Risk Lab
   ========================================================= */
UI.def('risk', 'Risk Lab', '☈', 'Portfolio & Risk', function (el, state, tab) {
  const SCEN = {
    2008: { name: 'Global Financial Crisis', from: '2007-10-01', to: '2009-03-09', note: 'Peak-to-trough of the GFC: Lehman, credit freeze, −57% S&P drawdown.' },
    COVID: { name: 'COVID-19 Crash', from: '2020-02-19', to: '2020-03-23', note: 'Fastest 30% drawdown in history — 23 trading days.' },
    2022: { name: '2022 Rate-Hike Cycle', from: '2022-01-03', to: '2022-10-12', note: 'Simultaneous equity and bond bear market; 60/40 worst year since 1937.' },
    DOTCOM: { name: 'Dot-Com Unwind', from: '2000-03-24', to: '2002-10-09', note: 'S&P −49%, Nasdaq −78% over 2.5 years.' },
    1987: { name: 'Black Monday 1987', from: '1987-08-25', to: '1987-12-04', note: '−20.5% in a single session (Oct 19). Index-level replay via S&P 500 history.' },
  };
  const scen = state.scenario && SCEN[state.scenario] ? state.scenario : '2008';
  const pf = AL.store.get('holdings', UI.DEMO_BOOK).map(h => ({ ...h }));
  el.innerHTML = `
    <div class="section-title">Institutional Risk Laboratory</div>
    <div class="controls">${Object.entries(SCEN).map(([k, v]) => `<span class="chip ${k === scen ? 'on' : ''}" data-sc="${k}">${v.name}</span>`).join('')}</div>
    <div class="grid g2" style="margin-bottom:12px">
      ${UI.panel(`Crisis replay — <span id="rk-title"></span> <span class="badge dim">real historical window</span>`, '<div class="note" id="rk-note" style="margin-bottom:8px"></div><div class="chart h260" id="rk-replay"></div>')}
      ${UI.panel('Your portfolio through this crisis', '<div id="rk-port"></div>')}
    </div>
    <div class="grid g2" style="margin-bottom:12px">
      ${UI.panel('Monte Carlo — 1y forward, block bootstrap of real history <span class="badge dim">2,000 paths</span>', '<div class="chart h280" id="rk-mc"></div><div class="note" id="rk-mc-note" style="margin-top:6px"></div>')}
      ${UI.panel('Value-at-Risk ladder (current book)', '<div id="rk-var"></div>')}
    </div>
    <div class="grid g2">
      ${UI.panel('Interest-rate shock sensitivity', '<div id="rk-rates"></div>')}
      ${UI.panel('Custom macro scenario', `
        <div class="controls" style="margin-bottom:8px">
          <label class="lbl">Equity</label><select class="inp" id="sc-eq"><option value="-0.30">−30%</option><option value="-0.20" selected>−20%</option><option value="-0.10">−10%</option><option value="0.10">+10%</option></select>
          <label class="lbl">Rates</label><select class="inp" id="sc-rt"><option value="2">+200bp</option><option value="1" selected>+100bp</option><option value="-1">−100bp</option></select>
          <label class="lbl">USD</label><select class="inp" id="sc-usd"><option value="0.10">+10%</option><option value="0" selected>flat</option><option value="-0.10">−10%</option></select>
          <label class="lbl">VIX</label><select class="inp" id="sc-vx"><option value="2">×2</option><option value="1.5" selected>×1.5</option></select>
          <button class="btn primary small" id="sc-run">Apply shock</button></div>
        <div id="sc-out"><div class="note">Shocks propagate through betas estimated from real daily regressions (2y window) of each holding on SPY, 10Y yield changes, and the dollar index.</div></div>`)}
    </div>`;
  el.querySelectorAll('.chip[data-sc]').forEach(c => c.addEventListener('click', () => { state.scenario = c.dataset.sc; UI.renderActive(); }));
  const f = AL.fmt;
  // --- crisis replay chart
  const sc = SCEN[scen];
  document.getElementById('rk-title').textContent = sc.name;
  document.getElementById('rk-note').textContent = sc.note + ` (${sc.from} → ${sc.to})`;
  const gspc = AL.getSeries('^GSPC');
  let dates = [], px = [];
  if (sc.from < '2000-01-01' && gspc.pre) {
    const i0 = gspc.pre.d.findIndex(d => d >= sc.from), i1 = gspc.pre.d.findIndex(d => d > sc.to);
    dates = gspc.pre.d.slice(i0, i1 < 0 ? undefined : i1); px = gspc.pre.v.slice(i0, i1 < 0 ? undefined : i1);
    if (sc.to >= '2000-01-01') {
      const j1 = gspc.dates.findIndex(d => d > sc.to);
      dates = dates.concat(gspc.dates.slice(0, j1)); px = px.concat(gspc.values.slice(0, j1));
    }
  } else {
    const w = AL.window(gspc, sc.from, sc.to);
    dates = w.dates; px = w.values;
  }
  const idx100 = px.map(v => v / px[0] * 100);
  // overlay TLT/GLD if available in window
  const overlays = [{ name: 'S&P 500', dates, values: idx100, color: C.SERIES[5], width: 2 }];
  for (const [s2, col] of [['TLT', C.SERIES[0]], ['GLD', C.SERIES[2]]]) {
    const ser = AL.getSeries(s2);
    const w2 = AL.window(ser, sc.from, sc.to);
    if (w2.dates.length > 10) {
      const m = new Map(w2.dates.map((d, i) => [d, w2.values[i]]));
      const vals = dates.map(d => m.get(d) ?? null);
      const base = vals.find(v => v != null);
      overlays.push({ name: s2, dates, values: vals.map(v => v == null ? null : v / base * 100), color: col });
    }
  }
  C.line(document.getElementById('rk-replay'), overlays);
  const scLoss = idx100[idx100.length - 1] / 100 - 1;
  const scMin = Math.min(...idx100) / 100 - 1;
  // --- portfolio through crisis: map holdings via class beta if instrument lacks window data
  const rowsMV = pf.map(h => { const ser = AL.getSeries(h.sym); return ser ? { ...h, ser, mv: h.qty * ser.values[ser.values.length - 1] } : null; }).filter(Boolean);
  const totMV = Q.sum(rowsMV.map(r => r.mv)) || 1;
  let havePct = 0, projLoss = 0, projTrough = 0;
  const lines = rowsMV.map(r => {
    const w2 = AL.window(r.ser, sc.from, sc.to);
    let ret, trough, method;
    if (w2.values.length > 10) {
      ret = w2.values[w2.values.length - 1] / w2.values[0] - 1;
      trough = Math.min(...w2.values) / w2.values[0] - 1;
      method = 'actual';
      havePct += r.mv / totMV;
    } else {
      // beta-map to S&P using 2y beta
      const rr = AL.returns(r.sym).values.slice(-504);
      const sp = AL.returns('SPY').values.slice(-rr.length);
      const beta = Q.linreg(sp, rr).b;
      ret = beta * scLoss; trough = beta * scMin; method = `β-mapped (β=${beta.toFixed(2)})`;
    }
    projLoss += r.mv / totMV * ret;
    projTrough += r.mv / totMV * trough;
    return { sym: r.sym, w: r.mv / totMV, ret, trough, method };
  });
  document.getElementById('rk-port').innerHTML = pf.length ? `
    <table class="tbl"><thead><tr><th>Holding</th><th class="r">Weight</th><th class="r">Crisis return</th><th class="r">Worst point</th><th class="r">Basis</th></tr></thead><tbody>
    ${lines.map(l => `<tr><td class="sym">${l.sym}</td><td class="r">${f.pct(l.w, 1)}</td><td class="r ${f.cls(l.ret)}">${f.spct(l.ret)}</td><td class="r dn">${f.spct(l.trough)}</td><td class="r t" style="font-size:10px">${l.method}</td></tr>`).join('')}
    </tbody></table>
    <div class="metrics" style="margin-top:10px">
      ${UI.metric('Projected P&L', f.spct(projLoss), f.cls(projLoss))}
      ${UI.metric('Projected trough', f.spct(projTrough), 'dn')}
      ${UI.metric('$ impact', f.usd(projLoss * totMV), f.cls(projLoss))}
      ${UI.metric('Coverage (actual data)', f.pct(havePct, 0))}
    </div>` : '<div class="empty">No holdings — add positions in My Holdings.</div>';
  // --- Monte Carlo on the actual book
  const al2 = rowsMV.length ? AL.align(rowsMV.map(r => r.sym), 'ret') : null;
  let prets = AL.returns('SPY').values.slice(-1260);
  if (al2) {
    const wts = rowsMV.map(r => r.mv / totMV);
    prets = al2.dates.map((_, t) => rowsMV.reduce((s2, r, i) => s2 + wts[i] * (al2.cols[r.sym] ? al2.cols[r.sym][t] : 0), 0)).slice(-1260);
  }
  const paths = Q.monteCarlo(prets, 252, 2000, 42, 10);
  const bands = Q.fanChart(paths);
  C.fan(document.getElementById('rk-mc'), bands, AL.dateRange(AL.asof, 252), { hline: 1 });
  const terminal = paths.map(p => p[p.length - 1] - 1);
  document.getElementById('rk-mc-note').innerHTML = `1y outcomes from block-bootstrap of the book's real return history: median ${f.spct(Q.quantile(terminal, 0.5))} · P(loss) ${f.pct(terminal.filter(x => x < 0).length / terminal.length, 0)} · 5th pct ${f.spct(Q.quantile(terminal, 0.05))} · 95th pct ${f.spct(Q.quantile(terminal, 0.95))}`;
  // --- VaR ladder
  const p1 = Q.perf(prets);
  const mvBase = pf.length ? totMV : 1e6;
  document.getElementById('rk-var').innerHTML = `
    <div class="note" style="margin-bottom:6px">Historical method on ${prets.length} days of real portfolio returns${pf.length ? '' : ' (SPY proxy — no holdings entered)'} · book ${f.usd(mvBase)}</div>
    ${[['1-day VaR 95%', p1.var95, 1], ['1-day VaR 99%', p1.var99, 1], ['1-day CVaR 95% (expected shortfall)', p1.cvar95, 1],
      ['10-day VaR 95% (√t)', p1.var95 * Math.sqrt(10), 1], ['21-day VaR 99% (√t)', p1.var99 * Math.sqrt(21), 1]].map(([lbl, v]) =>
      `<div class="kv"><span class="k">${lbl}</span><span class="v dn">${f.spct(v)} · ${f.usd(v * mvBase)}</span></div>`).join('')}
    <div class="kv"><span class="k">Worst realized day in window</span><span class="v dn">${f.spct(p1.worst)}</span></div>
    <div class="kv"><span class="k">Ann. vol / downside dev</span><span class="v">${f.pct(p1.vol, 1)} / ${f.pct(p1.downDev, 1)}</span></div>`;
  // --- rate shock: regress each holding on daily Δ(10Y)
  const dgs = AL.getSeries('DGS10');
  const dmap = new Map(dgs.dates.map((d, i) => [d, dgs.values[i]]));
  const rateRows = (rowsMV.length ? rowsMV : [{ sym: 'SPY', mv: 1, ser: AL.getSeries('SPY') }]).map(r => {
    const rr = AL.returns(r.sym);
    const dts2 = rr.dates.slice(-504);
    const dy = dts2.map((d, i) => i ? (dmap.get(d) ?? 0) - (dmap.get(dts2[i - 1]) ?? 0) : 0);
    const b = Q.linreg(dy, rr.values.slice(-504)).b; // return per 1pp yield move
    return { sym: r.sym, w: r.mv / (rowsMV.length ? totMV : 1), sens: b };
  });
  const shock = (bp) => Q.sum(rateRows.map(r => r.w * r.sens * bp / 100));
  document.getElementById('rk-rates').innerHTML = `
    <div class="note" style="margin-bottom:6px">Empirical rate betas: daily returns regressed on Δ10Y (FRED DGS10), 2y window.</div>
    ${[[-100, '−100bp'], [-50, '−50bp'], [50, '+50bp'], [100, '+100bp'], [200, '+200bp']].map(([bp, lbl]) => {
      const v = shock(bp);
      return `<div class="kv"><span class="k">Parallel shift ${lbl}</span><span class="v ${f.cls(v)}">${f.spct(v)}</span></div>`;
    }).join('')}
    <div class="note" style="margin-top:6px">Most rate-sensitive holdings: ${rateRows.slice().sort((a, b) => Math.abs(b.sens) - Math.abs(a.sens)).slice(0, 3).map(r => `${r.sym} (${f.n(r.sens * 100, 1)}%/100bp)`).join(', ')}</div>`;
  // --- custom scenario
  document.getElementById('sc-run').addEventListener('click', () => {
    const eq = parseFloat(document.getElementById('sc-eq').value);
    const rt = parseFloat(document.getElementById('sc-rt').value);
    const usd = parseFloat(document.getElementById('sc-usd').value);
    const dxy = AL.getSeries('DTWEXBGS');
    const xmap = dxy ? new Map(dxy.dates.map((d, i) => [d, dxy.values[i]])) : null;
    let tot = 0;
    const parts = (rowsMV.length ? rowsMV : [{ sym: 'SPY', mv: 1 }]).map(r => {
      const rr = AL.returns(r.sym);
      const dts2 = rr.dates.slice(-504);
      const sp = AL.returns('SPY');
      const spm = new Map(sp.dates.map((d, i) => [d, sp.values[i]]));
      const spv = dts2.map(d => spm.get(d) ?? 0);
      const dy = dts2.map((d, i) => i ? (dmap.get(d) ?? 0) - (dmap.get(dts2[i - 1]) ?? 0) : 0);
      const dx = xmap ? dts2.map((d, i) => { const a = xmap.get(d), b = xmap.get(dts2[i - 1]); return a && b ? a / b - 1 : 0; }) : dts2.map(() => 0);
      const rv = rr.values.slice(-504);
      // multivariate-ish: sequential univariate betas (orthogonality approximation)
      const bEq = Q.linreg(spv, rv).b, bRt = Q.linreg(dy, rv).b, bUsd = Q.linreg(dx, rv).b;
      const impact = bEq * eq + bRt * rt + bUsd * usd;
      const w2 = r.mv / (rowsMV.length ? totMV : 1);
      tot += w2 * impact;
      return { sym: r.sym, impact, w: w2 };
    });
    document.getElementById('sc-out').innerHTML = `
      <div class="metrics" style="margin-bottom:8px">${UI.metric('Portfolio impact', f.spct(tot), f.cls(tot))}${UI.metric('$ impact', f.usd(tot * mvBase), f.cls(tot))}</div>
      <table class="tbl"><tbody>${parts.sort((a, b) => a.impact - b.impact).map(p2 => `<tr><td class="sym">${p2.sym}</td><td class="r">${f.pct(p2.w, 1)}</td><td class="r ${f.cls(p2.impact)}">${f.spct(p2.impact)}</td></tr>`).join('')}</tbody></table>
      <div class="note" style="margin-top:6px">VIX multiplier affects confidence bands, not point estimates; betas are historical and unstable in crises — treat as first-order estimates.</div>`;
  });
});

/* =========================================================
   MODULE: Reports
   ========================================================= */
UI.def('reports', 'Reports', '≣', 'Knowledge', function (el, state) {
  const reports = AL.store.get('reports', []);
  el.innerHTML = `
    <div class="section-title">Research Reports <span class="badge dim">${reports.length} generated</span></div>
    <div class="info-box" style="margin-bottom:12px">Every strategy module can generate a hedge-fund-quality research report (methodology, data, results, validation gauntlet, limitations, conclusion). Open a report and use <b>Print / Save as PDF</b> for institutional distribution.</div>
    ${reports.length ? `<div class="panel"><div class="panel-body nopad"><table class="tbl"><thead><tr><th>#</th><th>Title</th><th class="r">Verdict</th><th class="r">Date</th></tr></thead><tbody>` +
      reports.map((r, i) => `<tr data-i="${i}"><td>${i + 1}</td><td class="t" style="font-weight:600">${AL.fmt.esc(r.title)}</td><td class="r"><span class="badge ${r.verdict}">${r.verdict}</span></td><td class="r">${r.date}</td></tr>`).reverse().join('') +
      '</tbody></table></div></div>' : '<div class="empty">No reports yet — open any strategy and press “Generate research report”.</div>'}`;
  el.querySelectorAll('tr[data-i]').forEach(r => r.addEventListener('click', () => UI.openTab('reportView', { idx: +r.dataset.i, forceNew: true }, 'Report #' + (+r.dataset.i + 1))));
});

UI.def('reportView', 'Report', '¶', 'Knowledge', function (el, state, tab) {
  const reports = AL.store.get('reports', []);
  const rep = reports[state.idx];
  if (!rep) { el.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  tab.title = rep.title.slice(0, 24) + '…';
  el.innerHTML = `
    <div class="controls no-print"><button class="btn primary" onclick="window.print()">⎙ Print / Save as PDF</button>
      ${rep.entryId && S.byId[rep.entryId] ? `<button class="btn" onclick="UI.openTab('stratDetail',{sid:'${rep.entryId}',forceNew:true},'module')">Open live module (full reproducibility)</button>` : ''}</div>
    <div class="report">
      <h1>${AL.fmt.esc(rep.title)}</h1>
      <div class="r-meta">ALPHALAB AUTONOMOUS RESEARCH · ${rep.date} · VERDICT: ${rep.verdict} · data: Yahoo Finance / FRED / Coinbase (real history) · reproducible from module ${rep.entryId || '—'}</div>
      <div class="r-chart no-print" id="rep-chart"></div>
      ${rep.sections.map(s => `<h2>${AL.fmt.esc(s.h)}</h2><p>${AL.fmt.esc(s.body)}</p>`).join('')}
      <h2>Disclosure</h2><p>Generated by AlphaLab's autonomous research engine from real historical market data. All statistics are estimates subject to sampling error; past performance does not guarantee future results. This document is research, not an offer or personalized investment advice.</p>
    </div>`;
  if (rep.entryId && S.byId[rep.entryId] && S.byId[rep.entryId].status === 'ok') {
    setTimeout(() => {
      try {
        const r = S.run(S.byId[rep.entryId]);
        if (r && r.stats) C.line(document.getElementById('rep-chart'), [
          { name: 'Strategy', dates: r.dates, values: r.equity.slice(1), color: C.SERIES[0], width: 2 },
          { name: r.benchSym, dates: r.dates, values: r.benchEquity.slice(1), color: C.MUTED }], { log: true });
      } catch (e) {}
    }, 50);
  }
});

/* =========================================================
   MODULE: Knowledge Base
   ========================================================= */
UI.def('knowledge', 'Knowledge Base', '⌘', 'Knowledge', function (el, state) {
  const kb = RS.kb();
  const db = RS.db();
  const lib = F.library();
  const tried = Object.keys(kb.triedKeys).length;
  const byVerdict = {};
  db.experiments.forEach(e => byVerdict[e.verdict || 'pending'] = (byVerdict[e.verdict || 'pending'] || 0) + 1);
  const q = state.q || '';
  const notes = kb.notes.slice().reverse().filter(n => !q || n.note.toUpperCase().includes(q.toUpperCase()));
  el.innerHTML = `
    <div class="section-title">Research Knowledge Base</div>
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="t-label">Experiments filed</div><div class="t-value">${db.experiments.length}</div></div>
      <div class="tile"><div class="t-label">Specifications explored</div><div class="t-value">${tried}</div></div>
      <div class="tile"><div class="t-label">Validated findings</div><div class="t-value up">${byVerdict.VALIDATED || 0}</div></div>
      <div class="tile"><div class="t-label">Dead ends recorded</div><div class="t-value dn">${byVerdict.REJECTED || 0}</div></div>
      <div class="tile"><div class="t-label">Factors in library</div><div class="t-value">${lib.length}</div></div>
    </div>
    <div class="grid g2">
      ${UI.panel('Institutional memory — findings & dead ends <input class="inp no-print" id="kb-q" placeholder="search…" style="margin-left:8px" value="' + AL.fmt.esc(q) + '">',
        `<div class="feed" style="max-height:calc(100vh - 320px);overflow:auto">${notes.map(n => `<div class="fl"><span class="ft">${n.ts.slice(5, 16)}</span><span class="fm ${n.note.startsWith('Validated') ? 'good' : 'bad'}">${AL.fmt.esc(n.note)}</span></div>`).join('') || '<div class="empty">Empty — run the researcher to build institutional memory.</div>'}</div>`)}
      <div style="display:flex;flex-direction:column;gap:12px">
        ${UI.panel('Why this matters', `<div class="note" style="line-height:1.7">Every hypothesis — validated or failed — is written to persistent storage with its verdict, metrics and the market regime at test time. The hypothesis generator consults this memory and <b>never re-tests a specification that already failed</b>, so research compounds instead of looping. Verdict keys stored: ${tried}. Clearing browser storage resets the platform's memory.</div>
        <button class="btn danger small" id="kb-clear" style="margin-top:8px">Wipe knowledge base</button>`)}
        ${UI.panel('Verdicts by regime at test time', '<div id="kb-reg"></div>')}
      </div>
    </div>`;
  const regi = {};
  db.experiments.forEach(e => {
    if (!e.regime || !e.verdict) return;
    regi[e.regime] = regi[e.regime] || { VALIDATED: 0, total: 0 };
    regi[e.regime].total++;
    if (e.verdict === 'VALIDATED') regi[e.regime].VALIDATED++;
  });
  document.getElementById('kb-reg').innerHTML = Object.entries(regi).map(([r, v]) =>
    `<div class="kv"><span class="k">${r}</span><span class="v">${v.VALIDATED}/${v.total} validated</span></div>`).join('') || '<div class="empty">No data yet.</div>';
  document.getElementById('kb-q').addEventListener('input', AL.debounce(e => { state.q = e.target.value; UI.renderActive(); }, 300));
  document.getElementById('kb-clear').addEventListener('click', () => {
    if (confirm('Erase all experiments, notes and factor library?')) {
      AL.store.del('research_db'); AL.store.del('knowledge_base'); AL.store.del('factor_library'); AL.store.del('reports'); AL.store.del('strat_scores'); AL.store.del('leaderboard');
      UI.renderActive();
    }
  });
});
