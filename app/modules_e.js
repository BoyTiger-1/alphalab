/* modules E: the Quant Toolkit. Market structure map (PCA + clusters),
   build-your-own strategy composer, seasonality explorer, drawdown analyzer. */
'use strict';

/* =========================================================
   MODULE: Market Structure (PCA map + k-means clusters)
   ========================================================= */
UI.def('structure', 'Market Structure', '⬡', 'Quant Toolkit', function (el, state, tab) {
  const sp = AL.sp500();
  el.innerHTML = `
    <div class="section-title">Market Structure Laboratory
      <span class="badge dim">PCA + k-means on real weekly returns</span>
      <span style="flex:1"></span>
      <label class="lbl">stocks</label><select class="inp" id="ms-n"><option>150</option><option selected>300</option><option>500</option></select>
      <label class="lbl">clusters</label><select class="inp" id="ms-k"><option>4</option><option selected>6</option><option>8</option></select>
      <button class="btn primary" id="ms-run">Map the market</button></div>
    <div class="info-box" style="margin-bottom:12px">Principal component analysis compresses two years of weekly returns for hundreds of stocks into two axes: PC1 is almost always "the market factor" (everything loads on it in a selloff) and PC2 usually separates rate-sensitive from growth-sensitive names. K-means then finds groups of stocks that trade together regardless of their official sector label. Stocks that sit far from their sector's cluster are the interesting ones: the market prices them differently than their industry.</div>
    <div id="ms-body">${sp ? '<div class="empty">Press "Map the market".</div>' : '<div class="empty">Needs the S&P 500 weekly bundle.</div>'}</div>`;
  if (!sp) return;
  const run = () => {
    document.getElementById('ms-body').innerHTML = '<div class="empty">Computing eigenvectors...</div>';
    setTimeout(() => {
      const N = +document.getElementById('ms-n').value;
      const K = +document.getElementById('ms-k').value;
      // biggest N stocks with full 2y coverage, weekly returns matrix (weeks x stocks)
      const wc = sp.wcal;
      const period = 104;
      const names = Object.entries(sp.cols)
        .filter(([, e]) => e.f + period < wc.length && e.c.length >= period + 2)
        .slice(0, N);
      const rets = names.map(([sym, e]) => {
        const k = Math.pow(10, e.s);
        const px = e.c.map(v => v / k).slice(-(period + 1));
        return px.slice(1).map((v, i) => v / px[i] - 1);
      });
      // X: observations are weeks, features are stocks
      const X = [];
      for (let t = 0; t < period; t++) X.push(rets.map(r => r[t]));
      const pca = ML.pca(X, 2);
      // per-stock loadings on the two components
      const pts = names.map(([sym, e], j) => ({
        sym, sector: e.sec,
        x: pca.comps[0][j], y: pca.comps[1][j],
      }));
      // cluster stocks in loading space
      const km = ML.kmeans(pts.map(p => [p.x * 10, p.y * 10]), K, 5);
      pts.forEach((p, i) => p.cluster = km.assign[i]);
      const sectors = [...new Set(pts.map(p => p.sector))].sort();
      const secColor = Object.fromEntries(sectors.map((s, i) => [s, C.SERIES[i % 8]]));
      // sector coherence: how often do two same-sector stocks share a cluster
      const coherence = sectors.map(sec => {
        const mine = pts.filter(p => p.sector === sec);
        if (mine.length < 3) return { sec, score: null, n: mine.length };
        const counts = {};
        mine.forEach(p => counts[p.cluster] = (counts[p.cluster] || 0) + 1);
        return { sec, score: Math.max(...Object.values(counts)) / mine.length, n: mine.length };
      }).filter(c => c.score != null).sort((a, b) => b.score - a.score);
      document.getElementById('ms-body').innerHTML = `
        <div class="grid g23">
          ${UI.panel(`Factor map, ${pts.length} stocks (PC1 explains ${AL.fmt.pct(pca.explained[0], 0)}, PC2 ${AL.fmt.pct(pca.explained[1], 0)})`, '<div class="chart" style="height:430px" id="ms-map"></div><div class="note" id="ms-legend" style="margin-top:6px"></div>', { nopad: false })}
          <div style="display:flex;flex-direction:column;gap:12px">
            ${UI.panel('Sector coherence (share of sector in its dominant cluster)', '<div class="chart" style="height:250px" id="ms-coh"></div>')}
            ${UI.panel('Reading the map', `<div class="note" style="line-height:1.7">Tight clumps trade as one block; spread-out sectors contain genuinely different businesses. Names far from everything are idiosyncratic: they diversify a portfolio but resist top-down analysis. Hover any dot for its ticker, sector, and cluster.</div>`)}
          </div>
        </div>`;
      C.scatter(document.getElementById('ms-map'), pts.map(p => ({
        x: p.x, y: p.y, label: pts.length <= 60 ? p.sym : '',
        color: secColor[p.sector], size: 4,
        // tooltip label carries the full identity since dots outnumber labels
        tip: `${p.sym} · ${p.sector} · cluster ${p.cluster + 1}`,
      })), {});
      document.getElementById('ms-legend').innerHTML = sectors.map(s =>
        `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><span style="width:8px;height:8px;border-radius:2px;background:${secColor[s]};display:inline-block"></span>${AL.fmt.esc(s)}</span>`).join('');
      C.bars(document.getElementById('ms-coh'), coherence.map(c => ({ label: c.sec.slice(0, 14), value: c.score })), { horizontal: true, pct: true });
    }, 30);
  };
  document.getElementById('ms-run').addEventListener('click', run);
  run();
});

/* =========================================================
   MODULE: Strategy Composer (build your own, no code)
   ========================================================= */
UI.def('composer', 'Strategy Composer', '⚒', 'Quant Toolkit', function (el, state, tab) {
  // the engines a user can drive from dropdowns, with editable parameter specs
  const ENGINES = {
    smaCross: { name: 'Moving average cross', params: { fast: 50, slow: 200 }, desc: 'Long when the fast average is above the slow.' },
    emaCross: { name: 'Exponential MA cross', params: { fast: 21, slow: 84 }, desc: 'Same idea, recent prices weigh more.' },
    donchian: { name: 'Channel breakout', params: { n: 55 }, desc: 'Buy new N-day highs, exit on new lows.' },
    tsMom: { name: 'Time-series momentum', params: { n: 252, skip: 21 }, desc: 'Long when the trailing return is positive.' },
    meanRevZ: { name: 'Z-score mean reversion', params: { n: 21, entry: 2, exit: 0.3 }, desc: 'Buy deep dips below the rolling mean.' },
    rsiRev: { name: 'RSI reversal', params: { n: 14, lo: 30, hi: 70 }, desc: 'Buy oversold, exit overbought.' },
    bollinger: { name: 'Bollinger reversion', params: { n: 20, k: 2 }, desc: 'Buy band touches, exit at the middle.' },
    volTargetHold: { name: 'Volatility targeting', params: { n: 20, target: 0.12, maxLev: 1.5 }, desc: 'Always long, sized to constant risk.' },
    volBreakout: { name: 'Volatility breakout', params: { n: 20, k: 2 }, desc: 'Enter on unusually large single moves.' },
    high52w: { name: '52-week high proximity', params: { tol: 0.02 }, desc: 'Hold only near the yearly high.' },
    vixRegime: { name: 'VIX regime filter', params: { n: 63 }, desc: 'Long only when VIX is below its own average.' },
    hmmSwitch: { name: 'HMM regime switching', params: {}, desc: 'Exposure follows a hidden Markov calm-state probability.' },
  };
  const syms = ['SPY', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM', 'TLT', 'GLD', 'SLV', 'USO', 'HYG', 'VNQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'JPM', 'XOM', 'BTC-USD', 'ETH-USD', 'CL=F', 'GC=F', 'EURUSD=X'];
  const eng = state.eng || 'smaCross';
  el.innerHTML = `
    <div class="section-title">Strategy Composer <span class="badge dim">design your own, no code</span></div>
    <div class="info-box" style="margin-bottom:12px">Pick an instrument and a signal engine, set the parameters, and AlphaLab runs the exact same institutional pipeline the built-in library uses: 1-day signal lag, transaction costs, the full metric suite, and the 5-check validation gauntlet. Compose, test, reject, iterate. Saved compositions appear in your Reports.</div>
    <div class="controls">
      <label class="lbl">instrument</label><select class="inp" id="cp-sym">${syms.map(s => `<option ${s === (state.sym || 'SPY') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label class="lbl">engine</label><select class="inp" id="cp-eng">${Object.entries(ENGINES).map(([k, v]) => `<option value="${k}" ${k === eng ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
      <span id="cp-params"></span>
      <label class="lbl">short side</label><select class="inp" id="cp-short"><option value="">no</option><option value="1">yes</option></select>
      <label class="lbl">cost bp</label><input class="inp" style="width:56px" id="cp-cost" value="5">
      <button class="btn primary" id="cp-run">Run pipeline</button></div>
    <div class="note" id="cp-desc" style="margin-bottom:10px"></div>
    <div id="cp-out"><div class="empty">Compose a strategy and run it.</div></div>`;
  const renderParams = () => {
    const e = ENGINES[document.getElementById('cp-eng').value];
    document.getElementById('cp-desc').textContent = e.desc;
    document.getElementById('cp-params').innerHTML = Object.entries(e.params)
      .map(([k, v]) => `<label class="lbl">${k}</label><input class="inp" style="width:60px" data-cp="${k}" value="${v}">`).join('');
  };
  renderParams();
  document.getElementById('cp-eng').addEventListener('change', renderParams);
  document.getElementById('cp-run').addEventListener('click', () => {
    const engine = document.getElementById('cp-eng').value;
    const sym = document.getElementById('cp-sym').value;
    const params = { ...ENGINES[engine].params };
    el.querySelectorAll('[data-cp]').forEach(inp => { const v = parseFloat(inp.value); if (isFinite(v)) params[inp.dataset.cp] = v; });
    if (document.getElementById('cp-short').value) params.short = true;
    state.sym = sym; state.eng = engine;
    // hand the composition to the same detail workbench the library uses
    const entry = {
      id: 'CUSTOM', cat: 'Custom Composition',
      name: `${ENGINES[engine].name} on ${sym}`,
      def: { kind: 'single', sym, engine, params },
      desc: `User-composed strategy: ${ENGINES[engine].desc} Instrument: ${sym}. Parameters: ${JSON.stringify(params)}.`,
      bench: sym, cost: +document.getElementById('cp-cost').value || 5, status: 'ok',
    };
    UI.openTab('stratDetail', { adhoc: entry, forceNew: true }, 'Custom: ' + sym);
  });
});

/* =========================================================
   MODULE: Seasonality Explorer
   ========================================================= */
UI.def('seasonality', 'Seasonality', '❆', 'Quant Toolkit', function (el, state, tab) {
  const syms = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO', 'NG=F', 'BTC-USD', 'AAPL', 'NVDA', 'XLE', 'XLK'];
  const sym = state.sym || 'SPY';
  el.innerHTML = `
    <div class="section-title">Seasonality Explorer
      <span style="flex:1"></span>
      <select class="inp" id="se-sym">${syms.map(s => `<option ${s === sym ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="info-box" style="margin-bottom:12px">Average returns by calendar month and weekday across the full real history, with t-statistics. A pattern is only worth attention when |t| > 2 (roughly 95% confidence) AND it has an economic story: tax flows, earnings seasons, heating demand. Anything else is probably noise that will not repeat.</div>
    <div class="grid g2" style="margin-bottom:12px">
      ${UI.panel('Average return by month <span class="badge dim">full history</span>', '<div class="chart h260" id="se-mo"></div>')}
      ${UI.panel('Statistical significance by month (t-stat)', '<div class="chart h260" id="se-mt"></div>')}
    </div>
    <div class="grid g2">
      ${UI.panel('Average return by weekday', '<div class="chart h220" id="se-dw"></div>')}
      ${UI.panel('Findings', '<div id="se-notes"></div>')}
    </div>`;
  const run = () => {
    const s = AL.getSeries(document.getElementById('se-sym').value);
    const r = AL.returns(s.sym);
    const byMonth = Array.from({ length: 12 }, () => []);
    const byDow = Array.from({ length: 7 }, () => []);
    r.dates.forEach((d, i) => {
      const dt = new Date(d + 'T12:00:00Z');
      byMonth[dt.getUTCMonth()].push(r.values[i]);
      byDow[dt.getUTCDay()].push(r.values[i]);
    });
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // average full-month return, not daily: mean daily x avg days-per-month
    const moAvg = byMonth.map(a => Q.mean(a) * 21);
    const moT = byMonth.map(a => Q.tstat(a));
    C.bars(document.getElementById('se-mo'), months.map((m, i) => ({ label: m, value: moAvg[i] })), { pct: true });
    C.bars(document.getElementById('se-mt'), months.map((m, i) => ({ label: m, value: moT[i] })), {});
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const dowIdx = [1, 2, 3, 4, 5];
    C.bars(document.getElementById('se-dw'), dows.map((d, i) => ({ label: d, value: Q.mean(byDow[dowIdx[i]]) })), { pct: true });
    const sig = months.map((m, i) => ({ m, t: moT[i], avg: moAvg[i] })).filter(x => Math.abs(x.t) > 2);
    document.getElementById('se-notes').innerHTML = `
      <div class="kv"><span class="k">History used</span><span class="v">${r.values.length.toLocaleString()} days (${r.dates[0]} on)</span></div>
      ${sig.length ? sig.map(x => `<div class="kv"><span class="k">${x.m} effect</span><span class="v ${AL.fmt.cls(x.avg)}">${AL.fmt.spct(x.avg)} avg, t=${AL.fmt.n(x.t, 1)}</span></div>`).join('')
        : '<div class="kv"><span class="k">Significant months (|t|>2)</span><span class="v">none, seasonality here is noise</span></div>'}
      <div class="note" style="margin-top:8px">The Carry / Seasonality strategies in the library trade the patterns that DO clear the significance bar, with costs and validation applied.</div>`;
  };
  document.getElementById('se-sym').addEventListener('change', e => { state.sym = e.target.value; run(); });
  run();
});

/* =========================================================
   MODULE: Drawdown Analyzer
   ========================================================= */
UI.def('drawdowns', 'Drawdown Analyzer', '↯', 'Quant Toolkit', function (el, state, tab) {
  const syms = ['SPY', 'QQQ', 'IWM', '^GSPC', 'TLT', 'GLD', 'BTC-USD', 'NVDA', 'AAPL', 'AMZN', 'TSLA', 'META'];
  const sym = state.sym || 'SPY';
  el.innerHTML = `
    <div class="section-title">Drawdown Analyzer
      <span style="flex:1"></span>
      <select class="inp" id="dd-sym">${syms.map(s => `<option ${s === sym ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label class="lbl">threshold</label><select class="inp" id="dd-thr"><option value="0.10" selected>-10%</option><option value="0.15">-15%</option><option value="0.20">-20%</option></select></div>
    <div class="info-box" style="margin-bottom:12px">Every major decline in the real history of this asset: how deep it went, how long the fall took, and how long the recovery back to the old high took. This is the pain schedule you sign up for when you own something. Recovery time is the number investors underestimate most.</div>
    ${UI.panel('Underwater curve (distance below all-time high)', '<div class="chart h240" id="dd-uw"></div>', { nopad: false })}
    <div style="margin-top:12px">${UI.panel('Major drawdown episodes', '<div id="dd-tbl"></div>', { nopad: true })}</div>`;
  const run = () => {
    const s = AL.getSeries(document.getElementById('dd-sym').value);
    const thr = +document.getElementById('dd-thr').value;
    const px = s.values, dates = s.dates;
    const dd = Q.drawdownSeries(px);
    C.line(document.getElementById('dd-uw'), [{ name: 'underwater', dates, values: dd, color: C.DN, fill: true }], { pct: true, zeroLine: true });
    // episode extraction: peak -> trough -> recovery
    const eps = [];
    let peakI = 0, troughI = 0, inDD = false;
    for (let i = 1; i < px.length; i++) {
      if (px[i] >= px[peakI]) {
        if (inDD && dd[troughI] <= -thr)
          eps.push({ peak: peakI, trough: troughI, rec: i });
        inDD = false; peakI = i; troughI = i;
      } else {
        inDD = true;
        if (px[i] < px[troughI]) troughI = i;
      }
    }
    if (inDD && dd[troughI] <= -thr) eps.push({ peak: peakI, trough: troughI, rec: null });
    const f = AL.fmt;
    document.getElementById('dd-tbl').innerHTML = `<table class="tbl"><thead><tr><th>Peak</th><th>Trough</th><th class="r">Depth</th><th class="r">Fall (days)</th><th class="r">Recovery (days)</th><th class="r">Total underwater</th></tr></thead><tbody>` +
      (eps.slice().reverse().map(e => {
        const depth = px[e.trough] / px[e.peak] - 1;
        const fall = e.trough - e.peak;
        const rec = e.rec != null ? e.rec - e.trough : null;
        return `<tr><td>${dates[e.peak]}</td><td>${dates[e.trough]}</td><td class="r dn">${f.pct(depth, 1)}</td>
          <td class="r">${fall}</td><td class="r">${rec != null ? rec : 'ongoing'}</td>
          <td class="r">${e.rec != null ? e.rec - e.peak : 'ongoing'}</td></tr>`;
      }).join('') || '<tr><td colspan="6"><div class="empty">No drawdowns beyond the threshold.</div></td></tr>') + '</tbody></table>';
  };
  document.getElementById('dd-sym').addEventListener('change', e => { state.sym = e.target.value; run(); });
  document.getElementById('dd-thr').addEventListener('change', run);
  run();
});
