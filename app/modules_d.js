/* modules D: the beginner guide, stock advisor, sentiment desk, and welcome overlay */
'use strict';

// pull the alt-data bundle if the build shipped one (news/social/attention)
AL.alt = () => (window.ALPHALAB_ALT && window.ALPHALAB_ALT.tickers) || {};
AL.altMeta = () => window.ALPHALAB_ALT || null;

// distill the raw alt feeds for one ticker into a few usable signals
UI.altSignals = function (sym) {
  const a = AL.alt()[sym];
  if (!a) return null;
  const out = { sym };
  if (a.st && (a.st.bull + a.st.bear) >= 5) {
    out.bullRatio = a.st.bull / (a.st.bull + a.st.bear);   // share of tagged messages that are bullish
    out.watchers = a.st.watchers;
  }
  if (a.newsTone && a.newsTone.v.length > 20) {
    const v = a.newsTone.v;
    out.tone = Q.mean(v.slice(-14));                        // avg news tone, last 2 weeks
    out.toneTrend = out.tone - Q.mean(v.slice(0, -14));     // vs the earlier window
  }
  if (a.newsVol && a.newsVol.v.length > 20) {
    const v = a.newsVol.v;
    const base = Q.mean(v.slice(0, -7)) || 1;
    out.newsSpike = Q.mean(v.slice(-7)) / base - 1;         // is coverage picking up?
  }
  if (a.wiki && a.wiki.v.length > 30) {
    const v = a.wiki.v;
    out.attention = Q.mean(v.slice(-7)) / (Q.mean(v) || 1) - 1;  // wiki views last week vs 4-month norm
  }
  return out;
};

/* ---- multi-factor stock scoring used by the Advisor ----
   Scores the FULL US market on weekly bars: S&P 500 names carry 10y of history,
   the extended total-market universe carries 3y. Falls back to daily majors
   if neither weekly bundle shipped with the build. */
UI.mergedUniverse = function () {
  // {sym: {n, sec, mc?, f, s, c, wcal}} across both weekly bundles
  const out = {};
  const sp = AL.sp500();
  if (sp) for (const [sym, e] of Object.entries(sp.cols)) out[sym] = { ...e, wcal: sp.wcal };
  const mkt = window.ALPHALAB_MKT;
  if (mkt) for (const [sym, e] of Object.entries(mkt.cols)) if (!out[sym]) out[sym] = { ...e, wcal: mkt.wcal };
  return out;
};

UI.scoreStocks = function (opts = {}) {
  // scoring the full universe is ~1-2s; cache it for the session since data is static
  if (UI._scoreCache && !opts.fresh) return UI._scoreCache;
  const uni = UI.mergedUniverse();
  const regime = Q.marketRegime();
  const rows = [];
  if (Object.keys(uni).length) {
    const sp = AL.sp500();
    const spyW = AL.weeklyValues('SPY');
    const spyRet = spyW ? spyW.map((v, i) => i && spyW[i - 1] ? v / spyW[i - 1] - 1 : 0) : null;
    for (const [sym, e] of Object.entries(uni)) {
      const n = e.c.length;
      if (n < 80) continue;                                            // need ~1.5y of weekly bars
      const k = Math.pow(10, e.s);
      const px = e.c.map(v => v / k);
      const rets = [];
      for (let i = 1; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);
      const r52 = rets.slice(-52), r26 = rets.slice(-26);
      const mom = px[n - 3] / px[Math.max(n - 29, 0)] - 1;             // 26-week momentum, 2-week skip
      const trend = px[n - 1] / Q.mean(px.slice(-40)) - 1;             // vs 40-week average (~200d)
      const vol = Q.std(r26) * Math.sqrt(52);
      // tradeability floor: skip sub-$2 names and data-glitch volatility
      if (px[n - 1] < 2 || !isFinite(vol) || vol > 1.5) continue;
      const sharpe = Q.std(r52) ? (Q.mean(r52) * 52 - 0.02) / (Q.std(r52) * Math.sqrt(52)) : 0;
      // share of positive 4-week blocks over up to 3 years
      let pos = 0, tot = 0;
      const r3y = rets.slice(-156);
      for (let m = 0; m + 4 <= r3y.length; m += 4) { tot++; if (Q.sum(r3y.slice(m, m + 4)) > 0) pos++; }
      const consistency = tot ? pos / tot : 0.5;
      const ddHigh = px[n - 1] / Math.max(...px.slice(-52)) - 1;       // pullback from 52-week high
      // beta vs SPY on the shared weekly grid (grids align on dates for both bundles)
      let beta = 1;
      if (spyRet && sp) {
        const wmap = new Map(sp.wcal.map((d, i) => [d, spyRet[i]]));
        const myDates = e.wcal.slice(e.f + 1).slice(-52);
        const sp52 = myDates.map(d => wmap.get(d) ?? 0);
        if (sp52.length === r52.length) beta = Q.linreg(sp52, r52).b;
      }
      rows.push({ sym, name: e.n, sector: e.sec || 'Unknown', mc: e.mc || null,
        mom, trend, vol, sharpe, consistency, ddHigh, beta,
        alt: UI.altSignals(sym), rets, last: px[n - 1], weekly: true, years: Math.round(n / 52) });
    }
  } else {
    // no weekly bundles in this build: fall back to the daily majors
    for (const x of AL.catalog().filter(x => x.cls === 'Equity' && !x.weekly)) {
      const s = AL.getSeries(x.sym);
      const px = s.values, n = px.length;
      if (n < 800) continue;
      const rets = [];
      for (let i = n - 756; i < n; i++) rets.push(px[i] / px[i - 1] - 1);
      const r252 = rets.slice(-252);
      rows.push({ sym: x.sym, name: s.name, sector: 'Unknown', mc: null,
        mom: px[n - 11] / px[n - 137] - 1,
        trend: px[n - 1] / Q.mean(px.slice(-200)) - 1,
        vol: Q.std(rets.slice(-63)) * Math.sqrt(252),
        sharpe: Q.std(r252) ? (Q.mean(r252) * 252 - 0.02) / (Q.std(r252) * Math.sqrt(252)) : 0,
        consistency: 0.5, ddHigh: px[n - 1] / Math.max(...px.slice(-252)) - 1,
        beta: 1, alt: UI.altSignals(x.sym), rets, last: px[n - 1], weekly: false, years: 3 });
    }
  }
  // sector-relative momentum: beating your own sector matters more than beating the tape
  const bySec = {};
  rows.forEach(r => (bySec[r.sector] = bySec[r.sector] || []).push(r.mom));
  rows.forEach(r => r.secRel = r.mom - Q.mean(bySec[r.sector] || [r.mom]));
  // z-score every factor across the universe, clipped so one outlier cannot dominate
  const z = (key, invert) => {
    const vals = rows.map(r => r[key]).filter(isFinite);
    const m = Q.mean(vals), sd = Q.std(vals) || 1;
    rows.forEach(r => r['z_' + key] = isFinite(r[key]) ? (invert ? -1 : 1) * Math.max(-3, Math.min(3, (r[key] - m) / sd)) : 0);
  };
  z('mom'); z('trend'); z('sharpe'); z('vol', true); z('consistency'); z('secRel');
  // regime fit: reward beta in risk-on tape, punish it when the regime turns defensive
  rows.forEach(r => r.z_regime = (regime.pCalm > 0.5 ? 0.5 : -1.2) * ((r.beta - 1)));
  // sentiment composite from whatever alt feeds this name has
  rows.forEach(r => {
    const a = r.alt;
    if (!a) { r.z_sent = 0; r.hasSent = false; return; }
    const parts = [];
    if (a.bullRatio != null) parts.push((a.bullRatio - 0.5) * 4);      // 0.5 is neutral crowd
    if (a.toneTrend != null) parts.push(Math.max(-1.5, Math.min(1.5, a.toneTrend)));
    if (a.attention != null && a.attention > 0.25) parts.push(Math.sign(r.mom) * Math.min(a.attention, 1)); // attention spikes amplify the trend
    r.z_sent = parts.length ? Q.mean(parts) : 0;
    r.hasSent = parts.length > 0;
  });
  // fundamental pillars folded in when real fundamentals are bundled for the name
  rows.forEach(r => {
    const fs = UI.fundamentalScore ? UI.fundamentalScore(r.sym) : null;
    r.z_value = fs && fs.pillars.value != null ? fs.pillars.value : 0;
    r.z_quality = fs && fs.pillars.quality != null ? fs.pillars.quality : 0;
    r.z_growth = fs && fs.pillars.growth != null ? fs.pillars.growth : 0;
    r.z_analyst = fs && fs.pillars.analyst != null ? fs.pillars.analyst : 0;
    r.hasFund = !!fs;
  });
  // weighted composite; technical factors plus fundamental pillars, weights sum to 1
  const W = { z_mom: 0.13, z_trend: 0.10, z_sharpe: 0.10, z_vol: 0.08, z_consistency: 0.06, z_secRel: 0.08, z_regime: 0.08, z_sent: 0.11,
    z_analyst: 0.09, z_quality: 0.06, z_growth: 0.06, z_value: 0.05 };
  rows.forEach(r => {
    r.score = Object.entries(W).reduce((s2, [k, w]) => s2 + w * (r[k] || 0), 0);
    // confidence: probabilistic sharpe on the last year, boosted by fundamental+sentiment coverage
    r.conf = Q.psr(r.rets.slice(-52)) * (r.hasSent ? 1 : 0.94) * (r.hasFund ? 1 : 0.9);
  });
  rows.sort((a, b) => b.score - a.score);
  UI._scoreCache = { rows, regime, weights: W, universe: rows.length, bySym: Object.fromEntries(rows.map(r => [r.sym, r])) };
  return UI._scoreCache;
};

// plain-english reasoning for one scored stock, built from its strongest and weakest factors
UI.stockThesis = function (r, regime) {
  const f = AL.fmt;
  const good = [], bad = [];
  const say = (cond, g, b) => (cond ? good : bad).push(cond ? g : b);
  if (r.z_mom > 0.3) good.push(`strong 6-month momentum (${f.spct(r.mom)})`);
  else if (r.z_mom < -0.3) bad.push(`weak 6-month momentum (${f.spct(r.mom)})`);
  if (r.trend > 0.02) good.push(`trading ${f.pct(r.trend, 1)} above its 200-day average (established uptrend)`);
  else if (r.trend < -0.02) bad.push(`trading ${f.pct(-r.trend, 1)} below its 200-day average (downtrend)`);
  if (r.z_sharpe > 0.3) good.push(`top-tier risk-adjusted returns this year (Sharpe ${f.n(r.sharpe)})`);
  if (r.z_vol > 0.4) good.push(`calmer than most peers (${f.pct(r.vol, 0)} annualized volatility)`);
  else if (r.z_vol < -0.6) bad.push(`high volatility (${f.pct(r.vol, 0)} annualized), expect large swings`);
  if (r.consistency > 0.62) good.push(`finished ${f.pct(r.consistency, 0)} of recent months positive`);
  if (r.alt) {
    if (r.alt.bullRatio != null && r.alt.bullRatio > 0.65) good.push(`investor chatter on StockTwits runs ${f.pct(r.alt.bullRatio, 0)} bullish`);
    if (r.alt.bullRatio != null && r.alt.bullRatio < 0.35) bad.push(`social sentiment is bearish (only ${f.pct(r.alt.bullRatio, 0)} bullish messages)`);
    if (r.alt.toneTrend != null && r.alt.toneTrend > 0.3) good.push(`worldwide news tone has been improving over the last two weeks`);
    if (r.alt.toneTrend != null && r.alt.toneTrend < -0.3) bad.push(`news tone has been deteriorating recently`);
    if (r.alt.attention != null && r.alt.attention > 0.4) good.push(`public attention is spiking (Wikipedia views ${f.pct(r.alt.attention, 0)} above normal)`);
  }
  if (regime.pCalm <= 0.5 && r.beta > 1.2) bad.push(`beta of ${f.n(r.beta)} is risky in the current stressed regime`);
  const gtxt = good.length ? 'Why it ranks here: ' + good.slice(0, 4).join('; ') + '.' : '';
  const btxt = bad.length ? ' Watch out for: ' + bad.slice(0, 3).join('; ') + '.' : ' No major red flags in the factor set.';
  return gtxt + btxt;
};

/* =========================================================
   MODULE: Stock Advisor
   ========================================================= */
UI.def('advisor', 'Stock Advisor', '✦', 'Advisory', function (el, state, tab) {
  el.innerHTML = `
    <div class="section-title">Stock Advisor, multi-factor recommendations
      <span class="badge dim">price factors + news + social + attention</span>
      <span style="flex:1"></span><button class="btn primary" id="ad-run">Score the universe</button></div>
    <div class="info-box" style="margin-bottom:12px">Every stock in the bundled US universe (the full S&P 500 with 10 years of history plus the extended total-market list with 3 years) is scored on eight ingredients: 6-month momentum, 40-week trend, 1-year risk-adjusted return, volatility, monthly consistency, sector-relative momentum, fit with the current market regime, and a sentiment composite built from real GDELT news tone, StockTwits investor chatter, and Wikipedia attention data. Scores are relative rankings from historical data, not guarantees. AlphaLab recommends and explains; you decide.</div>
    <div id="ad-body"><div class="empty">Press "Score the universe" to rank every stock.</div></div>`;
  const run = () => {
    document.getElementById('ad-body').innerHTML = '<div class="empty">Scoring the full universe on real history...</div>';
    setTimeout(() => {
      const res = UI.scoreStocks();
      state._res = res;
      render(res);
    }, 30);
  };
  const render = (res) => {
    const f = AL.fmt;
    const { rows, regime } = res;
    const sectors = ['All', ...[...new Set(rows.map(r => r.sector))].sort()];
    const secFilter = state.sec || 'All';
    const q = (state.q || '').toUpperCase();
    const visible = rows.filter(r => (secFilter === 'All' || r.sector === secFilter) &&
      (!q || r.sym.includes(q) || r.name.toUpperCase().includes(q)));
    const shown = visible.slice(0, 250);
    // starter basket: walk the ranking, max 2 names per sector, 10 picks, inverse-vol weights
    const top = [];
    const perSec = {};
    for (const r of rows) {
      if (top.length >= 10) break;
      if ((perSec[r.sector] || 0) >= 2) continue;
      perSec[r.sector] = (perSec[r.sector] || 0) + 1;
      top.push(r);
    }
    const iv = top.map(r => 1 / (r.vol || 0.2));
    const tot = Q.sum(iv);
    top.forEach((r, i) => r.sugW = Math.min(iv[i] / tot, 0.15));
    const wTot = Q.sum(top.map(r => r.sugW));
    top.forEach(r => r.sugW /= wTot);
    document.getElementById('ad-body').innerHTML = `
      <div class="note" style="margin-bottom:8px"><b>${res.universe.toLocaleString()}</b> stocks scored. Regime: <b>${regime.label}</b>. ${regime.pCalm > 0.5 ? 'Risk-on tape, momentum and beta get a small boost.' : 'Stressed tape, the model favors low-beta defensive names.'}</div>
      <div class="controls"><input class="inp" id="ad-q" placeholder="search ticker or name" value="${f.esc(state.q || '')}" style="width:180px">
        <select class="inp" id="ad-sec">${sectors.map(s => `<option ${s === secFilter ? 'selected' : ''}>${f.esc(s)}</option>`).join('')}</select>
        <span class="note">showing ${shown.length} of ${visible.length} matches</span></div>
      <div class="grid g23">
        <div class="panel"><div class="panel-body nopad" style="max-height:calc(100vh - 340px);overflow:auto">
          <table class="tbl" id="ad-tbl"><thead><tr><th>#</th><th>Stock</th><th>Sector</th><th class="r">Score</th><th class="r">Mom 6M</th><th class="r">Trend</th><th class="r">Sharpe 1Y</th><th class="r">Vol</th><th class="r">Sent</th><th class="r">Conf</th></tr></thead><tbody>
          ${shown.map(r => `<tr data-sym="${r.sym}"><td>${rows.indexOf(r) + 1}</td><td class="t"><span class="sym">${r.sym}</span> ${f.esc(r.name.slice(0, 18))}</td>
            <td class="t" style="font-size:10px">${f.esc((r.sector || '').slice(0, 14))}</td>
            <td class="r"><b class="${f.cls(r.score)}">${f.n(r.score)}</b></td>
            <td class="r ${f.cls(r.mom)}">${f.spct(r.mom, 0)}</td><td class="r ${f.cls(r.trend)}">${f.spct(r.trend, 0)}</td>
            <td class="r">${f.n(r.sharpe, 1)}</td><td class="r">${f.pct(r.vol, 0)}</td>
            <td class="r ${r.hasSent ? f.cls(r.z_sent) : ''}">${r.hasSent ? f.n(r.z_sent, 1) : '·'}</td>
            <td class="r">${f.pct(r.conf, 0)}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div class="panel"><div class="panel-head">Starter basket (top 10, max 2 per sector, inverse-vol)</div><div class="panel-body">
            ${top.map(r => `<div class="kv"><span class="k"><span class="sym">${r.sym}</span> ${f.esc(r.name.slice(0, 16))} <span style="color:var(--muted);font-size:10px">${f.esc((r.sector || '').slice(0, 12))}</span></span><span class="v">${f.pct(r.sugW, 1)}</span></div>`).join('')}
            <div class="note" style="margin-top:8px">Sector cap keeps the basket diversified; weights cap any single name near 15%. Enter these in My Holdings with your budget, then stress test in Risk Lab.</div></div></div>
          <div class="panel"><div class="panel-head">Pick detail</div><div class="panel-body" id="ad-detail"><div class="empty">Click any stock for the full reasoning.</div></div></div>
        </div>
      </div>`;
    const bySym = Object.fromEntries(rows.map(r => [r.sym, r]));
    document.querySelectorAll('#ad-tbl tr[data-sym]').forEach(tr => tr.addEventListener('click', () => detail(bySym[tr.dataset.sym], regime)));
    document.getElementById('ad-q').addEventListener('input', AL.debounce(e => { state.q = e.target.value; render(res); }, 300));
    document.getElementById('ad-sec').addEventListener('change', e => { state.sec = e.target.value; render(res); });
    detail(rows[0], regime);
  };
  const detail = (r, regime) => {
    const f = AL.fmt;
    // real forward range: block bootstrap the stock's own weekly history one quarter out
    const horizon = r.weekly ? 13 : 63, block = r.weekly ? 4 : 5;
    const paths = Q.monteCarlo(r.rets, horizon, 800, 7, block).map(p => p[p.length - 1] - 1);
    const lo = Q.quantile(paths, 0.05), mid = Q.quantile(paths, 0.5), hi = Q.quantile(paths, 0.95);
    // does it actually diversify the current book? (everything resampled onto the weekly grid)
    let fit = '';
    const pf = AL.store.get('holdings', UI.DEMO_BOOK);
    if (pf.length && !pf.some(h => h.sym === r.sym) && AL.sp500()) {
      try {
        const wc = AL.sp500().wcal;
        const mineW = wc.map(() => 0);
        let ok = 0;
        for (const h of pf) {
          const wv = AL.weeklyValues(h.sym);
          if (!wv) continue;
          ok++;
          for (let t = 1; t < wc.length; t++) if (wv[t] && wv[t - 1]) mineW[t] += wv[t] / wv[t - 1] - 1;
        }
        const meW = AL.weeklyValues(r.sym);
        const a = [], b = [];
        for (let t = wc.length - 52; t < wc.length; t++)
          if (meW[t] && meW[t - 1]) { a.push(meW[t] / meW[t - 1] - 1); b.push(mineW[t] / Math.max(ok, 1)); }
        const c = Q.corr(a, b);
        if (isFinite(c)) fit = `<div class="kv"><span class="k">Correlation to your current book (1y)</span><span class="v">${f.n(c)}</span></div>
          <div class="note">${c < 0.5 ? 'Low correlation, adding this genuinely diversifies you.' : 'High correlation, this mostly doubles down on what you already own.'}</div>`;
      } catch (e) { /* short histories can defeat the alignment */ }
    }
    document.getElementById('ad-detail').innerHTML = `
      <div style="font-weight:650;font-size:14px;margin-bottom:4px">${r.sym} · ${f.esc(r.name)} <span class="badge ${r.score > 0.2 ? 'ok' : r.score > -0.2 ? 'warn' : 'bad'}">score ${f.n(r.score)}</span></div>
      <div class="note" style="margin-bottom:6px">${f.esc(r.sector || '')}${r.mc ? ' · market cap ' + f.usd(r.mc * 1e6) : ''} · ${r.years}y of ${r.weekly ? 'weekly' : 'daily'} history</div>
      <div class="note" style="margin-bottom:8px;line-height:1.6">${UI.stockThesis(r, regime)}</div>
      <div class="chart" style="height:145px" id="ad-fac"></div>
      <div class="kv"><span class="k">Next-quarter range (bootstrap of its real history)</span><span class="v">${f.spct(lo)} to ${f.spct(hi)} (median ${f.spct(mid)})</span></div>
      <div class="kv"><span class="k">Statistical confidence (PSR, 1y)</span><span class="v">${f.pct(r.conf, 0)}</span></div>
      <div class="kv"><span class="k">Last close</span><span class="v">${f.px(r.last)}</span></div>
      ${fit}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn small primary" id="ad-buy">Add to My Holdings</button>
        <button class="btn small" onclick="UI.openTab('chart',{sym:'${r.sym}',forceNew:true},'${r.sym} Chart')">Chart</button>
        ${AL.alt()[r.sym] ? `<button class="btn small" onclick="UI.focusModule('sentiment',{sym:'${r.sym}'})">Sentiment</button>` : ''}
      </div>
      <div class="warn-box" style="margin-top:10px">This is a ranked research view of real historical and sentiment data. It is not a prediction or individual investment advice.</div>`;
    C.bars(document.getElementById('ad-fac'), [
      { label: 'Momentum', value: r.z_mom }, { label: 'Trend', value: r.z_trend },
      { label: 'Sharpe', value: r.z_sharpe }, { label: 'Low vol', value: r.z_vol },
      { label: 'Consistency', value: r.z_consistency }, { label: 'Sector-rel', value: r.z_secRel },
      { label: 'Regime fit', value: r.z_regime }, { label: 'Sentiment', value: r.z_sent }], { horizontal: true });
    document.getElementById('ad-buy').addEventListener('click', () => {
      const qty = parseFloat(prompt(`Quantity of ${r.sym} to add (last close ${f.px(r.last)}):`));
      if (!isFinite(qty) || qty <= 0) return;
      const pf2 = AL.store.get('holdings', UI.DEMO_BOOK);
      pf2.push({ sym: r.sym, qty, costBasis: r.last });
      // in competition mode, buying spends the virtual cash
      const cash = AL.store.get('cash', null);
      if (cash != null) AL.store.set('cash', cash - qty * r.last);
      AL.store.set('holdings', pf2);
      alert(`${qty} ${r.sym} added at ${f.px(r.last)}. Open My Holdings to review.`);
    });
  };
  document.getElementById('ad-run').addEventListener('click', run);
  if (state._res) render(state._res); else run();
});

/* =========================================================
   MODULE: Sentiment & News desk
   ========================================================= */
UI.def('sentiment', 'Sentiment & News', '◍', 'Advisory', function (el, state, tab) {
  const alt = AL.alt();
  const syms = Object.keys(alt);
  if (!syms.length) {
    el.innerHTML = '<div class="empty">No alt-data bundle in this build. Run tools/download_altdata.py and reassemble.</div>';
    return;
  }
  // default to a name that has the full feed set so first impressions are complete
  const best = syms.find(s => alt[s].newsTone && alt[s].wiki && alt[s].st) || syms[0];
  const sym = state.sym && alt[state.sym] ? state.sym : best;
  const meta = AL.altMeta();
  el.innerHTML = `
    <div class="section-title">Sentiment and News Intelligence
      <span class="badge ok">REAL ALT-DATA</span>
      <span class="note">snapshot ${meta.asof}</span>
      <span style="flex:1"></span>
      <select class="inp" id="sn-sym">${syms.map(s => `<option ${s === sym ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn" id="sn-live">Refresh live</button></div>
    <div class="info-box" style="margin-bottom:12px">Three real feeds per name: worldwide news tone and coverage volume from GDELT (which indexes online news, including broadcast transcripts), investor message sentiment from StockTwits, and public attention from Wikipedia pageviews. "Refresh live" re-pulls Wikipedia and GDELT straight from your browser when you are online; the bundled snapshot is the fallback.</div>
    <div class="grid g2" style="margin-bottom:12px">
      ${UI.panel('Worldwide news tone (GDELT, 2 months) <span class="badge dim">above 0 = positive coverage</span>', '<div class="chart h220" id="sn-tone"></div>')}
      ${UI.panel('News coverage volume (share of all monitored articles)', '<div class="chart h220" id="sn-vol"></div>')}
    </div>
    <div class="grid g2">
      ${UI.panel('Public attention (Wikipedia daily pageviews, 4 months)', '<div class="chart h220" id="sn-wiki"></div>')}
      ${UI.panel('Investor social sentiment (StockTwits)', '<div id="sn-social"></div>')}
    </div>`;
  const draw = (a) => {
    if (a.newsTone) {
      const dts = a.newsTone.d.map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      C.line(document.getElementById('sn-tone'), [{ name: 'tone', dates: dts, values: a.newsTone.v, color: C.SERIES[0], fill: true }], { zeroLine: true });
    } else document.getElementById('sn-tone').innerHTML = '<div class="empty">No news tone data for this name.</div>';
    if (a.newsVol) {
      const dts = a.newsVol.d.map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      C.line(document.getElementById('sn-vol'), [{ name: 'volume', dates: dts, values: a.newsVol.v, color: C.SERIES[2], fill: true }]);
    } else document.getElementById('sn-vol').innerHTML = '<div class="empty">No volume data.</div>';
    if (a.wiki) {
      const dts = AL.dateRange(a.wiki.d0, a.wiki.v.length);
      C.line(document.getElementById('sn-wiki'), [
        { name: 'daily views', dates: dts, values: a.wiki.v, color: C.SERIES[4], fill: true },
        { name: '7d avg', dates: dts, values: Q.sma(a.wiki.v, 7), color: C.SERIES[2], width: 2 }]);
    } else document.getElementById('sn-wiki').innerHTML = '<div class="empty">No attention data.</div>';
    const st = a.st, f = AL.fmt;
    const sig = UI.altSignals(sym) || {};
    document.getElementById('sn-social').innerHTML = st ? `
      <div class="kv"><span class="k">Bullish tagged messages (last 30)</span><span class="v up">${st.bull}</span></div>
      <div class="kv"><span class="k">Bearish tagged messages</span><span class="v dn">${st.bear}</span></div>
      <div class="kv"><span class="k">Crowd lean</span><span class="v">${st.bull + st.bear ? f.pct(st.bull / (st.bull + st.bear), 0) + ' bullish' : 'not enough tagged messages'}</span></div>
      <div class="kv"><span class="k">Watchlist followers</span><span class="v">${st.watchers ? st.watchers.toLocaleString() : 'n/a'}</span></div>
      ${sig.toneTrend != null ? `<div class="kv"><span class="k">News tone trend (2wk vs prior)</span><span class="v ${f.cls(sig.toneTrend)}">${sig.toneTrend >= 0 ? 'improving' : 'deteriorating'} (${f.n(sig.toneTrend)})</span></div>` : ''}
      ${sig.attention != null ? `<div class="kv"><span class="k">Attention vs 4-month norm</span><span class="v ${f.cls(sig.attention)}">${f.spct(sig.attention)}</span></div>` : ''}
      <div class="note" style="margin-top:8px">Extreme crowd bullishness is often a contrarian warning rather than a green light. The Advisor uses these numbers as one ingredient of seven, never alone.</div>` : '<div class="empty">No StockTwits data bundled for this name.</div>';
  };
  draw(alt[sym]);
  document.getElementById('sn-sym').addEventListener('change', e => { state.sym = e.target.value; UI.renderActive(); });
  // live refresh straight from the browser; works on the hosted site, fails soft elsewhere
  document.getElementById('sn-live').addEventListener('click', async () => {
    const btn = document.getElementById('sn-live');
    btn.textContent = 'Fetching...'; btn.disabled = true;
    const a = { ...alt[sym] };
    let got = 0;
    try {
      const wikiArticle = { AMZN: 'Amazon_(company)', AAPL: 'Apple_Inc.', TSLA: 'Tesla,_Inc.', NVDA: 'Nvidia', 'BTC-USD': 'Bitcoin' }[sym];
      const art = wikiArticle || (AL.getSeries(sym) ? AL.getSeries(sym).name.split(' ')[0] : sym);
      const end = new Date(), start = new Date(Date.now() - 120 * 864e5);
      const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
      const wr = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(art)}/daily/${fmt(start)}/${fmt(end)}`);
      if (wr.ok) {
        const items = (await wr.json()).items || [];
        if (items.length) {
          const d0 = items[0].timestamp.slice(0, 8);
          a.wiki = { d0: `${d0.slice(0, 4)}-${d0.slice(4, 6)}-${d0.slice(6, 8)}`, v: items.map(x => x.views) };
          got++;
        }
      }
      const q = encodeURIComponent(`"${AL.getSeries(sym) ? AL.getSeries(sym).name.split(' ')[0] : sym}"`);
      const gr = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=timelinetone&timespan=2months&format=json`);
      if (gr.ok) {
        const j = await gr.json();
        if (j.timeline) {
          a.newsTone = { d: j.timeline[0].data.map(p => p.date.slice(0, 8)), v: j.timeline[0].data.map(p => +p.value.toFixed(2)) };
          got++;
        }
      }
    } catch (e) { /* offline or CSP-blocked, keep the snapshot */ }
    btn.textContent = got ? `Refreshed (${got} feeds live)` : 'Live fetch blocked, using snapshot';
    btn.disabled = false;
    draw(a);
  });
});

/* =========================================================
   MODULE: Guide (plain-english manual for people new to all of this)
   ========================================================= */
UI.def('guide', 'How To Use This', '?', 'Start Here', function (el, state) {
  const g = (h, body) => `<div class="panel" style="margin-bottom:12px"><div class="panel-head">${h}</div><div class="panel-body"><div class="note" style="font-size:12.5px;line-height:1.75;color:var(--ink2)">${body}</div></div></div>`;
  el.innerHTML = `
    <div class="section-title">The Complete Guide</div>
    <div class="grid g2">
    <div>
    ${g('What is AlphaLab, in one paragraph', `AlphaLab is a research terminal for stocks and other markets. It holds 26 years of real price history plus real news, social, and attention data, and it lets you test ideas against that history before you risk money on them. Think of it as a flight simulator for investing: you can try a strategy, crash it safely, and read exactly why it crashed. It never touches real money and never places trades.`)}
    ${g('Take the interactive tour first', `New here? The guided tour drives the real app for you, one screen at a time, pointing at exactly what matters. It is the fastest way to learn AlphaLab. <button class="btn primary small" onclick="UI.startTour()" style="margin-top:8px">Start the interactive tour</button>`)}
    ${g('Never invested before? Do these six things', `
      <b>1. Judge one stock.</b> Open <b>Buy / Sell Decision</b>, type a ticker like AMZN, and read the call. It fuses price action, real fundamentals (P/E, growth, margins), Wall Street analyst targets, earnings, news, and investor posts into a single BUY, HOLD, or SELL with a bull case and a bear case. This is the fastest "should I buy this?" answer on the site.<br><br>
      <b>2. Look at its history.</b> Press Ctrl+K, type the ticker, hit Enter. The chart shows real price history and the red drawdown chart shows every painful drop it has had. That is what owning it feels like.<br><br>
      <b>3. Get recommendations.</b> Open <b>Stock Advisor</b>. It ranks every listed US stock on eight factors and hands you a diversified starter basket. Or use the <b>Screener</b> to filter by value, growth, quality, or dividends.<br><br>
      <b>4. Build your portfolio.</b> Open <b>My Holdings</b>, press Competition mode for $100,000 of virtual cash, and add positions. The Advisor and Decision engine can add them for you and deduct the cash.<br><br>
      <b>5. Stress test it.</b> Open <b>Risk Lab</b>. It replays your exact portfolio through 2008, COVID, and Black Monday using real data and shows the dollar loss you would have taken. If that number scares you, diversify more.<br><br>
      <b>6. Get the report.</b> In My Holdings, press "Strategy report" for a written investment strategy document, ideal for competition submissions.`)}
    ${g('The Buy / Sell Decision engine, explained', `This is the deepest single-stock view on the site. For any ticker it pulls together, all on real data: the eight technical factors, real fundamentals from Yahoo Finance (valuation multiples, revenue and earnings growth, profit margins, return on equity, debt, dividend yield), Wall Street analyst price targets and the full strong-buy-to-strong-sell split, the last four quarters of earnings surprises, real news headlines from GDELT, and real investor posts from StockTwits. It weighs technical 28%, analyst 20%, quality/growth/value 14% each, and sentiment 10%, then prints a BUY, HOLD, or SELL with the specific reasons for and against. Every reason is a real number you can cite, and it always tells you what would change the call.`)}
    ${g('Worked example: deciding on a stock start to finish', `
      Say you are curious about a company. Here is the exact routine, using only real data on this site:<br><br>
      <b>1.</b> Open <b>Buy / Sell Decision</b>, type the ticker, press Analyze. Read the call and the composite score at the top right. Suppose it says BUY at +0.34.<br>
      <b>2.</b> Look at the factor bars to see <i>why</i>. Maybe Quality and Growth are strongly positive (fat margins, fast sales growth) and Analyst is positive (20% upside to target), but Value is negative (it is expensive versus peers). Now you understand the trade-off: a great business, but you are paying up for it.<br>
      <b>3.</b> Read the bull case and bear case, which spell those out in words, and glance at the earnings-surprise table, a run of beats is a good sign.<br>
      <b>4.</b> Sanity-check the price with <b>Peer Comparison</b>. If it is the most expensive name in its sector on every measure, the growth had better justify it.<br>
      <b>5.</b> Check the downside with the <b>Drawdown Analyzer</b>, how far has this stock fallen before, and how long did it take to recover? That is what you must be willing to sit through.<br>
      <b>6.</b> If you still like it, add it in <b>My Holdings</b> (or press Add to My Holdings right on the decision page), keep the position modest, then run the <b>Risk Lab</b> to see how it behaves in a crash alongside your other holdings.<br>
      <b>7.</b> Decide your exit rule <i>now</i>: a price where you would sell, or a change (a broken trend, a bad earnings report, analyst downgrades) that would flip the call. The decision page even lists what would change it. Deciding in advance beats deciding in a panic.`)}
    ${g('Playbook: Wharton Global Investment Competition', `
      The competition gives your team about $100,000 of virtual money and judges you on your <b>strategy and reasoning</b>, not just returns. AlphaLab maps to that directly:<br><br>
      <b>Step 1.</b> My Holdings, press <b>Competition mode ($100K)</b>. You now have a clean cash balance.<br>
      <b>Step 2.</b> Stock Advisor, press Score the universe. Read the top names and their theses. Check each pick's Sentiment tab so you can cite news tone and investor sentiment in your writeup.<br>
      <b>Step 3.</b> Add 8 to 12 positions. Keep any single stock under about 15% and mix sectors; judges reward diversification discipline.<br>
      <b>Step 4.</b> Risk Lab: run the 2008 and COVID replays and the Monte Carlo. Write the worst-case numbers into your strategy document; showing you measured downside is exactly what wins.<br>
      <b>Step 5.</b> My Holdings, <b>Strategy report</b>, then Print to PDF. It gives you allocation, rationale per holding, risk analysis, and benchmarks in institutional format. Edit in your own team voice before submitting; judges can tell copy-paste.<br>
      <b>Step 6.</b> Rebalance as the competition runs. Re-run the Advisor weekly; the AI review flags concentration drift and regime changes.`)}
    ${g('What the seven Advisor factors mean', `
      <b>Momentum:</b> how much the stock rose over 6 months. Winners tend to keep winning for a while.<br>
      <b>Trend:</b> is the price above its 200-day average? Above = healthy uptrend.<br>
      <b>Sharpe:</b> return earned per unit of risk taken. Higher is better; 1+ is very good.<br>
      <b>Low volatility:</b> calmer stocks compound more reliably than wild ones.<br>
      <b>Consistency:</b> what share of recent months were positive.<br>
      <b>Regime fit:</b> the platform detects whether the whole market is calm or stressed and favors aggressive names in calm tapes, defensive ones in stress.<br>
      <b>Sentiment:</b> real news tone (GDELT), investor chatter (StockTwits), and public attention (Wikipedia views), combined.`)}
    </div>
    <div>
    ${g('Dictionary: every number on this site', `
      <b>CAGR:</b> average yearly growth rate. 10% CAGR doubles money in about 7 years.<br>
      <b>Volatility:</b> how much the value swings. 15% is normal for stocks, 60%+ is crypto territory.<br>
      <b>Sharpe ratio:</b> the single most-used quality score in finance. Return divided by risk. Below 0 = losing, 0.5 = decent, 1+ = strong, 2+ = suspicious, check for errors.<br>
      <b>Max drawdown:</b> the worst peak-to-bottom fall. A -50% drawdown needs a +100% gain to recover.<br>
      <b>Beta:</b> sensitivity to the market. Beta 1 moves with the S&P 500, beta 2 moves twice as hard, beta 0 ignores it.<br>
      <b>VaR (Value at Risk):</b> "on 95% of days you will not lose more than this."<br>
      <b>CVaR:</b> when you do breach VaR, this is the average size of that bad day.<br>
      <b>Backtest:</b> replaying a rule on history to see what it would have done. Good backtests charge trading costs and never peek at the future; AlphaLab does both.<br>
      <b>Out-of-sample:</b> testing on data the strategy was never tuned on. The only evidence that matters.<br>
      <b>IC (information coefficient):</b> correlation between a signal and what actually happened next. 0.05 is genuinely useful; 0.3 is a bug.<br>
      <b>Turnover:</b> how much trading a strategy does. High turnover = costs eat the edge.<br>
      <b>P/E ratio:</b> price divided by earnings per share, the dollars you pay per dollar of annual profit. 15 is average, under 12 is cheap, over 30 needs strong growth to justify.<br>
      <b>Forward P/E:</b> the same, but using next year's expected earnings. Lower than the trailing P/E means analysts expect profits to grow.<br>
      <b>PEG ratio:</b> P/E divided by the growth rate. Below 1 is often considered cheap for how fast the company is growing; above 2 is pricey.<br>
      <b>Price/book:</b> price versus the company's net assets. Useful for banks and asset-heavy firms; less meaningful for software.<br>
      <b>Net margin:</b> the share of every sales dollar kept as profit. 20%+ is excellent, near 0 or negative is a warning.<br>
      <b>Gross margin:</b> sales minus the direct cost of making the product, as a share of sales. High and stable gross margins signal pricing power.<br>
      <b>ROE (return on equity):</b> profit as a percentage of shareholder money. Above 15% is good; very high figures can also come from heavy debt, so read it with debt/equity.<br>
      <b>Debt/equity:</b> how much the company borrows versus what shareholders own. Over about 200 is heavy and risky if profits wobble.<br>
      <b>Revenue growth:</b> how fast sales are rising year over year. Positive and accelerating is what you want; negative means the business is shrinking.<br>
      <b>Dividend yield:</b> the annual dividend as a percentage of price, the cash a share pays you just to hold it.<br>
      <b>Analyst price target:</b> where the average Wall Street analyst thinks the stock will trade in a year. Analysts skew optimistic, so treat it as one opinion, not a promise.<br>
      <b>Consensus rating:</b> the blend of analyst calls from strong buy to strong sell. A buy consensus with a big gap up to the target is a real positive.<br>
      <b>Earnings surprise:</b> how much actual profit beat or missed the estimate last quarter. A run of beats signals a company that keeps exceeding expectations.<br>
      <b>Market cap:</b> share price times shares outstanding, the total value of the company. Large caps are steadier; small caps swing more.<br>
      <b>Sortino ratio:</b> like Sharpe, but it only counts downside swings as risk. Rewards strategies that are only volatile to the upside.<br>
      <b>Sentiment (news tone):</b> whether coverage of a stock reads positive or negative on average. Rising tone can precede a move; euphoric extremes often precede a pullback.<br>
      <b>Regime:</b> the market's current mood, calm or stressed, detected statistically. It decides whether the model favors aggressive or defensive stocks.<br>
      <b>Cointegration:</b> two stocks tied together so their gap tends to snap back. The basis of pairs trading, and it is tested statistically here (the ADF number).<br>
      <b>Monte Carlo:</b> simulating thousands of possible futures by reshuffling real history, to see the range of outcomes rather than a single guess.`)}
    ${g('What each module is for', `
      <b>Command Center:</b> the market at a glance, plus the current regime.<br>
      <b>Markets:</b> a screener of every instrument with real stats.<br>
      <b>Data Hub:</b> see every dataset, upload your own CSVs.<br>
      <b>AI Researcher:</b> an autonomous agent that invents and tests trading hypotheses around the clock and remembers every failure.<br>
      <b>Strategy Lab:</b> 118 classic strategies you can run and tweak on real history.<br>
      <b>Ensemble Engine:</b> makes strategies compete, then blends the uncorrelated winners.<br>
      <b>Alpha Factory:</b> machine-generates candidate trading signals and keeps only the survivors.<br>
      <b>ML Lab:</b> trains machine-learning price models in your browser, honestly walk-forward.<br>
      <b>Buy / Sell Decision:</b> the full one-screen verdict on any stock, fundamentals plus analysts plus news plus technicals.<br>
      <b>Stock Advisor:</b> ranks the entire US stock universe on eight factors and explains each pick.<br>
      <b>Screener:</b> filter thousands of stocks by real fundamentals (value, growth, quality, dividends).<br>
      <b>Peer Comparison:</b> line a stock up against its sector rivals on valuation and quality.<br>
      <b>Sentiment & News:</b> real news tone, social sentiment, and attention data per stock.<br>
      <b>Market Structure:</b> a map of which stocks actually trade together (PCA plus clustering).<br>
      <b>Strategy Composer:</b> build your own strategy from dropdowns, no code, full validation pipeline.<br>
      <b>Seasonality:</b> calendar patterns with the statistics to tell real ones from noise.<br>
      <b>Drawdown Analyzer:</b> every major historical decline and how long recovery took.<br>
      <b>Firm Simulator:</b> run a fund through a hidden window of real history with AI analysts.<br>
      <b>Portfolio Builder:</b> professional weighting math (risk parity, minimum variance, and friends).<br>
      <b>My Holdings:</b> your portfolio: profit and loss, risk, AI review, strategy reports.<br>
      <b>Risk Lab:</b> crash simulations on your actual book.<br>
      <b>Reports / Knowledge Base:</b> everything written down and searchable.`)}
    ${g('The Firm Simulator, how to play', `
      You found a fund with $10M to $100M and manage it through a hidden three-year stretch of real market history, advancing one week at a time. Deploy capital into validated strategy sleeves and stocks, keep some cash, and press Advance. Real crashes, rate moves and inflation prints arrive exactly as they happened (dates are masked so you cannot look up the answers).<br><br>
      Three AI analysts read the same real data and argue with you: Nadia (macro) reads vol, rates and credit; Marcus (quant) tracks which sleeves are earning; Priya (risk) polices drawdown, leverage and concentration, and WILL force you to de-risk at a 25% drawdown. Propose allocation changes to the committee, hear the objections, then apply or override.<br><br>
      You earn 2% management fees plus 20% of profits above the high-water mark. Beat the index and investors subscribe; lag badly and they redeem. At week 156 you get a grade and the reveal of which era you just survived. Losing to the index in 2008 is normal; losing to it in a bull tape is a lesson.`)}
    ${g('The universe: what stocks are in here', `
      Two tiers, all real Yahoo Finance data. The full S&P 500 (every constituent, around 500 names) carries 10 years of weekly prices with sector labels. The extended total-market tier covers every listed US common stock above a small size floor (thousands of names, the same coverage idea as a total-market index fund) with 3 years of weekly prices. On top of that, 78 flagship instruments (major stocks, ETFs, futures, FX, crypto) carry full daily history back to 2000 for deep backtesting. The Advisor scores the whole universe; deep strategy backtests run on the daily tier where the data is strongest.`)}
    ${g('Defending your picks to judges', `
      Judges do not reward returns; they reward process. For every holding be ready to answer four questions. Why this company? (cite the factor scores: momentum, trend, consistency, sector-relative strength). Why now? (cite the regime readout and the sentiment feeds). What is the risk? (cite its volatility, its worst drawdown from the Drawdown Analyzer, and your position size). When would you sell? (a price level, a factor deterioration, or a regime change, decided in advance). Every one of those numbers is on this site; put them in your strategy report and you will sound like a professional because you will be reasoning like one.`)}
    ${g('Common beginner mistakes this platform catches', `
      <b>Chasing a chart that already went up</b>: momentum is real but the Advisor also checks consistency and volatility; a parabolic chart usually scores badly on both.<br>
      <b>All eggs, one basket</b>: the concentration (HHI) tile and Priya in the simulator both flag it.<br>
      <b>Confusing a bull market for skill</b>: always compare against SPY; the benchmark line is on every chart for a reason.<br>
      <b>Trusting a beautiful backtest</b>: the validation gauntlet exists because most beautiful backtests are curve-fit. REJECTED is the system saving you money.<br>
      <b>Ignoring costs</b>: high-turnover ideas die at 3x costs; check the turnover metric.<br>
      <b>No exit plan</b>: decide the sell rule when you buy, not during the panic.`)}
    ${g('Reading a verdict without getting fooled', `When a strategy or factor says <b>VALIDATED</b>, it passed five separate honesty checks (works on unseen data, survives triple costs, stable to parameter changes, consistent across years, statistically significant). <b>REJECTED</b> means the edge is not real once costs and statistics are applied, which is the outcome for most ideas, and knowing that is the value. If a number ever looks amazing, distrust it first: check the out-of-sample column and the turnover before you believe anything.`)}
    ${g('Terminal cheat sheet', `<span class="num">CHART AMZN</span> · chart anything<br><span class="num">COMPARE SPY QQQ GLD</span> · overlay up to 4<br><span class="num">BT S001</span> · run a strategy by id<br><span class="num">STRESS 2008</span> · crisis replay (2008, COVID, 2022, DOTCOM, 1987)<br><span class="num">RESEARCH START</span> · wake the AI researcher<br><span class="num">FACTOR SCAN</span> · hunt for new signals<br><span class="num">GO HOLD</span> · jump to any module<br>Press <span class="num">Ctrl+K</span> anywhere for the command palette.`)}
    </div></div>`;
});

// first-visit welcome so nobody lands on the terminal cold
UI.showWelcome = function () {
  if (AL.store.get('seen_welcome', false)) return;
  const ov = document.createElement('div');
  // same look as the palette overlay but its own element, so ids stay unique
  ov.style.cssText = 'position:fixed;inset:0;background:#05070acc;z-index:1001;display:flex;align-items:flex-start;justify-content:center;padding-top:16vh';
  ov.innerHTML = `<div style="width:560px;max-width:92vw;background:#10141a;border:1px solid var(--line2);border-radius:10px;box-shadow:0 24px 80px #000c;padding:26px 30px">
    <div style="font-size:19px;font-weight:650;margin-bottom:8px">Welcome to AlphaLab</div>
    <div class="note" style="font-size:13px;line-height:1.7;margin-bottom:14px">A research terminal for markets, built on 26 years of real data plus live fundamentals, analyst targets, news, and social posts. No finance background needed. The best way to start is the guided tour, which drives the app for you and points at what matters.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary" id="w-tour">Take the guided tour</button>
      <button class="btn" id="w-guide">Open the guide</button>
      <button class="btn" id="w-wharton">Competition setup ($100K)</button>
      <button class="btn" id="w-skip">Just explore</button>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => { AL.store.set('seen_welcome', true); ov.remove(); };
  ov.querySelector('#w-tour').addEventListener('click', () => { close(); UI.startTour(); });
  ov.querySelector('#w-guide').addEventListener('click', () => { close(); UI.focusModule('guide'); });
  ov.querySelector('#w-wharton').addEventListener('click', () => { close(); UI.focusModule('holdings', { wharton: true }); });
  ov.querySelector('#w-skip').addEventListener('click', close);
};
